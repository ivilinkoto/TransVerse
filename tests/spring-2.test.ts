import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { hasWinterGrip } from '@/lib/game/catalog';
import { EASTER, isEaster } from '@/lib/game/easter';
import { CARGO_INSURANCE } from '@/lib/game/roads';
import { closeDb } from '@/server/db/client';
import { companies, contracts, deliveries, ledgerEntries, userBadges, users, vehicles } from '@/server/db/schema';
import { raiseUrgentPrices, URGENT_RAISE } from '@/server/game/auto-urgent';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { eggFight } from '@/server/game/easter';
import { GameError } from '@/server/game/errors';
import { buyVehicle, installUpgrade } from '@/server/game/fleet';
import { respondFriendRequest, sendFriendRequest } from '@/server/game/social';
import { tachograph } from '@/server/game/tachograph';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const EASTER_DAY = new Date('2027-05-01T10:00:00Z');

describe('Великден', () => {
  it('egg fights between friends: once a year, coins for the winner, a badge after five wins', async () => {
    expect(isEaster(EASTER_DAY)).toBe(true);
    expect(isEaster(new Date('2027-06-01T10:00:00Z'))).toBe(false);
    const me = await newPlayer();
    const friends = [];
    for (let i = 0; i < EASTER.eggBadgeWins; i++) {
      const f = await newPlayer();
      await sendFriendRequest(db(), me.userId, f.userId);
      const { rows } = await db().execute<{ id: string }>(sql`select id from friendships where requester_id = ${me.userId} and addressee_id = ${f.userId}`);
      await respondFriendRequest(db(), f.userId, rows[0]!.id, true);
      friends.push(f);
    }
    const coins0 = (await db().select().from(users).where(eq(users.id, me.userId)))[0]!.coins;
    for (const f of friends) expect((await eggFight(db(), me.userId, f.userId, EASTER_DAY, () => 0)).won).toBe(true);
    expect(await code(eggFight(db(), friends[0]!.userId, me.userId, EASTER_DAY))).toBe('already');
    expect((await db().select().from(users).where(eq(users.id, me.userId)))[0]!.coins).toBe(coins0 + EASTER.eggCoins * EASTER.eggBadgeWins);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, me.userId), eq(userBadges.badge, EASTER.eggBadge)))).toHaveLength(1);
  });
});

describe('the road in v1.5, part 2', () => {
  it('one tyre set at a time; all-season tyres grip on snow', async () => {
    const p = await playerWithCompany('Sofia');
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    await db().update(companies).set({ balanceCents: 1_000_000_00 }).where(eq(companies.id, acc!.id));
    await db().update(users).set({ level: 5, xp: 999_999 }).where(eq(users.id, p.userId));
    const t = await buyVehicle(db(), p.userId, 'danubia-t440', p.hq.id);
    await installUpgrade(db(), p.userId, t.id, 'winter_tyres');
    await installUpgrade(db(), p.userId, t.id, 'eco_tune');
    await installUpgrade(db(), p.userId, t.id, 'all_season_tyres');
    const [v] = await db().select().from(vehicles).where(eq(vehicles.id, t.id));
    expect(v!.upgrades.sort()).toEqual(['all_season_tyres', 'eco_tune']);
    expect(hasWinterGrip(v!.upgrades)).toBe(true);
    expect(hasWinterGrip(['summer_tyres'])).toBe(false);
  });

  it('cargo insurance: a premium, most of a late penalty back', async () => {
    const p = await playerWithCompany('Sofia');
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    const c = await makeContract('Sofia', 'Plovdiv', { windowMinutes: 1 });
    await acceptContract(db(), p.userId, c.id, truck!.id, new Date(), { insure: true });
    const [d] = await db().select().from(deliveries).where(eq(deliveries.contractId, c.id));
    expect((d!.estimatedCosts as { cargoInsuranceCents: number }).cargoInsuranceCents).toBe(Math.round(c.rewardCents * CARGO_INSURANCE.premiumShare));
    await settleDueDeliveries(db(), new Date(d!.etaAt.getTime() + 1000));
    const rows = await db().select().from(ledgerEntries).where(eq(ledgerEntries.companyId, acc!.id));
    const penalty = rows.find((r) => r.category === 'penalty');
    const payout = rows.find((r) => r.category === 'insurance_payout');
    expect(penalty).toBeTruthy();
    expect(payout!.amountCents).toBe(Math.round(-penalty!.amountCents * CARGO_INSURANCE.covers));
  });

  it('an urgent shipment nobody takes gets better paid', async () => {
    const now = new Date();
    const c = await makeContract('Sofia', 'Plovdiv', { urgent: true, rewardCents: 100_000, createdAt: new Date(now.getTime() - (URGENT_RAISE.everyMin * 2 + 1) * 60_000) });
    await raiseUrgentPrices(db(), now);
    const [row] = await db().select().from(contracts).where(eq(contracts.id, c.id));
    expect(row!.urgentRaises).toBe(2);
    expect(row!.rewardCents).toBe(120_000);
    await raiseUrgentPrices(db(), now);
    expect((await db().select().from(contracts).where(eq(contracts.id, c.id)))[0]!.rewardCents).toBe(120_000);
  });

  it('the tachograph sums driving by day', async () => {
    const p = await playerWithCompany('Sofia');
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    const c = await makeContract('Sofia', 'Plovdiv');
    await acceptContract(db(), p.userId, c.id, truck!.id);
    const [d] = await db().select().from(deliveries).where(eq(deliveries.contractId, c.id));
    const log = await tachograph(db(), d!.driverId!, new Date(d!.etaAt.getTime() + 1000));
    expect(log[0]!.trips).toBe(1);
    expect(log[0]!.driveMin).toBeGreaterThan(0);
  });
});
