// Point Prisma at the test database before anything imports it.
import { existsSync } from 'node:fs';

if (existsSync('../../.env')) process.loadEnvFile('../../.env');
const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must be set and differ from DATABASE_URL');
process.env.DATABASE_URL = url;
