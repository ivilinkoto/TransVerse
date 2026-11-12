import { eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { releaseAdoption } from '@/server/admin-adoption';
import { closeDb } from '@/server/db/client';
import { jobState, users } from '@/server/db/schema';
import { db, newPlayer } from './helpers';

afterAll(closeDb);

const count = (a: Awaited<ReturnType<typeof releaseAdoption>>, id: string) => a.rows.find((r) => r.id === id)!.players;

/** After 1.3, the team's „Как се играе 1.3“: players per new system, from what job_state already holds. */
describe('1.3 adoption (admin)', () => {
  it('counts distinct players per system, without the staff', async () => {
    const now = new Date();
    const before = await releaseAdoption(db(), now);
    const p = await newPlayer();
    const q = await newPlayer();
    const staff = await newPlayer();
    await db().update(users).set({ role: 'admin' }).where(eq(users.id, staff.userId));
    const tag = Date.now().toString(36);
    await db().insert(jobState).values([
      { key: `night-run:2099-01-02:${p.userId}`, value: {} },
      { key: `night-run:2099-01-01:${p.userId}`, value: {} },
      { key: `night-run:2099-01-01:${q.userId}`, value: {} },
      { key: `night-run:2099-01-01:${staff.userId}`, value: {} },
      { key: `mascot:${p.userId}`, value: {} },
      { key: `mascot:${staff.userId}`, value: {} },
      { key: `bus-line:test-${tag}`, value: { ownerId: q.userId } },
    ]).onConflictDoNothing();
    const after = await releaseAdoption(db(), now);
    expect(count(after, 'night_run') - count(before, 'night_run')).toBe(2);
    expect(count(after, 'mascot') - count(before, 'mascot')).toBe(1);
    expect(count(after, 'bus_lines') - count(before, 'bus_lines')).toBe(1);
    expect(after.busLines - before.busLines).toBe(1);
    expect(after.nightRun.find((d) => d.day === '2099-01-01')?.players).toBe(2);
    expect(after.rows.map((r) => r.players)).toEqual([...after.rows.map((r) => r.players)].sort((a, b) => b - a));
    // The bus line here is not a whole BusLine: leave nothing for the bus tests to read.
    await db().delete(jobState).where(like(jobState.key, `bus-line:test-${tag}`));
    await db().delete(jobState).where(like(jobState.key, 'night-run:2099-%'));
  });
});
