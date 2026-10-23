import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { dayKey } from '@/lib/game/daily';
import { PARKING, parkingStart, replayParking } from '@/lib/game/parking';
import { applyRushHour, isRushHour, RUSH_HOUR } from '@/lib/game/roads';
import { RETRO_BADGE } from '@/lib/game/shop';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, drivers, jobState, userBadges, users, vehicles } from '@/server/db/schema';
import { runCommand } from '@/server/discord/commands';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { playParking } from '@/server/game/parking';
import { expireTestDrives, startTestDrive } from '@/server/game/rentals';
import { buyShopItem } from '@/server/game/shop';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const ownerDriver = async (userId: string) => (await db().select().from(drivers).where(and(eq(drivers.companyId, (await accountOf(userId)).id), eq(drivers.isOwner, true))))[0]!;

describe('rules', () => {
  it('rush hour: the city clock, big cities only, later segments move on', () => {
    expect(isRushHour(Date.parse('2027-03-01T06:30:00Z'), 'Europe/Sofia')).toBe(true); // 08:30 in Sofia
    expect(isRushHour(Date.parse('2027-03-01T10:00:00Z'), 'Europe/Sofia')).toBe(false);
    const at = Date.parse('2027-03-01T06:00:00Z');
    const segs = [
      { kind: 'loading', leg: 'loaded', start: at, end: at + 40 * 60_000 },
      { kind: 'drive', leg: 'loaded', start: at + 40 * 60_000, end: at + 100 * 60_000 },
      { kind: 'unloading', leg: 'loaded', start: at + 100 * 60_000, end: at + 140 * 60_000 },
    ];
    const big = { population: RUSH_HOUR.minPopulation, timezone: 'Europe/Sofia' };
    const r = applyRushHour(segs, big, { population: 10_000, timezone: 'Europe/Sofia' });
    expect(r.rush).toEqual(['loading']);
    expect(r.segments[0]!.end - r.segments[0]!.start).toBe(60 * 60_000);
    expect(r.segments[2]!.end).toBe(segs[2]!.end + 20 * 60_000);
  });

  it('parking: the server replays the steering; leaving the yard scores nothing', () => {
    const day = 'D2027-03-01';
    expect(replayParking(day, []).pose).toEqual(parkingStart(day));
    expect(replayParking(day, Array(PARKING.maxTicks).fill(1)).stars).toBe(0);
    expect(replayParking(day, [2, -5, 0]).pose).toEqual(replayParking(day, [1, -1, 0]).pose);
  });
});

describe('v1.5, the last part', () => {
  it('the daily parking run: XP by the server, once a day', async () => {
    const p = await newPlayer();
    const xp0 = (await db().select().from(users).where(eq(users.id, p.userId)))[0]!.xp;
    const r = await playParking(db(), p.userId, Array(50).fill(0));
    expect(r.stars).toBe(replayParking(dayKey(new Date()), Array(50).fill(0)).stars);
    expect((await db().select().from(users).where(eq(users.id, p.userId)))[0]!.xp).toBe(xp0 + (PARKING.xp[r.stars] ?? 0));
    expect(await code(playParking(db(), p.userId, []))).toBe('already');
  });

  it('a test drive: the own driver takes the dealer truck for one trip, no rental fee, then it goes back', async () => {
    const p = await newPlayer();
    await db().update(users).set({ level: 30 }).where(eq(users.id, p.userId));
    const before = await ownerDriver(p.userId);
    const { vehicleId } = await startTestDrive(db(), p.userId, 'hemus-r12-box');
    expect((await ownerDriver(p.userId)).vehicleId).toBe(vehicleId);
    expect(await code(startTestDrive(db(), p.userId, 'danubia-t440'))).toBe('active');
    const c = await makeContract('Sofia', 'Plovdiv', { weightTons: 1 });
    const d = await acceptContract(db(), p.userId, c.id, vehicleId);
    expect((await db().select().from(deliveries).where(eq(deliveries.id, d.id)))[0]!.rentalFeeCents).toBe(0);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), (await accountOf(p.userId)).id);
    expect((await db().select().from(vehicles).where(eq(vehicles.id, vehicleId)))[0]!.soldAt).not.toBeNull();
    expect((await ownerDriver(p.userId)).vehicleId).toBe(before.vehicleId);
    // Once per model; an unused test truck goes back after a day.
    expect(await code(startTestDrive(db(), p.userId, 'hemus-r12-box'))).toBe('already');
    const again = await startTestDrive(db(), p.userId, 'volta-e19');
    await db().update(vehicles).set({ purchasedAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(vehicles.id, again.vehicleId));
    await expireTestDrives(db());
    expect((await db().select().from(vehicles).where(eq(vehicles.id, again.vehicleId)))[0]!.soldAt).not.toBeNull();
    expect((await ownerDriver(p.userId)).vehicleId).toBe(before.vehicleId);
  });

  it('the retro collection: three paints, a badge; /камион', async () => {
    const p = await newPlayer();
    await db().update(users).set({ coins: 1000 }).where(eq(users.id, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, (await accountOf(p.userId)).id));
    // Paint goes on an own truck (the starter one is rented).
    await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, truck!.id));
    await db().delete(jobState).where(like(jobState.key, `retro:${p.userId}:%`));
    for (const item of ['paint_retro70', 'paint_retro80', 'paint_retro90'] as const) await buyShopItem(db(), p.userId, { item, vehicleId: truck!.id });
    expect((await db().select().from(vehicles).where(eq(vehicles.id, truck!.id)))[0]!.livery).toBe('retro90');
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, RETRO_BADGE)))).toHaveLength(1);
    expect(await code(buyShopItem(db(), p.userId, { item: 'paint_retro90', vehicleId: truck!.id }))).toBe('already_painted');

    const linked = `d${Date.now()}`;
    await db().update(users).set({ discordId: linked }).where(eq(users.id, p.userId));
    const reply = await runCommand(db(), { name: 'камион', options: {}, discordUserId: linked });
    expect(reply.embeds![0]!.image!.url).toContain(`/api/discord/card/truck/${truck!.id}`);
  });
});
