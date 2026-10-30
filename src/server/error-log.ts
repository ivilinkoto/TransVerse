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
  /** 1.1.3.5: the code the player sees on the error page ("Код на грешката"). */
  digest?: string;
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

/** 1.1.3.5: the same error on the same page, counted once (newest first) — for the admin panel. */
export function groupServerErrors(items: ServerError[]) {
  const groups = new Map<string, ServerError & { count: number; firstAt: string; digests: string[] }>();
  for (const e of items) {
    // "?_rsc=…" and ids make the same page look different.
    const page = e.where.replace(/\?.*$/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:n');
    const key = `${page}|${e.message}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      g.firstAt = e.at;
      if (e.digest && g.digests.length < 5) g.digests.push(e.digest);
    } else groups.set(key, { ...e, where: page, count: 1, firstAt: e.at, digests: e.digest ? [e.digest] : [] });
  }
  return [...groups.values()];
}

/** "Изчисти": the list starts again from empty. */
export async function clearServerErrors(db: DbOrTx, now = new Date()) {
  await db.insert(jobState).values({ key: KEY, value: { items: [] } }).onConflictDoUpdate({ target: jobState.key, set: { value: { items: [] }, updatedAt: now } });
}

export async function recordServerError(where: string, error: unknown, db: DbOrTx = getDb(), now = new Date()) {
  if (isClientAbort(error)) return;
  try {
    const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);
    const digest = (error as { digest?: unknown } | null)?.digest;
    const entry: ServerError = { at: now.toISOString(), where: where.slice(0, 200), message, ...(typeof digest === 'string' ? { digest: digest.slice(0, 40) } : {}) };
    const items = [entry, ...(await recentServerErrors(db))].slice(0, ERROR_LOG_SIZE);
    await db.insert(jobState).values({ key: KEY, value: { items } }).onConflictDoUpdate({ target: jobState.key, set: { value: { items }, updatedAt: now } });
  } catch {
    /* the log must never make things worse */
  }
}
