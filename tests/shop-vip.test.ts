import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { rentalFeeCents } from '@/lib/game/economy';
import { MISSION_REROLL_COINS } from '@/lib/game/missions';
import { adjustCoins, setVip } from '@/server/admin';
import { closeDb } from '@/server/db/client';
import { coinEntries, companies, contracts, missionProgress, users, vehicles } from '@/server/db/schema';
import { reserveContract } from '@/server/game/contracts';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyDepot, buyVehicle, fleetCapacity, repairVehicle } from '@/server/game/fleet';
import { missionBoard, rerollMission } from '@/server/game/missions';
import { buyShopItem } from '@/server/game/shop';
import { approximateProvider } from '@/server/geo/routing';
import { createUrgentContract } from '@/server/urgent';
import { cityByName, db, makeContract, newPlayer } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const userRow = async (id: string) => (await db().select().from(users).where(eq(users.id, id)))[0]!;
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (companyId: string) => (await db().select().from(vehicles).where(and(eq(vehicles.companyId, companyId), sql`${vehicles.soldAt} is null`)))[0]!;
const staff = async (role: 'admin' | 'support') => {
  const p = await newPlayer();
  await db().update(users).set({ role }).where(eq(users.id, p.userId));
  return { id: p.userId, role, username: p.username };
};
const DAY = 86_400_000;

describe('ТрансКоин', () => {
  it('only administrators give or take coins; every movement is in the ledger', async () => {
    const admin = await staff('admin');
    const support = await staff('support');
    const p = await newPlayer();
    expect(await code(adjustCoins(db(), support, p.userId, 100, 'тест'))).toBe('forbidden');
    await adjustCoins(db(), admin, p.userId, 300, 'награда от турнир');
    expect((await userRow(p.userId)).coins).toBe(300);
    expect(await code(adjustCoins(db(), admin, p.userId, -500, 'грешка'))).toBe('insufficient_coins');
    await adjustCoins(db(), admin, p.userId, -100, 'корекция');
    const entries = await db().select().from(coinEntries).where(eq(coinEntries.userId, p.userId)).orderBy(coinEntries.id);
    expect(entries.map((e) => [e.amount, e.balanceAfter])).toEqual([[300, 300], [-100, 200]]);
  });
});

describe('shop', () => {
  it('VIP purchases stack, gifts go to other players', async () => {
    const admin = await staff('admin');
    const p = await newPlayer();
    const friend = await newPlayer();
    expect(await code(buyShopItem(db(), p.userId, { item: 'vip_30' }))).toBe('insufficient_coins');
    await adjustCoins(db(), admin, p.userId, 1200, 'тест');
    const now = new Date();
    await buyShopItem(db(), p.userId, { item: 'vip_30' }, now);
    await buyShopItem(db(), p.userId, { item: 'vip_7' }, now);
    const u = await userRow(p.userId);
    expect(Math.round((u.vipUntil!.getTime() - now.getTime()) / DAY)).toBe(37);
    expect(u.coins).toBe(1200 - 500 - 150);
    expect(await code(buyShopItem(db(), p.userId, { item: 'gift_vip_30', recipient: p.username }))).toBe('gift_self');
    await buyShopItem(db(), p.userId, { item: 'gift_vip_30', recipient: friend.username.toUpperCase() }, now);
    expect(Math.round(((await userRow(friend.userId)).vipUntil!.getTime() - now.getTime()) / DAY)).toBe(30);
    expect((await userRow(p.userId)).coins).toBe(50);
  });

  it('truck services, plates, paint and renaming', async () => {
    const admin = await staff('admin');
    const p = await newPlayer('Sofia');
    await adjustCoins(db(), admin, p.userId, 2000, 'тест');
    const account = await accountOf(p.userId);
    const rented = await truckOf(account.id);
    expect(await code(buyShopItem(db(), p.userId, { item: 'custom_plate', vehicleId: rented.id, plate: 'TRANS 1' }))).toBe('rented');

    await db().update(companies).set({ balanceCents: 100_000_00 }).where(eq(companies.id, account.id));
    await buyDepot(db(), p.userId, p.hq.id);
    const own = await buyVehicle(db(), p.userId, 'sokol-courier', p.hq.id);
    await buyShopItem(db(), p.userId, { item: 'custom_plate', vehicleId: own.id, plate: 'trans 1' });
    expect((await db().select().from(vehicles).where(eq(vehicles.id, own.id)))[0]!.plate).toBe('TRANS 1');
    const other = await newPlayer();
    await adjustCoins(db(), admin, other.userId, 500, 'тест');
    const otherAccount = await accountOf(other.userId);
    await db().update(companies).set({ balanceCents: 100_000_00 }).where(eq(companies.id, otherAccount.id));
    await buyDepot(db(), other.userId, other.hq.id);
    const otherTruck = await buyVehicle(db(), other.userId, 'sokol-courier', other.hq.id);
    expect(await code(buyShopItem(db(), other.userId, { item: 'custom_plate', vehicleId: otherTruck.id, plate: 'TRANS 1' }))).toBe('plate_taken');

    // Paint: standard colours cost coins, VIP colours are VIP-only (and free for VIP).
    const before = (await userRow(p.userId)).coins;
    await buyShopItem(db(), p.userId, { item: 'paint', vehicleId: own.id, color: '#b91c1c' });
    expect((await userRow(p.userId)).coins).toBe(before - 50);
    expect(await code(buyShopItem(db(), p.userId, { item: 'paint', vehicleId: own.id, color: '#d4af37' }))).toBe('vip_only');
    await setVip(db(), admin, p.userId, 10);
    await buyShopItem(db(), p.userId, { item: 'paint', vehicleId: own.id, color: '#d4af37' });
    expect((await userRow(p.userId)).coins).toBe(before - 50);

    // Repair and relocation.
    await db().update(vehicles).set({ condition: 40 }).where(eq(vehicles.id, own.id));
    await buyShopItem(db(), p.userId, { item: 'instant_repair', vehicleId: own.id });
    expect((await db().select().from(vehicles).where(eq(vehicles.id, own.id)))[0]!.condition).toBe(100);
    const varna = await cityByName('Varna');
    await buyShopItem(db(), p.userId, { item: 'instant_relocate', vehicleId: rented.id, cityId: varna.id });
    expect((await db().select().from(vehicles).where(eq(vehicles.id, rented.id)))[0]!.cityId).toBe(varna.id);

    // Renaming.
    expect(await code(buyShopItem(db(), p.userId, { item: 'rename', username: other.username }))).toBe('username_taken');
    const name = `нов_${Date.now().toString(36)}`.slice(0, 20);
    await buyShopItem(db(), p.userId, { item: 'rename', username: name });
    expect((await userRow(p.userId)).username).toBe(name);
  });

  it('the x2 XP booster doubles delivery XP', async () => {
    const admin = await staff('admin');
    const plain = await newPlayer('Sofia');
    const boosted = await newPlayer('Sofia');
    await adjustCoins(db(), admin, boosted.userId, 200, 'тест');
    await buyShopItem(db(), boosted.userId, { item: 'xp_boost_24h' });
    const xp = async (p: { userId: string }) => {
      const c = await makeContract('Sofia', 'Plovdiv', { weightTons: 1 });
      const d = await acceptContract(db(), p.userId, c.id, (await truckOf((await accountOf(p.userId)).id)).id);
      await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000));
      return (await db().execute(sql`select xp_awarded from deliveries where id = ${d.id}`)).rows[0]!.xp_awarded as number;
    };
    const base = await xp(plain);
    expect(await xp(boosted)).toBe(base * 2);
  });
});

describe('VIP perks', () => {
  it('extra depot place, garage discount and cheaper rental', async () => {
    const admin = await staff('admin');
    const p = await newPlayer('Sofia');
    const account = await accountOf(p.userId);
    await db().update(companies).set({ balanceCents: 200_000_00 }).where(eq(companies.id, account.id));
    await buyDepot(db(), p.userId, p.hq.id);
    expect((await fleetCapacity(db(), account.id)).slots).toBe(3);
    await setVip(db(), admin, p.userId, 5);
    expect((await fleetCapacity(db(), account.id)).slots).toBe(4);

    const own = await buyVehicle(db(), p.userId, 'sokol-courier', p.hq.id);
    await db().update(vehicles).set({ condition: 50 }).where(eq(vehicles.id, own.id));
    const vipCost = await repairVehicle(db(), p.userId, own.id);
    await setVip(db(), admin, p.userId, 0);
    await db().update(vehicles).set({ condition: 50 }).where(eq(vehicles.id, own.id));
    await db().update(vehicles).set({ odometerKm: 1 }).where(eq(vehicles.id, own.id));
    const fullCost = await repairVehicle(db(), p.userId, own.id);
    expect(vipCost).toBe(Math.round(fullCost * 0.9));

    await setVip(db(), admin, p.userId, 5);
    const rented = (await db().select().from(vehicles).where(and(eq(vehicles.companyId, account.id), eq(vehicles.ownership, 'rented'))))[0]!;
    const c = await makeContract('Sofia', 'Plovdiv', { rewardCents: 1000_00 });
    const d = await acceptContract(db(), p.userId, c.id, rented.id);
    expect(d.rentalFeeCents).toBe(rentalFeeCents(1000_00, d.emptyKm + d.loadedKm, 0.05));
  });

  it('urgent shipments open 5 minutes earlier for VIP; VIPs can reserve contracts', async () => {
    const admin = await staff('admin');
    const vip = await newPlayer('Sofia');
    const regular = await newPlayer('Sofia');
    await setVip(db(), admin, vip.userId, 5);
    const sofia = await cityByName('Sofia');
    const plovdiv = await cityByName('Plovdiv');
    const urgent = await createUrgentContract(db(), admin, { goods: 'Кръвни проби', cargoType: 'pallets', weightTons: 1, rewardEur: 1000, originCityId: sofia.id, destCityId: plovdiv.id, windowMinutes: 60, speedFactor: 2, expiresHours: 2, announce: false }, approximateProvider);
    expect(await code(acceptContract(db(), regular.userId, urgent.id, (await truckOf((await accountOf(regular.userId)).id)).id))).toBe('vip_early_access');
    expect(await code(acceptContract(db(), vip.userId, urgent.id, (await truckOf((await accountOf(vip.userId)).id)).id))).toBe('ok');
    const later = new Date(urgent.createdAt.getTime() + 5 * 60_000 + 1000);
    expect(await code(acceptContract(db(), regular.userId, urgent.id, (await truckOf((await accountOf(regular.userId)).id)).id, later))).toBe('ok');

    const job = await makeContract('Sofia', 'Plovdiv');
    expect(await code(reserveContract(db(), regular.userId, job.id))).toBe('vip_only');
    const other = await newPlayer('Sofia');
    await setVip(db(), admin, other.userId, 5);
    await reserveContract(db(), other.userId, job.id);
    const third = await newPlayer('Sofia');
    expect(await code(acceptContract(db(), third.userId, job.id, (await truckOf((await accountOf(third.userId)).id)).id))).toBe('reserved');
    expect(await code(acceptContract(db(), other.userId, job.id, (await truckOf((await accountOf(other.userId)).id)).id))).toBe('ok');
    expect((await db().select().from(contracts).where(eq(contracts.id, job.id)))[0]!.status).toBe('accepted');
  });

  it('extra missions, a free daily swap and automatic rewards', async () => {
    const admin = await staff('admin');
    const p = await newPlayer('Sofia');
    await setVip(db(), admin, p.userId, 5);
    const now = new Date();
    const board = await missionBoard(db(), p.userId, now);
    expect(board.current.filter((r) => r.period === 'daily')).toHaveLength(4);
    expect(board.current.filter((r) => r.period === 'weekly')).toHaveLength(4);

    const daily = board.current.filter((r) => r.period === 'daily');
    const first = await rerollMission(db(), p.userId, daily[0]!.periodKey, daily[0]!.missionId, now);
    expect(first.free).toBe(true);
    expect(await code(rerollMission(db(), p.userId, daily[1]!.periodKey, daily[1]!.missionId, now))).toBe('insufficient_coins');
    await adjustCoins(db(), admin, p.userId, 50, 'тест');
    const second = await rerollMission(db(), p.userId, daily[1]!.periodKey, daily[1]!.missionId, now);
    expect(second.free).toBe(false);
    expect((await userRow(p.userId)).coins).toBe(50 - MISSION_REROLL_COINS);

    // Auto-claim: complete everything with one delivery, rewards are paid without a click.
    await db().update(missionProgress).set({ target: 1 }).where(eq(missionProgress.userId, p.userId));
    const c = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, c.id, (await truckOf((await accountOf(p.userId)).id)).id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000));
    const rows = await db().select().from(missionProgress).where(eq(missionProgress.userId, p.userId));
    const completed = rows.filter((r) => r.completedAt);
    expect(completed.length).toBeGreaterThan(0);
    expect(completed.every((r) => r.claimedAt)).toBe(true);
  });
});
