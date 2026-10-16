import { execSync } from 'node:child_process';
import pg from 'pg';

/** Fresh schema + real geo data in the test database before the suite runs. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/transverse_test';
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await client.end();
  const env = { ...process.env, DATABASE_URL: url };
  execSync('pnpm -s tsx scripts/migrate.ts', { env, stdio: 'inherit' });
  execSync('pnpm -s tsx scripts/import-geonames.ts', { env, stdio: 'inherit' });
}
