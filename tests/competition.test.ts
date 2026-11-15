import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { divisionMoves, isPerfectTrip, nextDivision, PERFECT, perfectBonusShare } from '@/lib/game/competition';
import { closeDb } from '@/server/db/client';
import { userBadges, users } from '@/server/db/schema';
import { recordPerfectTrip } from '@/server/game/competition';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('divisions', () => {
  it('the best go up and the last go down', () => {
    expect(divisionMoves('silver', 10)).toEqual(['up', 'up', 'stay', 'stay', 'stay', 'stay', 'stay', 'stay', 'down', 'down']);
    expect(divisionMoves('gold', 5)).toEqual(['stay', 'stay', 'stay', 'stay', 'down']);
    expect(divisionMoves('bronze', 5)).toEqual(['up', 'stay', 'stay', 'stay', 'stay']);
    expect(divisionMoves('silver', 2)).toEqual(['stay', 'stay']);
    expect(nextDivision('bronze', 'up')).toBe('silver');
    expect(nextDivision('gold', 'up')).toBe('gold');
  });
});

describe('the perfect trip', () => {
  it('a streak pays more and earns badges; one bad trip ends it', async () => {
    const good = { late: false, violations: [], events: [{ kind: 'traffic' }], tons: 23, payloadTons: 24 };
    expect(isPerfectTrip(good)).toBe(true);
    expect(isPerfectTrip({ ...good, tons: 10 })).toBe(false);
    expect(isPerfectTrip({ ...good, events: [{ kind: 'breakdown' }] })).toBe(false);
    expect(isPerfectTrip({ ...good, violations: ['overload'] })).toBe(false);
    expect(perfectBonusShare(25)).toBe(PERFECT.maxBonus);

    const p = await newPlayer();
    let last = { bonusCents: 0, streak: 0 };
    for (let i = 0; i < 5; i++) last = await db().transaction((tx) => recordPerfectTrip(tx, p.userId, { ...good, rewardCents: 100_000 }, new Date()));
    expect(last).toEqual({ bonusCents: 5_000, streak: 5 });
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, 'perfect-5')))).toHaveLength(1);
    await db().transaction((tx) => recordPerfectTrip(tx, p.userId, { ...good, late: true, rewardCents: 100_000 }, new Date()));
    const [u] = await db().select().from(users).where(eq(users.id, p.userId));
    expect(u!.perfectStreak).toBe(0);
    expect(u!.bestPerfectStreak).toBe(5);
  });
});

