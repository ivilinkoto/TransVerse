import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the feature as released (before 13.12 it is staff-only).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { STAFF, staffName, withStaff } from '@/lib/game/base-staff';
import { memberBonuses } from '@/lib/game/company';
import { closeDb } from '@/server/db/client';
import { companyMessages, jobState, organizations } from '@/server/db/schema';
import { fireStaff, hireStaff, runBaseStaff, staffOf } from '@/server/game/base-staff';
import { GameError } from '@/server/game/errors';
import { bonusesForUser } from '@/server/game/membership';
import { db, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;

describe('1.4 „Персонал на базата“', () => {
  it('each role adds a small bonus on top of the buildings', () => {
    const b = memberBonuses({ service: 1, logistics: 1, rest: 1, training: 1 });
    const s = withStaff(b, ['mechanic', 'dispatcher', 'cook', 'instructor']);
    expect(s.repairDiscount - b.repairDiscount).toBeCloseTo(0.05);
    expect(s.rewardMultiplier - b.rewardMultiplier).toBeCloseTo(0.01);
    expect(s.restCut - b.restCut).toBeCloseTo(0.05);
    expect(s.xpMultiplier - b.xpMultiplier).toBeCloseTo(0.03);
    expect(staffName('x')).toBe(staffName('x'));
    expect(staffName('x').split(' ')).toHaveLength(2);
  });

  it('needs the building, pays a week from the treasury, adds the bonus, posts a story, leaves without money', async () => {
    const p = await playerWithCompany();
    const org = await orgOf(p.userId);
    const now = new Date('2026-12-15T10:00:00+02:00');
    expect(await code(hireStaff(db(), p.userId, 'mechanic', now))).toBe('no_building');
    await db().update(organizations).set({ upgrades: { service: 1 }, treasuryCents: 10_000_00 }).where(eq(organizations.id, org.id));
    expect(await code(hireStaff(db(), p.userId, 'mechanic', now))).toBe('ok');
    expect(await code(hireStaff(db(), p.userId, 'mechanic', now))).toBe('hired');
    const [o] = await db().select({ t: organizations.treasuryCents }).from(organizations).where(eq(organizations.id, org.id));
    expect(o!.t).toBe(10_000_00 - STAFF.mechanic.weeklyCents);
    const b = (await bonusesForUser(db(), p.userId))!.bonuses;
    expect(b.repairDiscount).toBeCloseTo(memberBonuses({ service: 1 }).repairDiscount + 0.05);
    // The same week is not paid twice; a story a day.
    await runBaseStaff(db(), now);
    await runBaseStaff(db(), now);
    const msgs = await db().select().from(companyMessages).where(eq(companyMessages.companyId, org.id));
    expect(msgs.length).toBe(1);
    expect(msgs[0]!.body.startsWith(STAFF.mechanic.emoji)).toBe(true);
    // Next week with an empty treasury: the mechanic leaves.
    await db().update(organizations).set({ treasuryCents: 0 }).where(eq(organizations.id, org.id));
    await runBaseStaff(db(), new Date(now.getTime() + 7 * 86_400_000));
    expect(await staffOf(db(), org.id)).toEqual({});
    // Hire again and let go.
    await db().update(organizations).set({ treasuryCents: 10_000_00 }).where(eq(organizations.id, org.id));
    await hireStaff(db(), p.userId, 'mechanic', new Date(now.getTime() + 8 * 86_400_000));
    expect(await code(fireStaff(db(), p.userId, 'mechanic', now))).toBe('ok');
    expect(await code(fireStaff(db(), p.userId, 'mechanic', now))).toBe('not_hired');
    await db().delete(jobState).where(and(like(jobState.key, `base-staff%${org.id}%`)));
  });
});
