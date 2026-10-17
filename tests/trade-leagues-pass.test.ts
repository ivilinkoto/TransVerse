import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { demoteCount, leaguePrize, outcomeFor, promoteCount, weekEndsAt, weekKey } from '@/lib/game/leagues';
import { PASS_POINTS_PER_LEVEL, PASS_PRICE_COINS, PASS_REWARDS, passLevel } from '@/lib/game/season-pass';
import { buyPriceCents, sellPriceCents, warehouseCapacityTons } from '@/lib/game/trade';
import { closeDb } from '@/server/db/client';
import { cityMarkets, companies, contracts, deliveries, depots, ledgerEntries, leagueGroups, leagueMembers, reports, users, vehicles, warehouseStock } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyVehicle } from '@/server/game/fleet';
import { addLeaguePoints, leagueView, settleLeagues } from '@/server/game/leagues';
import { postToChannel, sendDirectMessage } from '@/server/game/messages';
import { blockUser, reportPlayer, resolveReport, unblockUser } from '@/server/game/moderation';
import { addPassPoints, buyPremiumPass, claimPassRewards, passView } from '@/server/game/season-pass';
import { sendFriendRequest } from '@/server/game/social';
import { buyGoods, shipGoods } from '@/server/game/trade';
import { cityByName, db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;

describe('league rules', () => {
  it('weeks run Monday to Monday, Sofia time', () => {
    // Sunday 23:30 Sofia (20:30 UTC in summer) is still the old week; Monday 00:30 Sofia is the new one.
    expect(weekKey(new Date('2026-10-18T20:30:00Z'))).toBe('W2026-10-12');
    expect(weekKey(new Date('2026-10-18T21:30:00Z'))).toBe('W2026-10-19');
    expect(weekEndsAt('W2026-10-12').toISOString()).toBe('2026-10-18T21:00:00.000Z');
    // Winter time (+2): the week of 26 Oct ends 1 Nov 22:00 UTC.
    expect(weekEndsAt('W2026-10-26').toISOString()).toBe('2026-11-01T22:00:00.000Z');
  });

  it('moves the best up and the last down, never above Diamond or below Bronze', () => {
    expect(promoteCount(20)).toBe(5);
    expect(demoteCount(20)).toBe(5);
    expect(demoteCount(3)).toBe(0);
    expect(outcomeFor(0, 1, 20)).toBe('up');
    expect(outcomeFor(0, 20, 20)).toBe('stay'); // Bronze cannot go down
    expect(outcomeFor(2, 20, 20)).toBe('down');
    expect(outcomeFor(4, 1, 20)).toBe('stay'); // Diamond is the top
    expect(leaguePrize(2, 1)).toEqual({ cents: 6_000_00, coins: 40 });
    expect(leaguePrize(0, 4)).toBeNull();
  });
});

describe('weekly leagues', () => {
  it('places players in groups on their first delivery and settles the week', async () => {
    const lastWeek = new Date(Date.now() - 7 * 86_400_000);
    const players = [];
    for (let i = 0; i < 5; i++) players.push(await newPlayer());
    // A fresh tier of their own so the group is just them: Silver.
    for (const p of players) await db().update(users).set({ leagueTier: 1 }).where(eq(users.id, p.userId));
    for (const [i, p] of players.entries()) await db().transaction((tx) => addLeaguePoints(tx, p.userId, (i + 1) * 100, lastWeek));
    await db().transaction((tx) => addLeaguePoints(tx, players[0]!.userId, 50, lastWeek));
    const [m0] = await db().select().from(leagueMembers).where(and(eq(leagueMembers.userId, players[0]!.userId), eq(leagueMembers.weekKey, weekKey(lastWeek))));
    expect(m0).toMatchObject({ points: 150, deliveries: 2, tier: 1 });
    const groupIds = new Set((await db().select().from(leagueMembers).where(eq(leagueMembers.weekKey, weekKey(lastWeek)))).filter((m) => players.some((p) => p.userId === m.userId)).map((m) => m.groupId));
    expect(groupIds.size).toBeGreaterThanOrEqual(1);

    expect(await settleLeagues(db())).toBeGreaterThanOrEqual(1);
    const best = players[4]!;
    const [after] = await db().select().from(users).where(eq(users.id, best.userId));
    const [bm] = await db().select().from(leagueMembers).where(and(eq(leagueMembers.userId, best.userId), eq(leagueMembers.weekKey, weekKey(lastWeek))));
    if (bm!.finalRank === 1) {
      expect(after!.leagueTier).toBe(2);
      expect(after!.coins).toBe(leaguePrize(1, 1)!.coins);
    }
    expect(await settleLeagues(db())).toBe(0);
    const [g] = await db().select().from(leagueGroups).where(eq(leagueGroups.id, bm!.groupId));
    expect(g!.settledAt).not.toBeNull();
    const view = await leagueView(db(), best.userId);
    expect(view.last?.finalRank).toBe(bm!.finalRank);
  });

  it('a delivery adds league and pass points', async () => {
    const p = await newPlayer();
    const account = await accountOf(p.userId);
    const [van] = await db().select().from(vehicles).where(eq(vehicles.companyId, account.id));
    const c = await makeContract('Sofia', 'Plovdiv');
    const { acceptContract } = await import('@/server/game/deliveries');
    const d = await acceptContract(db(), p.userId, c.id, van!.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account.id);
    const view = await leagueView(db(), p.userId);
    expect(view.joined).toBe(true);
    expect(view.members.find((m) => m.me)!.points).toBeGreaterThan(0);
    expect((await passView(db(), p.userId)).points).toBe(view.members.find((m) => m.me)!.points);
  });
});

describe('season pass', () => {
  it('free rewards, premium for ТрансКоин, each claimed once', async () => {
    expect(passLevel(PASS_POINTS_PER_LEVEL * 2 + 10)).toBe(2);
    const p = await newPlayer();
    await db().transaction((tx) => addPassPoints(tx, p.userId, PASS_POINTS_PER_LEVEL * 4));
    expect((await passView(db(), p.userId)).level).toBe(4);
    const before = (await accountOf(p.userId)).balanceCents;
    await claimPassRewards(db(), p.userId);
    const freeCents = PASS_REWARDS.slice(0, 4).reduce((s, r) => s + (r.free?.cents ?? 0), 0);
    expect((await accountOf(p.userId)).balanceCents).toBe(before + freeCents);
    expect(await code(claimPassRewards(db(), p.userId))).toBe('nothing_to_claim');

    expect(await code(buyPremiumPass(db(), p.userId))).toBe('insufficient_coins');
    await db().transaction((tx) => postCoins(tx, p.userId, { amount: PASS_PRICE_COINS, reason: 'admin_grant', description: 'test', idempotencyKey: `test-pass:${p.userId}` }));
    await buyPremiumPass(db(), p.userId);
    expect(await code(buyPremiumPass(db(), p.userId))).toBe('already_premium');
    const view = await passView(db(), p.userId);
    expect(view).toMatchObject({ premium: true, claimable: 4 });
    await claimPassRewards(db(), p.userId);
    const [u] = await db().select().from(users).where(eq(users.id, p.userId));
    expect(u!.coins).toBe(PASS_REWARDS.slice(0, 4).reduce((s, r) => s + (r.premium.coins ?? 0), 0));
  });
});

describe('trading', () => {
  it('prices follow the country, demand and the day', () => {
    const now = new Date('2026-10-17T10:00:00Z');
    const bg = { id: 1, countryCode: 'BG' };
    const de = { id: 2, countryCode: 'DE' };
    expect(buyPriceCents(bg, 'pallets', now)).toBeLessThan(sellPriceCents(de, 'pallets', 1, now));
    expect(sellPriceCents(de, 'pallets', 0.5, now)).toBeLessThan(sellPriceCents(de, 'pallets', 1, now));
    expect(buyPriceCents(bg, 'pallets', now)).toBe(buyPriceCents(bg, 'pallets', new Date('2026-10-17T20:00:00Z')));
    expect(warehouseCapacityTons(3)).toBe(45);
  });

  it('buy into the warehouse, haul with an own truck, sell on arrival', async () => {
    const p = await playerWithCompany('Sofia', 80_000_00);
    await buyVehicle(db(), p.userId, 'sokol-courier', p.hq.id);
    const account = await accountOf(p.userId);
    const [depot] = await db().select().from(depots).where(eq(depots.companyId, account.id));
    const sofia = await cityByName('Sofia');
    const plovdiv = await cityByName('Plovdiv');
    // Make sure Sofia produces and Plovdiv buys pallets in this test.
    await db().insert(cityMarkets).values({ cityId: sofia.id, cargoType: 'pallets', produces: true, consumes: false }).onConflictDoUpdate({ target: [cityMarkets.cityId, cityMarkets.cargoType], set: { produces: true } });
    await db().insert(cityMarkets).values({ cityId: plovdiv.id, cargoType: 'pallets', produces: false, consumes: true, demand: 1 }).onConflictDoUpdate({ target: [cityMarkets.cityId, cityMarkets.cargoType], set: { consumes: true, demand: 1 } });

    expect(await code(buyGoods(db(), p.userId, { depotId: depot!.id, cargo: 'pallets', tons: 999 }))).toBe('warehouse_full');
    const cost = await buyGoods(db(), p.userId, { depotId: depot!.id, cargo: 'pallets', tons: 1 });
    expect(cost).toBe(buyPriceCents(sofia, 'pallets', new Date()));
    const [stock] = await db().select().from(warehouseStock).where(eq(warehouseStock.depotId, depot!.id));
    expect(stock).toMatchObject({ tons: 1, costCents: cost });

    const van = (await db().select().from(vehicles).where(and(eq(vehicles.companyId, account.id), sql`${vehicles.soldAt} is null`))).find((v) => v.modelId === 'sokol-courier')!;
    expect(await code(shipGoods(db(), p.userId, { depotId: depot!.id, cargo: 'pallets', tons: 2, destCityId: plovdiv.id, vehicleId: van.id, mode: 'sell' }))).toBe('not_enough_stock');
    const d = await shipGoods(db(), p.userId, { depotId: depot!.id, cargo: 'pallets', tons: 1, destCityId: plovdiv.id, vehicleId: van.id, mode: 'sell' });
    expect(await db().select().from(warehouseStock).where(eq(warehouseStock.depotId, depot!.id))).toHaveLength(0);
    const [c] = await db().select().from(contracts).where(eq(contracts.id, d.contractId));
    expect(c).toMatchObject({ status: 'accepted', tradeCompanyId: account.id, rewardCents: 0 });
    // Never offered to anyone else.
    const { openContracts } = await import('@/server/game/contracts');
    expect((await openContracts(db(), { limit: 500 })).some((x) => x.id === c!.id)).toBe(false);

    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account.id);
    const [sale] = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, account.id), eq(ledgerEntries.category, 'trade_sale')));
    expect(sale!.amountCents).toBe(sellPriceCents(plovdiv, 'pallets', 1, d.etaAt));
    expect((await db().select().from(deliveries).where(eq(deliveries.id, d.id)))[0]!.status).toBe('completed');
  });

  it('a truck that cannot go puts the goods back', async () => {
    const p = await playerWithCompany('Varna', 10_000_00);
    const account = await accountOf(p.userId);
    const [depot] = await db().select().from(depots).where(eq(depots.companyId, account.id));
    const varna = await cityByName('Varna');
    await db().insert(cityMarkets).values({ cityId: varna.id, cargoType: 'bulk', produces: true, consumes: false }).onConflictDoUpdate({ target: [cityMarkets.cityId, cityMarkets.cargoType], set: { produces: true } });
    await buyGoods(db(), p.userId, { depotId: depot!.id, cargo: 'bulk', tons: 5 });
    const [van] = await db().select().from(vehicles).where(eq(vehicles.companyId, account.id));
    const sofia = await cityByName('Sofia');
    await db().insert(cityMarkets).values({ cityId: sofia.id, cargoType: 'bulk', produces: false, consumes: true }).onConflictDoUpdate({ target: [cityMarkets.cityId, cityMarkets.cargoType], set: { consumes: true } });
    // A van cannot carry bulk goods.
    expect(await code(shipGoods(db(), p.userId, { depotId: depot!.id, cargo: 'bulk', tons: 5, destCityId: sofia.id, vehicleId: van!.id, mode: 'sell' }))).toBe('incompatible');
    const [stock] = await db().select().from(warehouseStock).where(eq(warehouseStock.depotId, depot!.id));
    expect(stock!.tons).toBe(5);
  });
});

describe('blocking and reports', () => {
  it('blocked players cannot message, befriend or be seen; reports go to moderators', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await blockUser(db(), a.userId, b.userId);
    expect(await code(sendDirectMessage(db(), b.userId, a.userId, 'хей'))).toBe('blocked');
    expect(await code(sendDirectMessage(db(), a.userId, b.userId, 'хей'))).toBe('blocked');
    expect(await code(sendFriendRequest(db(), b.userId, a.userId))).toBe('blocked');
    await unblockUser(db(), a.userId, b.userId);
    expect(await code(sendDirectMessage(db(), b.userId, a.userId, 'хей'))).toBe('ok');

    const msg = await postToChannel(db(), b.userId, 'global', 'груба дума');
    const reportId = await reportPlayer(db(), a.userId, { targetUserId: b.userId, kind: 'channel', messageId: msg, reason: 'abuse' });
    const [r] = await db().select().from(reports).where(eq(reports.id, reportId));
    expect(r).toMatchObject({ snippet: 'груба дума', status: 'open' });
    expect(await code(reportPlayer(db(), a.userId, { targetUserId: a.userId, kind: 'player', reason: 'other' }))).toBe('self');

    const staff = await newPlayer();
    await resolveReport(db(), { id: staff.userId }, reportId, 'mute_h24');
    expect(await code(postToChannel(db(), b.userId, 'global', 'пак'))).toBe('muted');
    expect((await db().select().from(reports).where(eq(reports.id, reportId)))[0]!.status).toBe('resolved');
  });
});
