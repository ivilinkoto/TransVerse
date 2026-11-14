/**
 * Why does the site answer 502 now and then? Caddy says 502 when the web process does not
 * answer — it died and systemd is starting it again. This keeps what is needed to see it in
 * the admin panel (Админ → Система): every start of the web and the worker, the memory a
 * minute before (a process killed for memory is close to its MemoryMax), and errors that
 * nothing caught. Kept in job_state, a short list, never in the way of the game.
 */
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { recordServerError } from './error-log';

export type ProcessKind = 'web' | 'worker';
export interface MemorySample { at: string; rssMb: number; heapMb: number; uptimeS: number }
export interface ProcessBoot { at: string; kind: ProcessKind; pid: number; /** The last sample of the process before it: its memory just before it stopped. */ before: MemorySample | null }

const BOOTS = 'process-boots';
const sampleKey = (kind: ProcessKind) => `process-sample:${kind}`;
export const PROCESS_HEALTH = { keepBoots: 40, sampleMs: 60_000, /** systemd MemoryMax of each service (deploy/*.service). */ memoryMaxMb: { web: 900, worker: 400 } as Record<ProcessKind, number> };

const mb = (bytes: number) => Math.round(bytes / 1_048_576);

export function memorySample(now = new Date()): MemorySample {
  const m = process.memoryUsage();
  return { at: now.toISOString(), rssMb: mb(m.rss), heapMb: mb(m.heapUsed), uptimeS: Math.round(process.uptime()) };
}

/** Records this start (with the last memory sample of the process before it). */
export async function recordBoot(db: DbOrTx, kind: ProcessKind, now = new Date()): Promise<ProcessBoot> {
  const [prev] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, sampleKey(kind)));
  const boot: ProcessBoot = { at: now.toISOString(), kind, pid: process.pid, before: (prev?.value as MemorySample | undefined) ?? null };
  const boots = [boot, ...(await processBoots(db))].slice(0, PROCESS_HEALTH.keepBoots);
  await db.insert(jobState).values({ key: BOOTS, value: { boots } }).onConflictDoUpdate({ target: jobState.key, set: { value: { boots }, updatedAt: now } });
  return boot;
}

export async function recordSample(db: DbOrTx, kind: ProcessKind, now = new Date()) {
  const value = memorySample(now);
  await db.insert(jobState).values({ key: sampleKey(kind), value }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: now } });
}

export async function processBoots(db: DbOrTx): Promise<ProcessBoot[]> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, BOOTS));
  return ((row?.value as { boots?: ProcessBoot[] } | undefined)?.boots ?? []);
}

/** Was the process before this start probably killed for memory? (its last sample near the limit) */
export const nearMemoryLimit = (boot: ProcessBoot) => !!boot.before && boot.before.rssMb >= PROCESS_HEALTH.memoryMaxMb[boot.kind] * 0.85;

const g = globalThis as unknown as { tvWatch?: boolean };

/**
 * Once per process: the start, a memory sample every minute, and errors nobody caught (kept in
 * the server error log). An uncaught error is logged and the process keeps serving — before,
 * it ended it, and every player saw 502 until systemd started it again.
 */
export function watchProcess(db: () => DbOrTx, kind: ProcessKind) {
  if (g.tvWatch) return;
  g.tvWatch = true;
  void recordBoot(db(), kind).catch(() => {});
  const timer = setInterval(() => void recordSample(db(), kind).catch(() => {}), PROCESS_HEALTH.sampleMs);
  timer.unref();
  process.on('uncaughtException', (error) => {
    console.error(`[${kind}] uncaught exception`, error);
    void recordServerError(`${kind}: uncaughtException`, error, db());
  });
  process.on('unhandledRejection', (reason) => {
    console.error(`[${kind}] unhandled rejection`, reason);
    void recordServerError(`${kind}: unhandledRejection`, reason, db());
  });
}
