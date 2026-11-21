// Makes a person who can sign in (decision 0021): the first platform admin of a fresh install, or an
// active member of one company with a built-in role. The password is asked twice in the terminal,
// never on the command line, and only its hash is stored. Nothing is written when a check fails.
//
//   npm -w @9eye/api run user:create -- <email> "<name>" --admin
//   npm -w @9eye/api run user:create -- <email> "<name>" --company <short name> [--role <role>]
//
// Roles: company-admin, traffic, scheduler, sales, viewer (the default).

import { MIN_PASSWORD } from '../src/auth';
import { platformDb } from '../src/db';
import { DEFAULT_ROLE, ROLE_KEYS, checkNewPerson, createPerson, type NewPerson } from '../src/services/people';
import { askHidden, fail } from './terminal';

const USAGE = [
  'Usage:',
  '  npm -w @9eye/api run user:create -- <email> "<name>" --admin',
  '  npm -w @9eye/api run user:create -- <email> "<name>" --company <short name> [--role <role>]',
  `Roles: ${ROLE_KEYS.join(', ')} (default ${DEFAULT_ROLE}).`,
].join('\n');

function parse(args: string[]): Omit<NewPerson, 'password'> | null {
  const rest: string[] = [];
  let platformAdmin = false;
  let companySlug: string | undefined;
  let roleKey: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--admin') platformAdmin = true;
    else if (a === '--company') companySlug = args[++i];
    else if (a === '--role') roleKey = args[++i];
    else if (a === '--help' || a === '-h') return null;
    else if (a.startsWith('--')) return null;
    else rest.push(a);
  }
  if (rest.length !== 2) return null;
  return { email: rest[0], name: rest[1], platformAdmin, companySlug, roleKey };
}

const input = parse(process.argv.slice(2));
if (!input) await fail(USAGE);
if (!process.stdin.isTTY) await fail('Run this in a terminal: it asks for the password.');

// Check everything but the password first, so a typo is reported before any typing.
const early = await checkNewPerson({ ...input!, password: 'x'.repeat(MIN_PASSWORD) });
if (early.length) await fail(`${early.join('\n')}\nNothing was created.`);

const password = await askHidden(`Password for ${input!.name} <${input!.email.trim().toLowerCase()}> (at least ${MIN_PASSWORD} characters): `);
if ((await askHidden('Type it again: ')) !== password) await fail('The two passwords are not the same. Nothing was created.');

try {
  const made = await createPerson({ ...input!, password });
  const where = made.company ? `${made.role} in ${made.company}` : 'platform admin of every company';
  console.log(`Created ${made.email} (${where}). They can sign in now.`);
} catch (e) {
  await fail(`${(e as Error).message}\nNothing was created.`);
}
await platformDb.$disconnect();
