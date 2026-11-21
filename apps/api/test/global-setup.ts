import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export default function setup() {
  if (existsSync('../../.env')) process.loadEnvFile('../../.env');
  const url = process.env.TEST_DATABASE_URL;
  if (!url || url === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must be set and differ from DATABASE_URL');
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
