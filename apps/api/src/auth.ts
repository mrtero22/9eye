// Sign-in (decision 0021): one login per person for every company, a session cookie, and the guard
// in front of every other API route.

import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { uuidv7 } from '@9eye/core';
import { platformDb } from './db';
import { HttpError } from './errors';

export const SESSION_COOKIE = 'nineeye_session';
export const MIN_PASSWORD = 12;
const SESSION_DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
/** Wrong passwords from one address (behind the proxy: the client's) within LOCK_MINUTES. */
const MAX_FAILED_PER_ADDRESS = 30;

// ---------------------------------------------------------------- passwords

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scryptKey(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.normalize('NFKC'), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p, keylen } = SCRYPT;
  const salt = randomBytes(16);
  const key = await scryptKey(password, salt, keylen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptKey(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(key, expected);
}

/** Checked when the e-mail is unknown, so that answer takes as long as a wrong password. */
let dummyHash: Promise<string> | null = null;

// ---------------------------------------------------------------- sessions

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(userId: string, ms = SESSION_DAYS * 86_400_000) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ms);
  await platformDb.session.create({ data: { id: uuidv7(), userId, tokenHash: sha256(token), expiresAt } });
  return { token, expiresAt };
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

async function sessionUser(req: Request): Promise<User | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const s = await platformDb.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  return s && s.expiresAt > new Date() ? s.user : null;
}

/** The signed-in person of this request (set by requireSession). */
export const signedInUser = (res: Response) => res.locals.user as User;

const cookieOptions = (req: Request) => ({ httpOnly: true, sameSite: 'lax' as const, secure: req.secure, path: '/' });

const meDto = (u: User) => ({ id: u.id, name: u.name, email: u.email, platformAdmin: u.platformAdmin });

export const requireSession: RequestHandler = async (req, res, next) => {
  const user = await sessionUser(req);
  if (!user) throw new HttpError(401, 'Sign in to continue.');
  res.locals.user = user;
  next();
};

// ---------------------------------------------------------------- too many tries

const failedByAddress = new Map<string, number[]>();

function recentFailures(address: string, now: number) {
  const xs = (failedByAddress.get(address) ?? []).filter((t) => now - t < LOCK_MINUTES * 60_000);
  if (xs.length) failedByAddress.set(address, xs);
  else failedByAddress.delete(address);
  return xs;
}

const tooMany = (until: number, now: number) => {
  const minutes = Math.max(1, Math.ceil((until - now) / 60_000));
  return new HttpError(429, `Too many tries. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
};

// ---------------------------------------------------------------- routes

const signInBody = z.object({ email: z.string().max(320), password: z.string().max(1000) });

export function authRouter(): Router {
  const r = Router();

  r.post('/sign-in', async (req, res) => {
    const { email, password } = signInBody.parse(req.body);
    const now = Date.now();
    const address = req.ip ?? '';
    const failures = recentFailures(address, now);
    if (failures.length >= MAX_FAILED_PER_ADDRESS) throw tooMany(failures[0] + LOCK_MINUTES * 60_000, now);
    const user = await platformDb.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (user?.lockedUntil && user.lockedUntil.getTime() > now) throw tooMany(user.lockedUntil.getTime(), now);
    const ok = user?.passwordHash
      ? await verifyPassword(password, user.passwordHash)
      : (await verifyPassword(password, await (dummyHash ??= hashPassword(randomBytes(16).toString('hex')))), false);
    if (!user || !ok) {
      failedByAddress.set(address, [...failures, now]);
      if (user) {
        const lock = user.failedSignIns + 1 >= MAX_FAILED;
        const until = now + LOCK_MINUTES * 60_000;
        await platformDb.user.update({ where: { id: user.id }, data: lock ? { failedSignIns: 0, lockedUntil: new Date(until) } : { failedSignIns: { increment: 1 } } });
        if (lock) throw tooMany(until, now);
      }
      throw new HttpError(401, 'Email or password is not right.');
    }
    await platformDb.user.update({ where: { id: user.id }, data: { failedSignIns: 0, lockedUntil: null, lastActiveAt: new Date(now) } });
    await platformDb.session.deleteMany({ where: { userId: user.id, expiresAt: { lte: new Date(now) } } });
    const s = await createSession(user.id);
    res.cookie(SESSION_COOKIE, s.token, { ...cookieOptions(req), expires: s.expiresAt });
    res.json(meDto(user));
  });

  r.post('/sign-out', async (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await platformDb.session.deleteMany({ where: { tokenHash: sha256(token) } });
    res.clearCookie(SESSION_COOKIE, cookieOptions(req));
    res.status(204).end();
  });

  r.get('/me', async (req, res) => {
    const user = await sessionUser(req);
    if (!user) throw new HttpError(401, 'Sign in to continue.');
    res.json(meDto(user));
  });

  return r;
}
