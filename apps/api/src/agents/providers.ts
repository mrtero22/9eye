// The AI providers an agent thinks with (decision 0024): Claude through the Anthropic SDK, ChatGPT
// through the OpenAI SDK, Grok through the OpenAI SDK at xAI's address. Each adapter keeps its own
// conversation and speaks the runner's small language: a turn (text, tool calls, why it stopped,
// tokens) and the answers to the tool calls. Keys are the company's own (Settings › AI access).

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { platformDb } from '../db';
import { HttpError } from '../errors';
import { decryptSecret } from '../secrets';

export const PROVIDERS = ['anthropic', 'openai', 'xai'] as const;
export type ProviderName = (typeof PROVIDERS)[number];
export const PROVIDER_LABEL: Record<ProviderName, string> = { anthropic: 'Claude (Anthropic)', openai: 'ChatGPT (OpenAI)', xai: 'Grok (xAI)' };

/** Claude models offered for agents; a new agent starts on the first. */
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' },
];
export const DEFAULT_MODEL = { provider: 'anthropic' as ProviderName, model: 'claude-opus-5-5' };

/** Claude models whose refusals the API can hand to another model in the same call. */
const SERVER_FALLBACK = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the input (an object). */
  schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface Turn {
  text: string;
  calls: ToolCall[];
  /** end: finished · tools: wants the calls answered · limit: ran out of output · refusal: declined */
  stop: 'end' | 'tools' | 'limit' | 'refusal';
  inputTokens: number;
  outputTokens: number;
}

export interface Session {
  next(): Promise<Turn>;
  answer(results: { id: string; text: string; isError: boolean }[]): void;
}

export interface SessionInput {
  system: string;
  tools: ToolSpec[];
  prompt: string;
}

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  apiKey: string;
}

const MAX_TOKENS = 16000;

// ---------------------------------------------------------------- Claude

function claudeSession(cfg: ProviderConfig, input: SessionInput): Session {
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const tools: Anthropic.Beta.BetaTool[] = input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: input.prompt }];
  const fallback = SERVER_FALLBACK.has(cfg.model);
  return {
    async next() {
      const response = await client.beta.messages.create({
        model: cfg.model,
        max_tokens: MAX_TOKENS,
        system: input.system,
        tools,
        messages,
        output_config: { effort: 'high' },
        cache_control: { type: 'ephemeral' },
        // On a refusal the API re-runs the request on a model it picks for that category.
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
      // The whole content goes back, thinking blocks included, unchanged.
      messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
      const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
      const calls = response.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : []));
      const stop: Turn['stop'] =
        response.stop_reason === 'tool_use' ? 'tools' : response.stop_reason === 'max_tokens' ? 'limit' : response.stop_reason === 'refusal' ? 'refusal' : 'end';
      return { text, calls, stop, inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0), outputTokens: response.usage.output_tokens };
    },
    answer(results) {
      messages.push({
        role: 'user',
        content: results.map((r): Anthropic.Beta.BetaToolResultBlockParam => ({ type: 'tool_result', tool_use_id: r.id, content: r.text, is_error: r.isError })),
      });
    },
  };
}

// ---------------------------------------------------------------- ChatGPT and Grok (OpenAI-compatible)

function openAiSession(cfg: ProviderConfig, input: SessionInput): Session {
  const client = new OpenAI({ apiKey: cfg.apiKey, ...(cfg.provider === 'xai' ? { baseURL: 'https://api.x.ai/v1' } : {}) });
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = input.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: input.system },
    { role: 'user', content: input.prompt },
  ];
  return {
    async next() {
      const res = await client.chat.completions.create({ model: cfg.model, messages, tools });
      const choice = res.choices[0];
      const msg = choice.message;
      const fnCalls = (msg.tool_calls ?? []).flatMap((c) => (c.type === 'function' ? [c] : []));
      messages.push({ role: 'assistant', content: msg.content ?? '', ...(fnCalls.length ? { tool_calls: fnCalls } : {}) });
      const calls = fnCalls.map((c) => {
        let parsed: unknown = {};
        try {
          parsed = JSON.parse(c.function.arguments || '{}');
        } catch {
          parsed = { __invalid: c.function.arguments };
        }
        return { id: c.id, name: c.function.name, input: parsed };
      });
      const stop: Turn['stop'] =
        choice.finish_reason === 'tool_calls' || calls.length ? 'tools' : choice.finish_reason === 'length' ? 'limit' : choice.finish_reason === 'content_filter' ? 'refusal' : 'end';
      return { text: (msg.content ?? '').trim(), calls, stop, inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
    },
    answer(results) {
      for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `Error: ${r.text}` : r.text });
    },
  };
}

// ---------------------------------------------------------------- opening a session

/** Tests replace the providers with a scripted one (no network, no cost). */
let testProvider: ((cfg: ProviderConfig, input: SessionInput) => Session) | null = null;
export function setTestProvider(fn: typeof testProvider) {
  testProvider = fn;
}

export function openSession(cfg: ProviderConfig, input: SessionInput): Session {
  if (testProvider) return testProvider(cfg, input);
  return cfg.provider === 'anthropic' ? claudeSession(cfg, input) : openAiSession(cfg, input);
}

/** The company's key for a provider (decrypted only here, for the call). */
export async function providerKey(tenantId: string, provider: ProviderName): Promise<string> {
  const row = await platformDb.aiProvider.findUnique({ where: { tenantId_provider: { tenantId, provider } } });
  if (!row) throw new HttpError(409, `There is no key for ${PROVIDER_LABEL[provider]}: a company admin adds one in Settings › AI access.`);
  return decryptSecret(row.secret);
}

/** Readable words for a provider's error (no secrets in it). */
export function providerError(e: unknown): string {
  if (e instanceof HttpError) return e.message;
  if (e instanceof Anthropic.AuthenticationError || e instanceof OpenAI.AuthenticationError) return 'The provider refused the key: check it in Settings › AI access.';
  if (e instanceof Anthropic.RateLimitError || e instanceof OpenAI.RateLimitError) return 'The provider is busy (rate limit): try again in a minute.';
  if (e instanceof Anthropic.APIError || e instanceof OpenAI.APIError) return `The provider answered with an error (${e.status ?? 'no status'}).`;
  console.error('agent provider', e);
  return 'Something went wrong while talking to the provider.';
}
