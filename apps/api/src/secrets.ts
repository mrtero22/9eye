// Credentials at rest: AES-256-GCM with the key in NINEEYE_SECRET_KEY (never committed).
// Encrypted values are only ever decrypted by the server for the connection that owns them.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { HttpError } from './errors';

function key(): Buffer {
  const k = Buffer.from(process.env.NINEEYE_SECRET_KEY ?? '', 'base64');
  if (k.length !== 32) throw new HttpError(500, 'Credentials cannot be stored: the server has no secret key.');
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split(':');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
