// The MCP endpoint (decision 0023): POST /api/mcp, Streamable HTTP, for Claude, ChatGPT, Grok or any
// MCP client. Stateless: every request gets its own server, built for the token's person and company.
// It serves both the 2026-07-28 protocol and older (2025) clients.

import { Router } from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { principalOf, requireAccessToken } from './auth';
import { buildServer } from './tools';

const logError = (e: Error) => console.error('MCP', e);

export function mcpRouter(): Router {
  // Answers are one JSON body: the tools send nothing before their result (no progress yet).
  const handler = createMcpHandler((ctx) => buildServer(principalOf(ctx.authInfo)), { onerror: logError });
  const serve = toNodeHandler(handler, { onerror: logError });
  const r = Router();
  r.use(requireAccessToken);
  r.all('/', (req, res) => serve(req, res, req.body));
  return r;
}
