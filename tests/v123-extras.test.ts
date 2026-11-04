import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { notificationButtons } from '@/lib/game/notification-buttons';
import { WEEKLY_LANE } from '@/lib/game/weekly-lane';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, jobState, laneTips, notifications, userBadges, users, vehicles } from '@/server/db/schema';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { countryHealth } from '@/server/game/game-health';
import { addLaneTip, bestTips, LANE_TIPS, voteLaneTip } from '@/server/game/lane-tips';
import { morningReports } from '@/server/game/morning';
import { greetNewcomer, NEIGHBORS } from '@/server/game/neighbors';
import { weekChart } from '@/server/game/week-chart';
import { recordWeeklyLane } from '@/server/game/weekly-lane';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (userId: string) => (await db().select().from(vehicles).where(eq(vehicles.companyId, (await accountOf(userId)).id)))[0]!;

/** A finished trip Sofia → Plovdiv for the player, completed at `at`. */
async function finishedTrip(userId: string, at: Date) {
  const c = await makeContract('Sofia', 'Plovdiv');
  const d = await acceptContract(db(), userId, c.id, (await truckOf(userId)).id);
  await db().update(deliveries).set({ status: 'completed', completedAt: at, late: false, payoutCents: 400_00 }).where(eq(deliveries.id, d.id));
  return c;
}

describe('1.2.3 extras', () => {
  it('notification buttons come from the link of the notification', () => {
    const id = '0d6c96db-7d00-4c1b-9d6e-0123456789ab';
    expect(notificationButtons(`/game/profile?friend=${id}#friends`).map((b) => b.action)).toEqual([
      { type: 'friendRespond', friendshipId: id, accept: true },
      { type: 'friendRespond', friendshipId: id, accept: false },
    ]);
    expect(notificationButtons(`/game/inventory?trade=${id}`)[0]!.action).toEqual({ type: 'answerTrade', id, answer: 'accept' });
    expect(notificationButtons(`/game/players/x?greet=${id}`)).toHaveLength(1);
    expect(notificationButtons('/game/profile?friend=not-an-id')).toEqual([]);
    expect(notificationButtons(null)).toEqual([]);
  });

  it('lane tips: only after driving the lane, no links, votes, hidden at −3', async () => {
    const [a, b] = [await newPlayer(), await newPlayer()];
    const c = await makeContract('Sofia', 'Plovdiv');
    const lane = { originCityId: c.originCityId, destCityId: c.destCityId };
    expect(await code(addLaneTip(db(), a.userId, { ...lane, body: 'Карай през Пазарджик' }))).toBe('not_driven');
    await finishedTrip(a.userId, new Date());
    expect(await code(addLaneTip(db(), a.userId, { ...lane, body: 'виж www.example.com' }))).toBe('no_links');
    const tip = await addLaneTip(db(), a.userId, { ...lane, body: '  Тръгни   рано сутрин  ' });
    expect(tip.body).toBe('Тръгни рано сутрин');
    expect(await code(voteLaneTip(db(), a.userId, tip.id, 1))).toBe('own_tip');
    expect(await voteLaneTip(db(), b.userId, tip.id, 1)).toBe(1);
    expect(await voteLaneTip(db(), b.userId, tip.id, 1)).toBe(1);
    expect(await voteLaneTip(db(), b.userId, tip.id, -1)).toBe(-1);
    const best = await bestTips(db(), [{ o: lane.originCityId, d: lane.destCityId }], b.userId);
    expect(best.get(`${lane.originCityId}:${lane.destCityId}`)).toBeDefined();
    await db().update(laneTips).set({ score: LANE_TIPS.hideAt }).where(eq(laneTips.id, tip.id));
    const hidden = await bestTips(db(), [{ o: lane.originCityId, d: lane.destCityId }], b.userId);
    expect(hidden.get(`${lane.originCityId}:${lane.destCityId}`)?.id).not.toBe(tip.id);
  });

  it('greeting a new player moves the present once per pair', async () => {
    const [old, fresh] = [await newPlayer(), await newPlayer()];
    const [from0, to0] = [(await accountOf(old.userId)).balanceCents, (await accountOf(fresh.userId)).balanceCents];
    await greetNewcomer(db(), old.userId, fresh.userId);
    expect((await accountOf(old.userId)).balanceCents).toBe(from0 - NEIGHBORS.giftCents);
    expect((await accountOf(fresh.userId)).balanceCents).toBe(to0 + NEIGHBORS.giftCents);
    expect(await code(greetNewcomer(db(), old.userId, fresh.userId))).toBe('cannot_greet');
    expect(await code(greetNewcomer(db(), fresh.userId, fresh.userId))).toBe('cannot_greet');
  });

  it('contract of the week: a badge and ТрансКоин for an on-time delivery, once', async () => {
    const p = await newPlayer();
    const week = `T${Date.now()}`;
    const coins0 = (await db().select({ c: users.coins }).from(users).where(eq(users.id, p.userId)))[0]!.c;
    const tag = `weekly-lane:${week}`;
    expect(await db().transaction((tx) => recordWeeklyLane(tx, { userId: p.userId, tag, late: true }, new Date()))).toBe(false);
    expect(await db().transaction((tx) => recordWeeklyLane(tx, { userId: p.userId, tag, late: false }, new Date()))).toBe(true);
    expect(await db().transaction((tx) => recordWeeklyLane(tx, { userId: p.userId, tag, late: false }, new Date()))).toBe(false);
    expect((await db().select({ c: users.coins }).from(users).where(eq(users.id, p.userId)))[0]!.c).toBe(coins0 + WEEKLY_LANE.coins);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, WEEKLY_LANE.badge)))).toHaveLength(1);
    expect(await db().select().from(jobState).where(like(jobState.key, `weekly-lane-win:${week}:%`))).toHaveLength(1);
  });

  it('the week in the profile and the morning report count the finished trips', async () => {
    const p = await newPlayer();
    // 08:00 Sofia today (the report runs from 7 to 11).
    const now = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(new Date())}T08:00:00+02:00`);
    await finishedTrip(p.userId, new Date(now.getTime() - 3_600_000));
    const week = await weekChart(db(), (await accountOf(p.userId)).id, now);
    expect(week).toHaveLength(7);
    expect(week[6]!.trips).toBe(1);
    expect(week[6]!.cents).toBe(400_00);
    expect(await morningReports(db(), new Date(now.getTime() - 6 * 3_600_000))).toBe(0);
    await db().update(users).set({ lastSeenAt: now }).where(eq(users.id, p.userId));
    await morningReports(db(), now);
    const mine = await db().select().from(notifications).where(eq(notifications.userId, p.userId));
    expect(mine.filter((n) => n.title.includes('Добро утро'))).toHaveLength(1);
    await morningReports(db(), new Date(now.getTime() + 20 * 60_000));
    expect((await db().select().from(notifications).where(eq(notifications.userId, p.userId))).filter((n) => n.title.includes('Добро утро'))).toHaveLength(1);
  });

  it('game health: a country is starved only with idle trucks and no open loads', async () => {
    const list = await countryHealth(db(), new Date());
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) expect(c.starved).toBe(c.idleTrucks > 0 && c.openLoads === 0);
  });
});
