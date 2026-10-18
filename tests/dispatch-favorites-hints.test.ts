import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, users, vehicles } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { autoDispatchTick, planDispatch, runDispatch, setAutoDispatch } from '@/server/game/dispatch';
import { favoriteLanesOf, notifyFavoriteLane, toggleFavoriteLane } from '@/server/game/favorites';
import { notifications } from '@/server/db/schema';
import { cityByName } from './helpers';
import { dismissHint } from '@/server/game/releases';
import { categoryOf, inQuietHours } from '@/server/push';
import { db, makeContract, newPlayer } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

describe('dispatcher', () => {
  it('proposes one profitable on-time job per free truck and sends it', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    await makeContract('Sofia', 'Plovdiv', { weightTons: 2, rewardCents: 2_000_00 });
    const plan = await planDispatch(db(), p.userId);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.vehicleId).toBe(truck!.id);
    expect(plan[0]!.profitCents).toBeGreaterThan(0);
    const res = await runDispatch(db(), p.userId, plan);
    expect(res.sent).toBe(1);
    expect(await planDispatch(db(), p.userId)).toHaveLength(0); // the truck is on the road
  });

  it('VIP auto-dispatch sends a free truck by itself; without VIP it is switched off', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    expect(await code(setAutoDispatch(db(), p.userId, truck!.id, true))).toBe('vip_only');
    await db().update(users).set({ vipUntil: new Date(Date.now() + 86_400_000) }).where(eq(users.id, p.userId));
    await setAutoDispatch(db(), p.userId, truck!.id, true);
    await makeContract('Sofia', 'Plovdiv', { weightTons: 2, rewardCents: 2_000_00 });
    await autoDispatchTick(db());
    const auto = await db().select().from(deliveries).where(and(eq(deliveries.companyId, account!.id), eq(deliveries.autoDispatched, true)));
    expect(auto).toHaveLength(1);
  });
});

describe('favourite lanes', () => {
  it('star and un-star a lane; a new job on it tells the player at most once an hour', async () => {
    const p = await newPlayer();
    const sofia = await cityByName('Sofia');
    const plovdiv = await cityByName('Plovdiv');
    expect(await toggleFavoriteLane(db(), p.userId, sofia.id, plovdiv.id)).toBe(true);
    expect(await favoriteLanesOf(db(), p.userId)).toHaveLength(1);
    const lane = { originCityId: sofia.id, destCityId: plovdiv.id, originName: 'София', destName: 'Пловдив', goods: 'Мебели', rewardCents: 500_00 };
    const now = new Date();
    expect(await notifyFavoriteLane(db(), lane, now)).toBeGreaterThanOrEqual(1);
    await notifyFavoriteLane(db(), lane, new Date(now.getTime() + 60_000)); // within the hour: quiet
    const notes = await db().select().from(notifications).where(and(eq(notifications.userId, p.userId), eq(notifications.title, 'Нова поръчка: София → Пловдив')));
    expect(notes).toHaveLength(1);
    expect(await toggleFavoriteLane(db(), p.userId, sofia.id, plovdiv.id)).toBe(false);
    expect(await favoriteLanesOf(db(), p.userId)).toHaveLength(0);
  });
});

describe('hints', () => {
  it('a closed hint is remembered once', async () => {
    const p = await newPlayer();
    await dismissHint(db(), p.userId, 'crew');
    await dismissHint(db(), p.userId, 'crew');
    await dismissHint(db(), p.userId, 'board');
    const [u] = await db().select({ seen: users.seenHints }).from(users).where(eq(users.id, p.userId));
    expect(u!.seen).toEqual(['crew', 'board']);
  });
});

describe('phone notifications', () => {
  it('new categories and quiet hours across midnight', () => {
    expect(categoryOf('/game/contracts?fav=1')).toBe('favorites');
    expect(categoryOf('/game/contracts')).toBe('urgent');
    expect(categoryOf('/game/finance#fines')).toBe('fines');
    expect(categoryOf('/game/finance')).toBe('deliveries');
    expect(categoryOf('/game/clients')).toBe('clients');
    expect(categoryOf('/game/news')).toBe('news');
    expect(categoryOf('/game/halloween')).toBe('holiday');
    const q = { from: 23, to: 8 };
    expect(inQuietHours(q, new Date('2026-10-18T22:30:00Z'))).toBe(true); // 01:30 Sofia
    expect(inQuietHours(q, new Date('2026-10-18T10:00:00Z'))).toBe(false); // 13:00
    expect(inQuietHours({ from: 13, to: 15 }, new Date('2026-10-18T10:30:00Z'))).toBe(true);
    expect(inQuietHours(null, new Date())).toBe(false);
  });
});
