import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { REPORTS } from '@/lib/game/live-road';
import { closeDb } from '@/server/db/client';
import { companies, vehicles } from '@/server/db/schema';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { activeReports, cbFeed, createReport, sendCb, trucksOnRoad, voteReport } from '@/server/game/live-road';
import { cityByName, db, grantLicences, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

/** A player with a truck on the road out of `from` (towards `to`). */
async function onRoad(from: string, to: string) {
  const p = await newPlayer();
  await grantLicences(p.userId, 'international', 'customs');
  const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
  const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
  await db().update(vehicles).set({ cityId: (await cityByName(from)).id }).where(eq(vehicles.id, truck!.id));
  await acceptContract(db(), p.userId, (await makeContract(from, to)).id, truck!.id);
  return p;
}

describe('v1.8 the road talks', () => {
  it('CB radio: heard near the truck, not far away; only from a truck on the road', async () => {
    const [a, b, far] = [await onRoad('Sofia', 'Plovdiv'), await onRoad('Sofia', 'Varna'), await onRoad('Munich', 'Vienna')];
    const idle = await newPlayer();
    expect(await code(sendCb(db(), idle.userId, 'Ехо?'))).toBe('not_on_road');
    expect((await trucksOnRoad(db(), a.userId, new Date())).length).toBe(1);
    const sent = await sendCb(db(), a.userId, 'Внимание, опашка на изхода на София');
    expect(sent.near).toBeTruthy();
    expect((await cbFeed(db(), b.userId)).messages.map((m) => m.body)).toContain('Внимание, опашка на изхода на София');
    expect((await cbFeed(db(), far.userId)).messages.map((m) => m.body)).not.toContain('Внимание, опашка на изхода на София');
    expect((await cbFeed(db(), idle.userId)).onRoad).toBe(false);
  });

  it('road reports: confirmed by drivers nearby earn reputation, not twice; no own vote, no far vote', async () => {
    const reporter = await onRoad('Plovdiv', 'Sofia');
    const voters = [await onRoad('Plovdiv', 'Burgas'), await onRoad('Plovdiv', 'Stara Zagora'), await onRoad('Plovdiv', 'Haskovo')];
    const far = await onRoad('Munich', 'Vienna');
    const rep0 = (await db().select().from(companies).where(eq(companies.ownerId, reporter.userId)))[0]!.reputation;
    const r = await createReport(db(), reporter.userId, 'police');
    expect(await code(createReport(db(), reporter.userId, 'jam'))).toBe('too_soon');
    expect(await code(voteReport(db(), reporter.userId, r.id, 1))).toBe('own_report');
    expect(await code(voteReport(db(), far.userId, r.id, 1))).toBe('too_far');
    for (const v of voters) await voteReport(db(), v.userId, r.id, 1);
    expect(await code(voteReport(db(), voters[0]!.userId, r.id, 1))).toBe('already_voted');
    const rep1 = (await db().select().from(companies).where(eq(companies.ownerId, reporter.userId)))[0]!.reputation;
    expect(rep1).toBe(Math.min(100, rep0 + REPORTS.reputation));
    const shown = (await activeReports(db(), new Date(), voters[0]!.userId)).find((x) => x.id === r.id);
    expect(shown).toMatchObject({ kind: 'police', confirms: 3, voted: true });
  });
});
