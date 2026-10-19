import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { CHRISTMAS, CHRISTMAS_QUESTS, christmasIncrements, isChristmas } from '@/lib/game/christmas';
import type { RoadEventPlan } from '@/lib/game/road-events';
import { activeSeason } from '@/lib/game/seasonal';
import type { Segment } from '@/lib/game/schedule';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, friendships, globalEventContributions, globalEvents, seasonalQuests, userBadges, users, vehicles } from '@/server/db/schema';
import { christmasState, claimChristmasQuest, ensureChristmasEvent } from '@/server/game/christmas';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { applyDueRoadEvents } from '@/server/game/road-events';
import { helpOnRoad } from '@/server/game/roadside';
import { buyShopItem } from '@/server/game/shop';
import { db, makeContract, newPlayer } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
// 2026-12-18 12:00 Sofia — Christmas week.
const CHRISTMAS_DAY = new Date('2026-12-18T10:00:00Z');
const truckOf = async (userId: string) => {
  const [account] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
  return { account: account!, truck: truck! };
};

describe('christmas rules', () => {
  it('dates over the new year, the look, the quests', () => {
    expect(isChristmas(new Date('2026-12-14T12:00:00Z'))).toBe(false);
    expect(isChristmas(new Date('2026-12-15T12:00:00Z'))).toBe(true);
    expect(isChristmas(new Date('2027-01-06T12:00:00Z'))).toBe(true);
    expect(isChristmas(new Date('2027-01-07T12:00:00Z'))).toBe(false);
    // Christmas lights inside the winter look; snow before and after.
    expect(activeSeason(new Date('2026-12-10T12:00:00Z'))).toBe('winter');
    expect(activeSeason(new Date('2026-12-24T12:00:00Z'))).toBe('christmas');
    expect(activeSeason(new Date('2027-01-10T12:00:00Z'))).toBe('winter');
    expect(christmasIncrements({ holiday: true, loadedKm: 300.6, arrivedAt: new Date('2026-12-24T15:00:00Z') })).toEqual({ c_loads: 1, c_km: 301, c_eve: 1, c_help: 0 });
    expect(christmasIncrements({ holiday: false, loadedKm: 300, arrivedAt: new Date('2026-12-20T15:00:00Z') }).c_eve).toBe(0);
  });
});

describe('christmas in the game', () => {
  it('christmas loads move the quests and the event; all four quests give the badge', async () => {
    const p = await newPlayer();
    await db().delete(globalEvents).where(eq(globalEvents.template, CHRISTMAS.eventTemplate));
    expect(await ensureChristmasEvent(db(), new Date('2026-12-10T12:00:00Z'))).toBeNull();
    const event = (await ensureChristmasEvent(db(), CHRISTMAS_DAY))!;
    expect(event).toMatchObject({ metric: 'holiday', name: 'Коледна треска' });
    expect(event.endsAt.toISOString()).toBe('2026-12-24T16:00:00.000Z'); // 18:00 Sofia on Christmas Eve

    const { account, truck } = await truckOf(p.userId);
    const job = await makeContract('Sofia', 'Plovdiv', { holiday: 'christmas', goods: 'Коледни подаръци', expiresAt: new Date('2027-01-30T00:00:00Z') });
    const d = await acceptContract(db(), p.userId, job.id, truck.id, CHRISTMAS_DAY);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account.id);
    const state = await christmasState(db(), p.userId);
    expect(state.quests.find((q) => q.id === 'c_loads')!.progress).toBe(1);
    const [contrib] = await db().select().from(globalEventContributions).where(and(eq(globalEventContributions.eventId, event.id), eq(globalEventContributions.userId, p.userId)));
    expect(contrib!.amount).toBe(1);

    for (const q of CHRISTMAS_QUESTS) await db().insert(seasonalQuests).values({ userId: p.userId, quest: `${CHRISTMAS.key}:${q.id}`, progress: q.target }).onConflictDoUpdate({ target: [seasonalQuests.userId, seasonalQuests.quest], set: { progress: q.target } });
    let last = { badge: false };
    for (const q of CHRISTMAS_QUESTS) last = await claimChristmasQuest(db(), p.userId, q.id, CHRISTMAS_DAY);
    expect(last.badge).toBe(true);
    // Rewards can still be taken after the event while the holiday lasts.
    expect(await code(claimChristmasQuest(db(), p.userId, 'c_loads', new Date('2027-01-05T12:00:00Z')))).toBe('already_claimed');
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, CHRISTMAS.badge)))).toHaveLength(1);
  });

  it('winter goods do not count for the holiday event', async () => {
    const p = await newPlayer();
    await db().delete(globalEvents).where(eq(globalEvents.template, CHRISTMAS.eventTemplate));
    const event = (await ensureChristmasEvent(db(), CHRISTMAS_DAY))!;
    const { account, truck } = await truckOf(p.userId);
    const job = await makeContract('Sofia', 'Plovdiv', { holiday: 'winter', goods: 'Пелети за отопление', expiresAt: new Date('2027-01-30T00:00:00Z') });
    const d = await acceptContract(db(), p.userId, job.id, truck.id, CHRISTMAS_DAY);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account.id);
    expect(await db().select().from(globalEventContributions).where(and(eq(globalEventContributions.eventId, event.id), eq(globalEventContributions.userId, p.userId)))).toHaveLength(0);
  });

  it('helping a friend on the road counts at Christmas', async () => {
    const owner = await newPlayer('Sofia');
    const friend = await newPlayer('Sofia');
    await db().insert(friendships).values({ requesterId: owner.userId, addresseeId: friend.userId, status: 'accepted' });
    const { truck } = await truckOf(owner.userId);
    const d = await acceptContract(db(), owner.userId, (await makeContract('Sofia', 'Plovdiv', { expiresAt: new Date('2027-01-30T00:00:00Z') })).id, truck.id, CHRISTMAS_DAY);
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    const drive = (row!.schedule as Segment[]).find((s) => s.kind === 'drive' && s.leg === 'loaded')!;
    const at = Math.round((drive.start + drive.end) / 2);
    const events: RoadEventPlan[] = [{ kind: 'snow', at, delayMs: 20 * 60_000, costCents: 0, applied: false }];
    await db().update(deliveries).set({ roadEvents: events, nextEventAt: new Date(at) }).where(eq(deliveries.id, d.id));
    await applyDueRoadEvents(db(), new Date(at + 1000));
    await helpOnRoad(db(), friend.userId, d.id, new Date(at + 60_000));
    expect((await christmasState(db(), friend.userId)).quests.find((q) => q.id === 'c_help')!.done).toBe(true);
  });

  it('the Christmas paint is sold only at Christmas', async () => {
    const p = await newPlayer();
    await db().update(users).set({ coins: 500 }).where(eq(users.id, p.userId));
    const { truck } = await truckOf(p.userId);
    await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, truck.id));
    expect(await code(buyShopItem(db(), p.userId, { item: 'paint_christmas', vehicleId: truck.id }, new Date('2026-12-01T12:00:00Z')))).toBe('not_in_season');
    await buyShopItem(db(), p.userId, { item: 'paint_christmas', vehicleId: truck.id }, CHRISTMAS_DAY);
    const [painted] = await db().select().from(vehicles).where(eq(vehicles.id, truck.id));
    expect(painted).toMatchObject({ livery: 'christmas', color: CHRISTMAS.paintColor });
  });
});
