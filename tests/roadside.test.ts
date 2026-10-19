import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { RoadEventPlan } from '@/lib/game/road-events';
import { helpableStop, ROADSIDE } from '@/lib/game/roadside';
import type { Segment } from '@/lib/game/schedule';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, friendships, notifications, roadsideHelps, users, vehicles } from '@/server/db/schema';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { applyDueRoadEvents } from '@/server/game/road-events';
import { helpOnRoad } from '@/server/game/roadside';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const balance = async (userId: string) => (await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.ownerId, userId)))[0]!.b;
const truck = async (userId: string) => {
  const [c] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [v] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, c!.id), sql`${vehicles.soldAt} is null`));
  return v!.id;
};
const befriend = (a: string, b: string) => db().insert(friendships).values({ requesterId: a, addresseeId: b, status: 'accepted' });
const delivery = async (id: string) => (await db().select().from(deliveries).where(eq(deliveries.id, id)))[0]!;

/** A trip Sofia → Plovdiv with a breakdown in the middle of the loaded drive; returns the time the truck stands there. */
async function stuckTrip(userId: string) {
  const d = await acceptContract(db(), userId, (await makeContract('Sofia', 'Plovdiv')).id, await truck(userId));
  const row = await delivery(d.id);
  const drive = (row.schedule as Segment[]).find((s) => s.kind === 'drive' && s.leg === 'loaded')!;
  const at = Math.round((drive.start + drive.end) / 2);
  const events: RoadEventPlan[] = [{ kind: 'breakdown', at, delayMs: 20 * 60_000, costCents: 0, applied: false }];
  await db().update(deliveries).set({ roadEvents: events, nextEventAt: new Date(at) }).where(eq(deliveries.id, d.id));
  return { id: d.id, at };
}

describe('help on the road', () => {
  it('a friend nearby halves the rest of the stop and earns the fee', async () => {
    const owner = await newPlayer('Sofia');
    const friend = await newPlayer('Sofia');
    await befriend(owner.userId, friend.userId);
    const trip = await stuckTrip(owner.userId);
    await db().update(users).set({ lastSeenAt: new Date(trip.at) }).where(eq(users.id, friend.userId));
    await applyDueRoadEvents(db(), new Date(trip.at + 1000));
    // The online friend is asked for help.
    const asked = await db().select().from(notifications).where(and(eq(notifications.userId, friend.userId), sql`${notifications.title} like '%чака помощ%'`));
    expect(asked).toHaveLength(1);

    const now = new Date(trip.at + 5 * 60_000);
    const before = await delivery(trip.id);
    const stop = helpableStop(before.schedule as Segment[], now.getTime())!;
    expect(stop).not.toBeNull();
    const cash = await balance(friend.userId);
    const r = await helpOnRoad(db(), friend.userId, trip.id, now);
    expect(r.savedMs).toBe(Math.round((stop.end - now.getTime()) * ROADSIDE.cut));
    const after = await delivery(trip.id);
    expect(after.etaAt.getTime()).toBe(before.etaAt.getTime() - r.savedMs);
    expect((after.roadEvents as RoadEventPlan[])[0]!.delayMs).toBe(20 * 60_000 - r.savedMs);
    expect(await balance(friend.userId)).toBe(cash + ROADSIDE.feeCents);
    // Once per stop.
    expect(helpableStop(after.schedule as Segment[], now.getTime())).toBeNull();
    expect(await code(helpOnRoad(db(), friend.userId, trip.id, now))).toBe('no_stop');
  });

  it('only friends and colleagues, not yourself, not from far away, at most 3 a day', async () => {
    const owner = await newPlayer('Sofia');
    const stranger = await newPlayer('Sofia');
    const far = await newPlayer('Varna');
    const busy = await newPlayer('Sofia');
    await befriend(owner.userId, far.userId);
    await befriend(owner.userId, busy.userId);
    const trip = await stuckTrip(owner.userId);
    await applyDueRoadEvents(db(), new Date(trip.at + 1000));
    const now = new Date(trip.at + 60_000);
    expect(await code(helpOnRoad(db(), owner.userId, trip.id, now))).toBe('self');
    expect(await code(helpOnRoad(db(), stranger.userId, trip.id, now))).toBe('not_friend');
    expect(await code(helpOnRoad(db(), far.userId, trip.id, now))).toBe('too_far');
    for (let i = 0; i < ROADSIDE.dailyLimit; i++) {
      const other = await stuckTrip((await newPlayer('Sofia')).userId);
      await db().insert(roadsideHelps).values({ deliveryId: other.id, stopAt: new Date(other.at + i), helperId: busy.userId, savedMs: 1, feeCents: 0, createdAt: now });
    }
    expect(await code(helpOnRoad(db(), busy.userId, trip.id, now))).toBe('daily_limit');
  });
});
