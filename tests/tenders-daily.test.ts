import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { DAILY_REWARDS, dailyState, dayKey, yesterdayKey } from '@/lib/game/daily';
import { tenderHours, tenderMoney } from '@/lib/game/tenders';
import { closeDb } from '@/server/db/client';
import { companies, companyTenders, contracts, jobState, notifications, organizations, treasuryEntries, users, vehicles } from '@/server/db/schema';
import { openContracts } from '@/server/game/contracts';
import { claimDaily, dailyReminders } from '@/server/game/daily';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { post } from '@/server/game/finance';
import { depositToTreasury, joinCompany, updateSettings } from '@/server/game/membership';
import { acceptTender, ensureTenderOffers, settleTenders, tenderBoard } from '@/server/game/tenders';
import { getRoute } from '@/server/geo/route-service';
import { approximateProvider } from '@/server/geo/routing';
import { cityByName, db, newPlayer, playerWithCompany } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (companyId: string) => (await db().select().from(vehicles).where(and(eq(vehicles.companyId, companyId), sql`${vehicles.soldAt} is null`)))[0]!;
const fund = (companyId: string, cents: number, key: string) => db().transaction((tx) => post(tx, companyId, [{ category: 'admin_adjustment', amountCents: cents, description: 'test', idempotencyKey: key }]));

/** A small, predictable tender: two 1-tonne pallet loads Sofia → Plovdiv. */
async function smallOffer(companyId: string) {
  const sofia = await cityByName('Sofia');
  const plovdiv = await cityByName('Plovdiv');
  const route = await getRoute(db(), sofia.id, plovdiv.id, 'truck', approximateProvider);
  const [offer] = await db().select().from(companyTenders).where(and(eq(companyTenders.companyId, companyId), eq(companyTenders.status, 'offer')));
  await db()
    .update(companyTenders)
    .set({ cargoType: 'pallets', loadTons: 1, loads: 2, originCityId: sofia.id, destCityId: plovdiv.id, routeId: route.id, distanceKm: route.distanceKm, ...tenderMoney(2, 500_00), rewardPerLoadCents: 500_00, durationHours: 24 })
    .where(eq(companyTenders.id, offer!.id));
  return (await db().select().from(companyTenders).where(eq(companyTenders.id, offer!.id)))[0]!;
}

describe('tender rules', () => {
  it('sizes money and time sensibly', () => {
    const m = tenderMoney(10, 2_000_00);
    expect(m.bonusCents).toBe(10_000_00);
    expect(m.depositCents).toBe(2_000_00);
    expect(m.xp).toBe(1_200);
    expect(tenderHours(10, 60, 1)).toBeGreaterThan(tenderHours(10, 60, 6));
    expect(tenderHours(1, 10, 20)).toBe(12);
  });
});

describe('company tenders', () => {
  it('members deliver every load: the treasury gets the bonus and the deposit back', async () => {
    const owner = await playerWithCompany('Sofia');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const driver = await newPlayer('Sofia');
    await joinCompany(db(), driver.userId, org!.id);
    const outsider = await newPlayer('Sofia');

    await ensureTenderOffers(db(), org!.id, new Date(), approximateProvider);
    const board = await tenderBoard(db(), org!.id);
    expect(board.offers.length).toBe(3);
    const offer = await smallOffer(org!.id);

    expect(await code(acceptTender(db(), driver.userId, offer.id))).toBe('forbidden');
    expect(await code(acceptTender(db(), owner.userId, offer.id))).toBe('insufficient_treasury');
    await fund((await accountOf(owner.userId)).id, 5_000_00, `tender-fund:${owner.userId}`);
    await depositToTreasury(db(), owner.userId, 5_000);
    await acceptTender(db(), owner.userId, offer.id);
    expect(await code(acceptTender(db(), owner.userId, offer.id))).toBe('tender_unavailable');

    const loads = await db().select().from(contracts).where(eq(contracts.tenderId, offer.id));
    expect(loads).toHaveLength(2);
    // Only the members see the loads.
    expect((await openContracts(db(), { originCityId: offer.originCityId, limit: 300 })).some((c) => c.tenderId === offer.id)).toBe(false);
    expect((await openContracts(db(), { originCityId: offer.originCityId, limit: 300, memberOfCompanyId: org!.id })).filter((c) => c.tenderId === offer.id)).toHaveLength(2);
    expect(await code(acceptContract(db(), outsider.userId, loads[0]!.id, (await truckOf((await accountOf(outsider.userId)).id)).id))).toBe('tender_members_only');

    const treasuryBefore = (await db().select().from(organizations).where(eq(organizations.id, org!.id)))[0]!;
    for (const [i, who] of [owner, driver].entries()) {
      const d = await acceptContract(db(), who.userId, loads[i]!.id, (await truckOf((await accountOf(who.userId)).id)).id);
      await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000));
    }
    const [done] = await db().select().from(companyTenders).where(eq(companyTenders.id, offer.id));
    expect(done).toMatchObject({ status: 'completed', deliveredLoads: 2 });
    expect(Object.keys(done!.drivers)).toHaveLength(2);
    const paid = await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, org!.id), eq(treasuryEntries.refId, offer.id)));
    expect(paid.map((p) => p.amountCents).sort((a, b) => a - b)).toEqual([-offer.depositCents, offer.depositCents, offer.bonusCents].sort((a, b) => a - b));
    const after = (await db().select().from(organizations).where(eq(organizations.id, org!.id)))[0]!;
    expect(after.companyXp).toBeGreaterThanOrEqual(treasuryBefore.companyXp + offer.xp);
  });

  it('a tender past its deadline fails: the deposit is lost and the loads are withdrawn', async () => {
    const owner = await playerWithCompany('Varna');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await ensureTenderOffers(db(), org!.id, new Date(), approximateProvider);
    const offer = await smallOffer(org!.id);
    await fund((await accountOf(owner.userId)).id, 5_000_00, `tender-fund:${owner.userId}`);
    await depositToTreasury(db(), owner.userId, 5_000);
    await acceptTender(db(), owner.userId, offer.id);
    await db().update(companyTenders).set({ deadlineAt: new Date(Date.now() - 1000) }).where(eq(companyTenders.id, offer.id));
    expect(await settleTenders(db(), new Date())).toBeGreaterThanOrEqual(1);
    const [t] = await db().select().from(companyTenders).where(eq(companyTenders.id, offer.id));
    expect(t!.status).toBe('failed');
    const open = await db().select().from(contracts).where(and(eq(contracts.tenderId, offer.id), eq(contracts.status, 'open')));
    expect(open).toHaveLength(0);
    const back = await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.refId, offer.id), sql`${treasuryEntries.amountCents} > 0`));
    expect(back).toHaveLength(0);
  });
});

describe('daily reward', () => {
  it('builds a 7-day streak in Bulgarian days and starts over after a missed day', () => {
    const now = new Date('2026-10-17T10:00:00Z');
    expect(dayKey(now)).toBe('D2026-10-17');
    expect(yesterdayKey(now)).toBe('D2026-10-16');
    expect(dailyState(0, null, now)).toMatchObject({ claimedToday: false, cycleDay: 1, nextStreak: 1 });
    expect(dailyState(3, 'D2026-10-16', now)).toMatchObject({ cycleDay: 4, nextStreak: 4, streak: 3 });
    expect(dailyState(3, 'D2026-10-15', now)).toMatchObject({ cycleDay: 1, nextStreak: 1, streak: 0 });
    expect(dailyState(7, 'D2026-10-16', now)).toMatchObject({ cycleDay: 1, nextStreak: 8 });
    expect(dailyState(4, 'D2026-10-17', now)).toMatchObject({ claimedToday: true, cycleDay: 4 });
  });

  it('pays once a day; day 7 brings ТрансКоин; the evening reminder protects the streak', async () => {
    const p = await newPlayer();
    const account = await accountOf(p.userId);
    const before = account.balanceCents;
    const r = await claimDaily(db(), p.userId);
    expect(r).toMatchObject({ cycleDay: 1, streak: 1 });
    expect((await accountOf(p.userId)).balanceCents).toBe(before + DAILY_REWARDS[0]!.cents);
    expect(await code(claimDaily(db(), p.userId))).toBe('already_claimed');

    await db().update(users).set({ loginStreak: 6, dailyClaimKey: yesterdayKey(new Date()) }).where(eq(users.id, p.userId));
    const seventh = await claimDaily(db(), p.userId);
    expect(seventh).toMatchObject({ cycleDay: 7, coins: 25, streak: 7 });
    expect((await db().select().from(users).where(eq(users.id, p.userId)))[0]!.coins).toBe(25);

    // Reminder at 20:00 Sofia for someone about to lose a 3-day streak.
    const evening = new Date('2026-10-17T17:00:00Z');
    const q = await newPlayer();
    await db().update(users).set({ loginStreak: 3, dailyClaimKey: yesterdayKey(evening), lastSeenAt: evening }).where(eq(users.id, q.userId));
    await db().delete(jobState).where(eq(jobState.key, 'daily-reminder'));
    expect(await dailyReminders(db(), new Date('2026-10-17T12:00:00Z'))).toBe(0); // too early (15:00 Sofia)
    expect(await dailyReminders(db(), evening)).toBeGreaterThanOrEqual(1);
    expect(await dailyReminders(db(), evening)).toBe(0); // once a day
    const [note] = await db().select().from(notifications).where(and(eq(notifications.userId, q.userId), sql`${notifications.title} like 'Не губи серията%'`));
    expect(note).toBeDefined();
    expect(await db().select().from(users).where(and(eq(users.id, q.userId), isNotNull(users.dailyClaimKey)))).toHaveLength(1);
  });
});
