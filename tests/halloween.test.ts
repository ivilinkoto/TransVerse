import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { eventIncrement } from '@/lib/game/events';
import { HALLOWEEN, HALLOWEEN_QUESTS, isHalloween, isNight, questIncrements } from '@/lib/game/halloween';
import { planRoadEvents, ROAD_EVENTS } from '@/lib/game/road-events';
import { activeSeason } from '@/lib/game/seasonal';
import { closeDb } from '@/server/db/client';
import { coinEntries, companies, deliveries, globalEventContributions, globalEvents, seasonalQuests, userBadges, users, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { claimHalloweenQuest, ensureHalloweenEvent, halloweenState } from '@/server/game/halloween';
import { applyDueRoadEvents } from '@/server/game/road-events';
import { buyShopItem } from '@/server/game/shop';
import { playerCard } from '@/server/game/social';
import { db, makeContract, newPlayer } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
// 2026-10-27 20:00 Sofia (UTC+2 after the clocks change) — Halloween week, evening.
const HALLOWEEN_EVENING = new Date('2026-10-27T18:00:00Z');

describe('halloween rules', () => {
  it('dates, night, quests, the event metric', () => {
    expect(isHalloween(new Date('2026-10-19T12:00:00Z'))).toBe(false);
    expect(isHalloween(new Date('2026-10-20T12:00:00Z'))).toBe(true);
    expect(isHalloween(new Date('2026-11-02T20:00:00Z'))).toBe(true);
    expect(isHalloween(new Date('2026-11-03T12:00:00Z'))).toBe(false);
    expect(activeSeason(new Date('2026-10-31T12:00:00Z'))).toBe('halloween');
    expect(activeSeason(new Date('2026-11-20T12:00:00Z'))).toBeNull();
    // Winter look over the new year (the window wraps).
    expect(activeSeason(new Date('2026-12-10T12:00:00Z'))).toBe('winter');
    expect(activeSeason(new Date('2027-02-28T12:00:00Z'))).toBe('winter');
    expect(activeSeason(new Date('2027-03-02T12:00:00Z'))).toBeNull();
    expect(activeSeason(new Date('2026-12-10T12:00:00Z'), { mode: 'on', season: 'halloween' })).toBe('halloween');
    expect(activeSeason(new Date('2026-10-31T12:00:00Z'), { mode: 'off' })).toBeNull();
    expect(isNight(new Date('2026-10-27T21:30:00Z'))).toBe(true); // 23:30 Sofia
    expect(isNight(new Date('2026-10-27T10:00:00Z'))).toBe(false);
    expect(questIncrements({ holiday: true, loadedKm: 420.4, arrivedAt: new Date('2026-10-27T10:00:00Z') })).toEqual({ h_loads: 1, h_km: 420, h_night: 0, h_ghost: 0 });
    const facts = { loadedKm: 100, tons: 2, onTime: true, rewardCents: 1, cargoType: 'pallets', countries: ['BG'], urgent: false, inCompany: false };
    expect(eventIncrement({ metric: 'holiday', cargoType: null, countryCode: null }, { ...facts, holiday: true })).toBe(1);
    expect(eventIncrement({ metric: 'holiday', cargoType: null, countryCode: null }, facts)).toBe(0);
  });

  it('the ghost truck only comes at night', () => {
    const night = new Date('2026-10-27T21:00:00Z').getTime(); // 23:00 Sofia
    const day = new Date('2026-10-27T09:00:00Z').getTime();
    const trip = (start: number) => [{ kind: 'drive' as const, leg: 'loaded' as const, start, end: start + 30 * 60_000, fromKm: 0, toKm: 300 }];
    const ghosts = (start: number) => planRoadEvents(trip(start), { totalKm: 300, borders: 0, rented: false, random: () => 0.01, chance: 0, ghostChance: 1 }).filter((e) => e.kind === 'ghost');
    expect(ghosts(night)).toHaveLength(1);
    expect(ghosts(night)[0]!.costCents).toBe(0);
    expect(ghosts(day)).toHaveLength(0);
    expect(ROAD_EVENTS.ghost.title).toBe('Призрачен камион');
  });
});

describe('halloween in the game', () => {
  it('holiday loads move the quests and the event; quests pay once and all four give the badge', async () => {
    const p = await newPlayer();
    await db().delete(globalEvents).where(eq(globalEvents.template, HALLOWEEN.eventTemplate));
    expect(await ensureHalloweenEvent(db(), new Date('2026-10-10T12:00:00Z'))).toBeNull(); // before the holiday
    const event = (await ensureHalloweenEvent(db(), HALLOWEEN_EVENING))!;
    expect(event).toMatchObject({ metric: 'holiday', name: 'Нощта на тиквите' });
    expect(await ensureHalloweenEvent(db(), HALLOWEEN_EVENING)).toBeNull(); // once

    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const job = await makeContract('Sofia', 'Plovdiv', { holiday: 'halloween', goods: 'Тикви за празника', expiresAt: new Date('2026-11-30T00:00:00Z') });
    const d = await acceptContract(db(), p.userId, job.id, truck!.id, HALLOWEEN_EVENING);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account!.id);
    const state = await halloweenState(db(), p.userId);
    expect(state.quests.find((q) => q.id === 'h_loads')!.progress).toBe(1);
    expect(state.quests.find((q) => q.id === 'h_km')!.progress).toBeGreaterThan(100);
    const [contrib] = await db().select().from(globalEventContributions).where(and(eq(globalEventContributions.eventId, event.id), eq(globalEventContributions.userId, p.userId)));
    expect(contrib!.amount).toBe(1);

    expect(await code(claimHalloweenQuest(db(), p.userId, 'h_loads', HALLOWEEN_EVENING))).toBe('not_done');
    // Finish every quest and take the rewards.
    for (const q of HALLOWEEN_QUESTS) await db().insert(seasonalQuests).values({ userId: p.userId, quest: `${HALLOWEEN.key}:${q.id}`, progress: q.target }).onConflictDoUpdate({ target: [seasonalQuests.userId, seasonalQuests.quest], set: { progress: q.target } });
    const before = (await db().select({ coins: users.coins }).from(users).where(eq(users.id, p.userId)))[0]!.coins;
    let last = { badge: false };
    for (const q of HALLOWEEN_QUESTS) last = await claimHalloweenQuest(db(), p.userId, q.id, HALLOWEEN_EVENING);
    expect(last.badge).toBe(true);
    expect(await code(claimHalloweenQuest(db(), p.userId, 'h_loads', HALLOWEEN_EVENING))).toBe('already_claimed');
    const after = (await db().select({ coins: users.coins }).from(users).where(eq(users.id, p.userId)))[0]!.coins;
    expect(after - before).toBe(HALLOWEEN_QUESTS.reduce((s, q) => s + q.coins, 0) + 50);
    expect(await db().select().from(userBadges).where(eq(userBadges.userId, p.userId))).toHaveLength(1);
    expect((await playerCard(db(), p.userId, p.username))!.badges.map((b) => b.id)).toEqual([HALLOWEEN.badge]);
  });

  it('the ghost truck pays its coins when the truck gets there', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const job = await makeContract('Sofia', 'Plovdiv', { expiresAt: new Date('2026-11-30T00:00:00Z') });
    const d = await acceptContract(db(), p.userId, job.id, truck!.id, HALLOWEEN_EVENING);
    const at = d.startedAt.getTime() + 60_000;
    await db().update(deliveries).set({ roadEvents: [{ kind: 'ghost', at, delayMs: 5_000, costCents: 0, applied: false }], nextEventAt: new Date(at) }).where(eq(deliveries.id, d.id));
    // Other test files may have due events too.
    expect(await applyDueRoadEvents(db(), new Date(at + 1000))).toBeGreaterThanOrEqual(1);
    const coins = await db().select().from(coinEntries).where(and(eq(coinEntries.userId, p.userId), eq(coinEntries.idempotencyKey, `delivery:${d.id}:ghost`)));
    expect(coins.map((c) => c.amount)).toEqual([HALLOWEEN.ghostCoins]);
    expect((await halloweenState(db(), p.userId)).quests.find((q) => q.id === 'h_ghost')!.done).toBe(true);
  });

  it('the pumpkin paint is sold only at Halloween and stays on the truck', async () => {
    const p = await newPlayer();
    await db().update(users).set({ coins: 500 }).where(eq(users.id, p.userId));
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, truck!.id));
    expect(await code(buyShopItem(db(), p.userId, { item: 'paint_pumpkin', vehicleId: truck!.id }, new Date('2026-12-01T12:00:00Z')))).toBe('not_in_season');
    await buyShopItem(db(), p.userId, { item: 'paint_pumpkin', vehicleId: truck!.id }, HALLOWEEN_EVENING);
    const [painted] = await db().select().from(vehicles).where(eq(vehicles.id, truck!.id));
    expect(painted).toMatchObject({ livery: 'pumpkin', color: HALLOWEEN.pumpkinColor });
    expect(await code(buyShopItem(db(), p.userId, { item: 'paint_pumpkin', vehicleId: truck!.id }, HALLOWEEN_EVENING))).toBe('already_painted');
  });
});
