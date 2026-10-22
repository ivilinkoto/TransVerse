import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { loadedMinutes, RALLY, rallyRanking } from '@/lib/game/rally';
import { closeDb } from '@/server/db/client';
import { companies, contracts, ledgerEntries, rallies, rallyEntries } from '@/server/db/schema';
import { scheduledItems } from '@/server/discord/scheduled';
import { companyWeekReport } from '@/server/game/company-report';
import { openContracts } from '@/server/game/contracts';
import { GameError } from '@/server/game/errors';
import { activeRally, ensureRally, joinRally, rallyResults, settleRallies } from '@/server/game/rally';
import { approximateProvider } from '@/server/geo/routing';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));

describe('weekly rally', () => {
  it('rankings and the loaded leg', () => {
    const t = new Date();
    const rows = [
      { userId: 'a', minutes: 300, fuelCentsPer100: 9000, finishedAt: t },
      { userId: 'b', minutes: 280, fuelCentsPer100: 9500, finishedAt: t },
    ];
    expect(rallyRanking(rows, 'fastest')[0]!.userId).toBe('b');
    expect(rallyRanking(rows, 'eco')[0]!.userId).toBe('a');
    expect(loadedMinutes([{ leg: 'empty', start: 0, end: 60_000 }, { leg: 'loaded', start: 60_000, end: 61 * 60_000 }])).toBe(60);
  });

  it('one rally a week; each player runs it once; the load is private; prizes at the end', async () => {
    const now = new Date();
    await ensureRally(db(), now, approximateProvider);
    await ensureRally(db(), now, approximateProvider);
    const rally = (await activeRally(db()))!;
    expect(rally).not.toBeNull();
    expect(await db().select().from(rallies).where(eq(rallies.weekKey, rally.weekKey))).toHaveLength(1);
    expect(rally.distanceKm).toBeGreaterThan(RALLY.minKm * 0.5);

    const p = await playerWithCompany('Sofia');
    const other = await newPlayer('Sofia');
    const { contractId } = await joinRally(db(), p.userId, now);
    expect(await code(joinRally(db(), p.userId, now))).toBe('already_joined');
    const mine = await openContracts(db(), { originCityId: rally.originCityId, limit: 500, viewerUserId: p.userId }, now);
    expect(mine.some((c) => c.id === contractId)).toBe(true);
    const theirs = await openContracts(db(), { originCityId: rally.originCityId, limit: 500, viewerUserId: other.userId }, now);
    expect(theirs.some((c) => c.id === contractId)).toBe(false);

    // A finished run (as the delivery would record it), then the week ends.
    await db().update(rallyEntries).set({ minutes: 240, fuelCentsPer100: 8000, finishedAt: now }).where(and(eq(rallyEntries.rallyId, rally.id), eq(rallyEntries.userId, p.userId)));
    expect((await rallyResults(db(), rally.id)).fastest[0]!.userId).toBe(p.userId);
    expect((await scheduledItems(db(), now)).some((i) => i.key === `rally:${rally.id}`)).toBe(true);
    await db().update(rallies).set({ endsAt: new Date(now.getTime() - 1000) }).where(eq(rallies.id, rally.id));
    await settleRallies(db(), now);
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const prizes = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, account!.id), eq(ledgerEntries.category, 'rally_prize')));
    expect(prizes.map((e) => e.amountCents).sort()).toEqual([RALLY.prizes[0].cents, RALLY.prizes[0].cents]);
    expect((await db().select().from(contracts).where(eq(contracts.id, contractId)))[0]!.status).toBe('expired');
  });

  it('the weekly company report', async () => {
    const p = await playerWithCompany('Sofia');
    const { organizations } = await import('@/server/db/schema');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, p.userId));
    const r = await companyWeekReport(db(), org!.id, new Date(Date.now() - 7 * 86_400_000), new Date());
    expect(r!.trips).toBe(0);
    expect(r!.top).toEqual([]);
  });
});
