import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Tx;

const globalForDb = globalThis as unknown as { tvPool?: pg.Pool; tvDb?: Database };

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

/** Shared pool (survives Next.js hot reloads in development). */
export function getPool(): pg.Pool {
  globalForDb.tvPool ??= new pg.Pool({ connectionString: connectionString(), max: Number(process.env.DB_POOL_SIZE ?? 10) });
  return globalForDb.tvPool;
}

export function getDb(): Database {
  globalForDb.tvDb ??= drizzle(getPool(), { schema });
  return globalForDb.tvDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.tvPool?.end();
  globalForDb.tvPool = undefined;
  globalForDb.tvDb = undefined;
}

export { schema };
