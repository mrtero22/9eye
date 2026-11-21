// MCP over stdio (decision 0023): the same tools as POST /api/mcp, for MCP clients that start a local
// command instead of calling a URL (desktop apps, MCP inspectors, the Docker demo). It runs as the
// person of one personal access token, checked when it starts; stdout carries MCP messages only.
//   NINEEYE_MCP_TOKEN=9eye_pat_… npm -s -w @9eye/api run mcp:stdio

import './stdio-console';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { platformDb } from '../src/db';
import { checkAccessToken } from '../src/mcp/auth';
import { buildServer } from '../src/mcp/tools';

async function stop(code: number, message?: string): Promise<never> {
  if (message) console.error(message);
  await platformDb.$disconnect();
  process.exit(code);
}

const token = (process.env.NINEEYE_MCP_TOKEN ?? '').trim();
if (!token) await stop(1, 'Set NINEEYE_MCP_TOKEN to a personal access token (9eye_pat_…): Account › AI access, or npm -w @9eye/api run token -- create.');

const checked = await checkAccessToken(token);
if (!checked.ok) {
  await stop(1, checked.message);
} else {
  const { principal } = checked;
  console.error(`9eye MCP over stdio: ${principal.user.name} in ${principal.tenant.name}, ${principal.canWrite ? 'read and change' : 'read only'}.`);
  serveStdio(() => buildServer(principal), { onerror: (e) => console.error('MCP', e) });
  // The client closing stdin ends the session; the database pool would keep the process alive.
  process.stdin.on('end', () => void stop(0));
}
