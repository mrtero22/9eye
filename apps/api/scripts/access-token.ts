// Personal access tokens for MCP clients (decision 0023). A token is one person in one company, read
// only unless made with --edit (then the write tools are offered too; the person's role still decides
// each call). It is printed once when it is made and only its SHA-256 is stored.
//   npm -w @9eye/api run token -- create <email> <company-slug> "<name>" [days] [--edit]
//   npm -w @9eye/api run token -- list <email>
//   npm -w @9eye/api run token -- revoke <token-id>

import { uuidv7 } from '@9eye/core';
import { accessOf } from '../src/access';
import { platformDb } from '../src/db';
import { TOKEN_DAYS, TOKEN_MAX_DAYS, newAccessToken } from '../src/mcp/auth';

const API = `http://${process.env.API_HOST ?? '127.0.0.1'}:${process.env.API_PORT ?? 4100}/api/mcp`;
const USAGE = [
  'Usage:',
  '  npm -w @9eye/api run token -- create <email> <company-slug> "<name>" [days] [--edit]',
  '  npm -w @9eye/api run token -- list <email>',
  '  npm -w @9eye/api run token -- revoke <token-id>',
].join('\n');

async function fail(message: string): Promise<never> {
  console.error(message);
  await platformDb.$disconnect();
  process.exit(1);
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

async function person(email: string | undefined) {
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return fail(USAGE);
  return (await platformDb.user.findUnique({ where: { email: e } })) ?? fail(`No person with the e-mail ${e}.`);
}

const argv = process.argv.slice(2);
const edit = argv.includes('--edit');
const [command, ...args] = argv.filter((a) => a !== '--edit');

if (command === 'create') {
  const [email, slug, name, daysArg] = args;
  const user = await person(email);
  if (!slug || !name?.trim()) await fail(USAGE);
  const tenant = (await platformDb.tenant.findUnique({ where: { slug } })) ?? (await fail(`No company "${slug}".`));
  if (!(await accessOf(user, tenant.id))) await fail(`${user.name} cannot open ${tenant.name}. Nothing was made.`);
  const days = daysArg ? Number(daysArg) : TOKEN_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > TOKEN_MAX_DAYS) await fail(`Days must be a whole number from 1 to ${TOKEN_MAX_DAYS}. Nothing was made.`);
  const { token, hash } = newAccessToken();
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  const row = await platformDb.accessToken.create({
    data: { id: uuidv7(), userId: user.id, tenantId: tenant.id, name: name.trim(), tokenHash: hash, expiresAt, access: edit ? 'edit' : 'read' },
  });
  const what = edit ? 'read and edit (as far as the role allows)' : 'read only';
  console.log(`Token "${row.name}" for ${user.name} in ${tenant.name}: ${what}, until ${day(expiresAt)} (id ${row.id}).`);
  console.log('It is shown only now — keep it like a password:\n');
  console.log(`  ${token}\n`);
  console.log('Claude Code:');
  console.log(`  claude mcp add --transport http 9eye ${API} --header "Authorization: Bearer ${token}"`);
} else if (command === 'list') {
  const user = await person(args[0]);
  const rows = await platformDb.accessToken.findMany({ where: { userId: user.id }, include: { tenant: true }, orderBy: { createdAt: 'desc' } });
  if (!rows.length) console.log(`${user.name} has no access tokens.`);
  const now = new Date();
  for (const t of rows) {
    const state = t.revokedAt ? `revoked ${day(t.revokedAt)}` : t.expiresAt <= now ? 'expired' : `until ${day(t.expiresAt)}`;
    console.log(`${t.id}  "${t.name}" · ${t.tenant.name} · ${t.access} · made ${day(t.createdAt)} · last used ${day(t.lastUsedAt)} · ${state}`);
  }
} else if (command === 'revoke') {
  const id = (args[0] ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) await fail(USAGE);
  const t = (await platformDb.accessToken.findUnique({ where: { id } })) ?? (await fail(`No access token ${id}.`));
  if (t.revokedAt) console.log(`"${t.name}" was already revoked on ${day(t.revokedAt)}.`);
  else {
    await platformDb.accessToken.update({ where: { id }, data: { revokedAt: new Date() } });
    console.log(`Revoked "${t.name}": it no longer works.`);
  }
} else {
  await fail(USAGE);
}
await platformDb.$disconnect();
