import { eq } from 'drizzle-orm';
import { getDb, type DbOrTx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';

/**
 * 1.1.4: the last unexpected server errors, for the admin panel (Система).
 * Kept in job_state (the newest 50); writing never fails the request.
 */
const KEY = 'errors:recent';
export const ERROR_LOG_SIZE = 50;

export interface ServerError {
  at: string;
  where: string;
  message: string;
}

export async function recentServerErrors(db: DbOrTx): Promise<ServerError[]> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, KEY));
  const items = (row?.value as { items?: ServerError[] } | undefined)?.items;
  return Array.isArray(items) ? items : [];
}

export async function recordServerError(where: string, error: unknown, db: DbOrTx = getDb(), now = new Date()) {
  try {
    const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);
    const items = [{ at: now.toISOString(), where: where.slice(0, 200), message }, ...(await recentServerErrors(db))].slice(0, ERROR_LOG_SIZE);
    await db.insert(jobState).values({ key: KEY, value: { items } }).onConflictDoUpdate({ target: jobState.key, set: { value: { items }, updatedAt: now } });
  } catch {
    /* the log must never make things worse */
  }
}
