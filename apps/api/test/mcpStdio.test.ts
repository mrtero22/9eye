// MCP over stdio (scripts/mcp-stdio.ts): the official MCP client starts the server as a command and
// gets the same tools as over HTTP, as the token's person; a bad token stops it with a message.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { uuidv7 } from '@9eye/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { platformDb } from '../src/db';
import { newAccessToken } from '../src/mcp/auth';
import { makeCompany, resetDb, type Fixture } from './fixtures';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const TSX = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));
let a: Fixture;

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
});
afterAll(() => platformDb.$disconnect());

async function adminToken() {
  const user = await platformDb.user.create({ data: { id: uuidv7(), email: 'stdio@example.org', name: 'Stdio admin', platformAdmin: true } });
  const { token, hash } = newAccessToken();
  await platformDb.accessToken.create({ data: { id: uuidv7(), userId: user.id, tenantId: a.tenantId, name: 'stdio', tokenHash: hash, expiresAt: new Date(Date.now() + 86_400_000) } });
  return token;
}

/** The environment of the test database (env.ts points DATABASE_URL at it). */
const env = (token: string) => ({ ...(process.env as Record<string, string>), NINEEYE_MCP_TOKEN: token });

describe('MCP over stdio', () => {
  it('lists the tools and answers a call as the token’s person', async () => {
    const transport = new StdioClientTransport({ command: TSX, args: ['scripts/mcp-stdio.ts'], cwd: API_DIR, env: env(await adminToken()), stderr: 'pipe' });
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['list_channels', 'get_day_playlist', 'list_plans']));
      const result = await client.callTool({ name: 'list_channels', arguments: {} });
      const text = (result.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n');
      expect(text).toContain('AURORA TV');
    } finally {
      await client.close();
    }
  });

  it('stops with a message when the token is not valid', () => {
    const run = spawnSync(TSX, ['scripts/mcp-stdio.ts'], { cwd: API_DIR, env: env('9eye_pat_not-a-real-token'), encoding: 'utf8', timeout: 30_000 });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('This access token is not valid');
  });
});
