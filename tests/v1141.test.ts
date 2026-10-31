import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));

import { BIG_RUN, pickBigRun } from '@/lib/game/big-run';
import { FEATURES, liveFeatures } from '@/lib/game/features';
import { compareVersions, releaseByVersion } from '@/lib/game/releases';
import { coreTabs, SECTIONS, visibleTabs } from '@/components/game/nav';
import { dailyActivity, missingPlayers, retentionCohorts, winBack } from '@/server/admin-retention';
import { closeDb } from '@/server/db/client';
import { coinEntries, companies, contracts, deliveries, jobState, notifications, tripQueue, userBadges, users, vehicles } from '@/server/db/schema';
import { disabledFeatures, setFeatureOff, withSwitches } from '@/server/feature-switches';
import { runAction } from '@/server/game/actions';
import { bigRunOf, bigRunProgress, recordBigRunDelivery } from '@/server/game/big-run';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { rivalAlerts, rivalStanding } from '@/server/game/rival';
import { queueTrip, queuedTrips, runTripQueues } from '@/server/game/trip-queue';
import { welcomeBack } from '@/server/game/welcome-back';
import { bestTripOfWeek } from '@/server/game/weekly-card';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const account = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (companyId: string) => (await db().select().from(vehicles).where(eq(vehicles.companyId, companyId)))[0]!;
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));

describe('v1.1.4.1 „По-просто“', () => {
  it('ships as its own release before 1.2, with its features', () => {
    const r = releaseByVersion('1.1.4.1')!;
    expect(r.name).toBe('По-просто');
    expect(new Date(r.publishedAt) < new Date(releaseByVersion('1.2')!.publishedAt)).toBe(true);
    expect(compareVersions('1.1.4.1', '1.1.4')).toBe(1);
    // Out today, after 1.1.4.
    expect(new Date(r.publishedAt) > new Date(releaseByVersion('1.1.4')!.publishedAt)).toBe(true);
    expect(r.publishedAt.startsWith('2026-10-31')).toBe(true);
    for (const f of ['simple_ui', 'welcome_back', 'trip_queue', 'big_run', 'rival', 'weekly_card', 'discord_game_menu'] as const) expect(FEATURES[f]).toBe('1.1.4.1');
  });

  it('the row of a section keeps a few main pages; the rest go behind „Още“', () => {
    const compete = SECTIONS.find((s) => s.key === 'compete')!;
    const core = coreTabs(visibleTabs(compete, null, '/game/missions'), '/game/missions');
    expect(core.length).toBeLessThanOrEqual(8);
    expect(core.length).toBeLessThan(compete.tabs!.length);
    // The open page is always in the row.
    expect(coreTabs(visibleTabs(compete, null, '/game/rally'), '/game/rally').some((t) => t.href === '/game/rally')).toBe(true);
  });

  it('„Докато те нямаше“: what the trucks did while the player was away, only after 6 hours', async () => {
    const p = await newPlayer();
    const acc = await account(p.userId);
    const truck = await truckOf(acc.id);
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv')).id, truck.id);
    const now = new Date();
    await db().update(deliveries).set({ status: 'completed', completedAt: now, payoutCents: 300_00 }).where(eq(deliveries.id, d.id));
    expect(await welcomeBack(db(), acc.id, p.userId, new Date(now.getTime() - 3_600_000), now)).toBeNull();
    const back = await welcomeBack(db(), acc.id, p.userId, new Date(now.getTime() - 8 * 3_600_000), now);
    expect(back).toMatchObject({ trips: 1, earnedCents: 300_00, hours: 8 });
  });

  it('a trip queued after the current one starts by itself; a taken load is skipped', async () => {
    const p = await newPlayer();
    const acc = await account(p.userId);
    const truck = await truckOf(acc.id);
    const first = await makeContract('Sofia', 'Plovdiv');
    expect(await code(queueTrip(db(), p.userId, truck.id, first.id))).toBe('vehicle_free');
    const d = await acceptContract(db(), p.userId, first.id, truck.id);
    const gone = await makeContract('Plovdiv', 'Sofia');
    const next = await makeContract('Plovdiv', 'Stara Zagora');
    expect((await queueTrip(db(), p.userId, truck.id, gone.id)).position).toBe(1);
    expect((await queueTrip(db(), p.userId, truck.id, next.id)).position).toBe(2);
    expect(await code(queueTrip(db(), p.userId, truck.id, next.id))).toBe('already_queued');
    expect(await queuedTrips(db(), acc.id)).toHaveLength(2);
    // Someone else took the first queued load; the truck arrives.
    await db().update(contracts).set({ status: 'accepted' }).where(eq(contracts.id, gone.id));
    await db().update(deliveries).set({ status: 'completed', completedAt: new Date() }).where(eq(deliveries.id, d.id));
    await db().update(vehicles).set({ status: 'idle', cityId: next.originCityId, movingUntil: null }).where(eq(vehicles.id, truck.id));
    expect(await runTripQueues(db())).toBeGreaterThanOrEqual(1);
    const [onNext] = await db().select().from(deliveries).where(and(eq(deliveries.vehicleId, truck.id), eq(deliveries.contractId, next.id)));
    expect(onNext).toBeTruthy();
    expect(await db().select().from(tripQueue).where(eq(tripQueue.vehicleId, truck.id))).toHaveLength(0);
  });

  it('the big run: three legs, each in another country, the same all week; the last leg pays once', async () => {
    const cities = [
      { id: 1, nameBg: 'А', countryCode: 'BG', lat: 42.7, lon: 23.3 },
      { id: 2, nameBg: 'Б', countryCode: 'RO', lat: 44.4, lon: 26.1 },
      { id: 3, nameBg: 'В', countryCode: 'RS', lat: 44.8, lon: 20.5 },
      { id: 4, nameBg: 'Г', countryCode: 'HU', lat: 47.5, lon: 19.0 },
      { id: 5, nameBg: 'Д', countryCode: 'GR', lat: 40.6, lon: 22.9 },
    ];
    const legs = pickBigRun('W2026-11-02', cities);
    expect(legs).toHaveLength(BIG_RUN.legs);
    expect(pickBigRun('W2026-11-02', cities)).toEqual(legs);
    for (const l of legs) expect(l.from.countryCode).not.toBe(l.to.countryCode);

    const run = await bigRunOf(db());
    expect(run.legs).toHaveLength(BIG_RUN.legs);
    expect((await bigRunOf(db())).legs).toEqual(run.legs);
    const p = await newPlayer();
    const acc = await account(p.userId);
    const truck = await truckOf(acc.id);
    const since = new Date();
    const { routeId } = await makeContract('Sofia', 'Plovdiv');
    for (const leg of run.legs) {
      const [c] = await db().insert(contracts).values({ routeId, shipper: 'T', goods: 'Мебели', cargoType: 'pallets', weightTons: 5, originCityId: leg.from.id, destCityId: leg.to.id, distanceKm: 400, rewardCents: 1000_00, windowMinutes: 600, expiresAt: new Date(Date.now() + 3_600_000) }).returning();
      await db().insert(deliveries).values({ contractId: c!.id, companyId: acc.id, vehicleId: truck.id, routeId, status: 'completed', startedAt: since, etaAt: since, deadlineAt: since, completedAt: since, emptyKm: 0, loadedKm: 400, schedule: [], estimatedCosts: {} } as never);
    }
    expect((await bigRunProgress(db(), p.userId, run)).every(Boolean)).toBe(true);
    const last = run.legs.at(-1)!;
    expect(await db().transaction((tx) => recordBigRunDelivery(tx, p.userId, last.from.id, last.to.id, since))).toBe(true);
    expect(await db().transaction((tx) => recordBigRunDelivery(tx, p.userId, last.from.id, last.to.id, since))).toBe(false);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, BIG_RUN.badge)))).toHaveLength(1);
    expect((await db().select().from(coinEntries).where(eq(coinEntries.userId, p.userId))).filter((e) => e.reason === 'big_run')).toHaveLength(1);
  });

  it('a rival of about the same level; a notification when the lead changes', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const seen = new Date();
    await db().update(users).set({ level: 33, lastSeenAt: seen }).where(eq(users.id, a.userId));
    await db().update(users).set({ level: 34, lastSeenAt: seen }).where(eq(users.id, b.userId));
    const standing = await rivalStanding(db(), a.userId);
    expect(standing?.rival.id).toBe(b.userId);
    expect(standing).toMatchObject({ mine: 0, theirs: 0 });
    const bAcc = await account(b.userId);
    const bTruck = await truckOf(bAcc.id);
    const d = await acceptContract(db(), b.userId, (await makeContract('Sofia', 'Plovdiv')).id, bTruck.id);
    await db().update(deliveries).set({ status: 'completed', completedAt: new Date() }).where(eq(deliveries.id, d.id));
    await rivalAlerts(db());
    await rivalAlerts(db());
    const told = (await db().select().from(notifications).where(eq(notifications.userId, a.userId))).filter((n) => n.title.includes(b.username));
    expect(told).toHaveLength(1);
  });

  it('the trip of the week: the best paid on-time trip since Monday', async () => {
    const p = await newPlayer();
    const acc = await account(p.userId);
    const truck = await truckOf(acc.id);
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv')).id, truck.id);
    await db().update(deliveries).set({ status: 'completed', completedAt: new Date(), payoutCents: 900_00, late: false }).where(eq(deliveries.id, d.id));
    expect((await bestTripOfWeek(db(), p.userId))?.id).toBe(d.id);
  });

  it('a switched-off feature is off for players (pages and commands), not for the team', async () => {
    const admin = await newPlayer();
    await db().update(users).set({ role: 'admin' }).where(eq(users.id, admin.userId));
    const actor = { id: admin.userId, role: 'admin', username: admin.username };
    await expect(setFeatureOff(db(), { ...actor, role: 'support' }, 'depot_all', true)).rejects.toBeInstanceOf(GameError);
    await setFeatureOff(db(), actor, 'depot_all', true);
    const off = await disabledFeatures(db(), true);
    expect(off.has('depot_all')).toBe(true);
    expect(withSwitches(liveFeatures(new Date()), off, false).depot_all).toBe(false);
    expect(withSwitches(liveFeatures(new Date()), off, true).depot_all).toBe(true);
    const p = await newPlayer();
    expect(await code(runAction(db(), { id: p.userId, role: 'player', username: p.username }, { type: 'moveAllToDepot' }, async () => 'test'))).toBe('feature_off');
    await setFeatureOff(db(), actor, 'depot_all', false);
    expect((await disabledFeatures(db(), true)).has('depot_all')).toBe(false);
  });

  it('retention numbers and „Покани обратно“ once a month', async () => {
    const now = new Date();
    expect(Array.isArray(await retentionCohorts(db(), now))).toBe(true);
    expect((await dailyActivity(db(), now, 3)).length).toBeGreaterThanOrEqual(3);
    const gone = await newPlayer();
    await db().update(users).set({ lastSeenAt: new Date(now.getTime() - 5 * 86_400_000) }).where(eq(users.id, gone.userId));
    expect((await missingPlayers(db(), now, 500)).some((m) => m.id === gone.userId)).toBe(true);
    const staff = await newPlayer();
    await db().update(users).set({ role: 'support' }).where(eq(users.id, staff.userId));
    const actor = { id: staff.userId, role: 'support', username: staff.username };
    await winBack(db(), actor, gone.userId, now);
    await expect(winBack(db(), actor, gone.userId, now)).rejects.toBeInstanceOf(GameError);
    const [{ n }] = (await db().execute<{ n: number }>(sql`select count(*)::int as n from notifications where user_id = ${gone.userId}`)).rows as [{ n: number }];
    expect(n).toBeGreaterThan(0);
    await db().delete(jobState).where(eq(jobState.key, 'features:off'));
  });
});
