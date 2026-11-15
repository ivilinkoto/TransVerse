import { afterAll, describe, expect, it } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { closeDb, getDb } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { memorySample, nearMemoryLimit, PROCESS_HEALTH, processBoots, recordBoot, recordSample } from '@/server/process-health';

const db = () => getDb();

afterAll(async () => {
  await db().delete(jobState).where(like(jobState.key, 'process-%'));
  await closeDb();
});

describe('restarts of the server (the 502s)', () => {
  it('records each start with the memory of the process before it', async () => {
    await db().delete(jobState).where(like(jobState.key, 'process-%'));
    const first = await recordBoot(db(), 'web', new Date('2026-11-14T10:00:00Z'));
    expect(first.before).toBeNull();
    await recordSample(db(), 'web', new Date('2026-11-14T10:05:00Z'));
    const second = await recordBoot(db(), 'web', new Date('2026-11-14T10:06:00Z'));
    expect(second.before?.at).toBe('2026-11-14T10:05:00.000Z');
    expect(second.before!.rssMb).toBeGreaterThan(0);
    const boots = await processBoots(db());
    expect(boots.map((b) => b.at)).toEqual(['2026-11-14T10:06:00.000Z', '2026-11-14T10:00:00.000Z']);
  });

  it('keeps a short list', async () => {
    for (let i = 0; i < PROCESS_HEALTH.keepBoots + 5; i++) await recordBoot(db(), 'worker', new Date(Date.UTC(2026, 10, 14, 11, i)));
    expect((await processBoots(db())).length).toBe(PROCESS_HEALTH.keepBoots);
    const [sample] = await db().select().from(jobState).where(eq(jobState.key, 'process-sample:worker'));
    expect(sample).toBeUndefined();
  });

  it('tells a stop near the memory limit', () => {
    const at = new Date().toISOString();
    expect(nearMemoryLimit({ at, kind: 'web', pid: 1, before: { at, rssMb: 880, heapMb: 600, uptimeS: 3600 } })).toBe(true);
    expect(nearMemoryLimit({ at, kind: 'web', pid: 1, before: { at, rssMb: 300, heapMb: 120, uptimeS: 3600 } })).toBe(false);
    expect(nearMemoryLimit({ at, kind: 'web', pid: 1, before: null })).toBe(false);
    expect(memorySample().rssMb).toBeGreaterThan(0);
  });
});
