// Sets a person's password (decision 0021): asked twice in the terminal, never on the command line,
// and only its hash is stored. Also unlocks the sign-in and signs the person out everywhere.
//   npm -w @9eye/api run user:password -- <email>

import { MIN_PASSWORD, hashPassword } from '../src/auth';
import { platformDb } from '../src/db';
import { askHidden, fail } from './terminal';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email) await fail('Usage: npm -w @9eye/api run user:password -- <email>');
if (!process.stdin.isTTY) await fail('Run this in a terminal: it asks for the password.');
const user = (await platformDb.user.findUnique({ where: { email } })) ?? (await fail(`No person with the e-mail ${email}.`));

const password = await askHidden(`New password for ${user.name} <${email}>: `);
if (password.length < MIN_PASSWORD) await fail(`The password needs at least ${MIN_PASSWORD} characters. Nothing was changed.`);
if ((await askHidden('Type it again: ')) !== password) await fail('The two passwords are not the same. Nothing was changed.');

await platformDb.$transaction([
  platformDb.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), failedSignIns: 0, lockedUntil: null } }),
  platformDb.session.deleteMany({ where: { userId: user.id } }),
]);
console.log(`Password set: ${user.name} can sign in now, and earlier sessions are signed out.`);
await platformDb.$disconnect();
