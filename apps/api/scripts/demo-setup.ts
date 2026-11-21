// The demo's people and keys (docker/demo): a platform admin who can sign in, AI allowed in the sample
// companies, and one MCP access token for the stdio server, kept in a file. Safe to run again: what
// exists is kept. For a demo only — the password and the token are meant to be shown.
//   npm -w @9eye/api run demo:setup -- [token file]
//   NINEEYE_DEMO_EMAIL / NINEEYE_DEMO_PASSWORD change the person (defaults below).

import { readFileSync, writeFileSync } from 'node:fs';
import { uuidv7 } from '@9eye/core';
import { preset } from '../src/aiPolicy';
import { platformDb } from '../src/db';
import { checkAccessToken, newAccessToken } from '../src/mcp/auth';
import { createPerson } from '../src/services/people';

const EMAIL = (process.env.NINEEYE_DEMO_EMAIL ?? 'demo@9eye.local').trim().toLowerCase();
const PASSWORD = process.env.NINEEYE_DEMO_PASSWORD ?? '9eye-demo-password';
const COMPANY = 'sample-station';
const tokenFile = process.argv[2] ?? '/var/lib/9eye/demo-token';

// 1. The person: a platform admin, so every sample company is open to them.
let user = await platformDb.user.findUnique({ where: { email: EMAIL } });
if (!user) {
  await createPerson({ email: EMAIL, name: 'Demo admin', password: PASSWORD, platformAdmin: true });
  user = await platformDb.user.findUniqueOrThrow({ where: { email: EMAIL } });
  console.error(`Demo admin made: ${EMAIL}`);
}

// 2. AI may do everything in the sample companies (Settings › AI access, preset Full), so every tool
//    is offered; a table someone changed in the demo is kept.
for (const slug of ['sample-public', 'sample-station']) {
  const t = await platformDb.tenant.findUnique({ where: { slug } });
  if (t && t.aiPolicy === null) await platformDb.tenant.update({ where: { id: t.id }, data: { aiAccess: 'edit', aiPolicy: preset('full') } });
}

// 3. The stdio server's token: kept while it is still valid, else a new one.
let current = '';
try {
  current = readFileSync(tokenFile, 'utf8').trim();
} catch {
  /* first run */
}
if (!current || !(await checkAccessToken(current)).ok) {
  const tenant = await platformDb.tenant.findUniqueOrThrow({ where: { slug: COMPANY } });
  const { token, hash } = newAccessToken();
  await platformDb.accessToken.create({
    data: { id: uuidv7(), userId: user.id, tenantId: tenant.id, name: 'Demo (stdio)', tokenHash: hash, expiresAt: new Date(Date.now() + 365 * 86_400_000), access: 'edit' },
  });
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  console.error(`Demo MCP token written to ${tokenFile}`);
}
await platformDb.$disconnect();
