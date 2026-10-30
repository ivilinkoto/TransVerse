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

/** Messages of a request the client gave up on (left the page, closed the app, lost the network). */
const CLIENT_ABORT = /destination stream closed early|premature close|this operation was aborted|^(\w+: )?aborted$|ECONNRESET|EPIPE/i;
const ABORT_CODES = new Set(['ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'ABORT_ERR']);

/**
 * 1.1.3.5: the browser left before the answer was streamed to the end — not a
 * fault of the server, so it is not logged.
 */
export function isClientAbort(error: unknown): boolean {
  if (typeof error === 'string') return CLIENT_ABORT.test(error);
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return error.name === 'AbortError' || ABORT_CODES.has(String(code)) || CLIENT_ABORT.test(error.message);
}

export async function recentServerErrors(db: DbOrTx): Promise<ServerError[]> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, KEY));
  const items = (row?.value as { items?: ServerError[] } | undefined)?.items;
  // Entries written before 1.1.3.5 may still hold aborted requests.
  return Array.isArray(items) ? items.filter((e) => !isClientAbort(e.message)) : [];
}

export async function recordServerError(where: string, error: unknown, db: DbOrTx = getDb(), now = new Date()) {
  if (isClientAbort(error)) return;
  try {
    const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);
    const items = [{ at: now.toISOString(), where: where.slice(0, 200), message }, ...(await recentServerErrors(db))].slice(0, ERROR_LOG_SIZE);
    await db.insert(jobState).values({ key: KEY, value: { items } }).onConflictDoUpdate({ target: jobState.key, set: { value: { items }, updatedAt: now } });
  } catch {
    /* the log must never make things worse */
  }
}
