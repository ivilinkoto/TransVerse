import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { BLACK_FRIDAY, isBlackFriday, isPrewinter, PREWINTER, prewinterKey } from '@/lib/game/prewinter';
import { normalizeSource, sourceFromCookie } from '@/lib/game/signup-source';
import { signupSources } from '@/server/admin-sources';
import { closeDb } from '@/server/db/client';
import { jobState, userBadges, users } from '@/server/db/schema';
import { prewinterGoal, prewinterLoadsOf, recordPrewinterDelivery, winterTyreDiscount, winterWeekPay } from '@/server/game/prewinter';
import { shopPrice } from '@/server/game/shop';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const nov22 = new Date('2026-11-22T12:00:00+02:00');
const coinsOf = async (id: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, id)))[0]!.c;

describe('1.2.4 before winter', () => {
  it('the windows: winter goods 20–30 Nov, Black Friday 27–30 Nov', () => {
    expect(isPrewinter(new Date('2026-11-19T12:00:00+02:00'))).toBe(false);
    expect(isPrewinter(nov22)).toBe(true);
    expect(isPrewinter(new Date('2026-12-01T12:00:00+02:00'))).toBe(false);
    expect(isBlackFriday(new Date('2026-11-26T23:00:00+02:00'))).toBe(false);
    expect(isBlackFriday(new Date('2026-11-27T08:00:00+02:00'))).toBe(true);
    expect(isBlackFriday(new Date('2026-11-30T22:00:00+02:00'))).toBe(true);
  });

  it('Black Friday: −30% on most items, not on VIP; the better of it and the weekly offer', () => {
    const fri = new Date('2026-11-27T12:00:00+02:00');
    expect(shopPrice('rename', 100, true, fri, true)).toBe(Math.round(100 * (1 - BLACK_FRIDAY.discount)));
    expect(shopPrice('rename', 100, true, fri, false)).toBeGreaterThanOrEqual(75);
    expect(shopPrice('vip_30', 500, true, fri, true)).toBe(shopPrice('vip_30', 500, true, fri, false));
    expect(shopPrice('paint_blackfriday', 90, true, fri, true)).toBe(90);
  });

  it('winter tyres cost less until 30 November only', () => {
    expect(winterTyreDiscount('winter_tyres', nov22, true)).toBe(PREWINTER.tyreDiscount);
    expect(winterTyreDiscount('all_season_tyres', nov22, true)).toBe(PREWINTER.tyreDiscount);
    expect(winterTyreDiscount('eco_tune', nov22, true)).toBe(0);
    expect(winterTyreDiscount('winter_tyres', new Date('2026-12-02T12:00:00+02:00'), true)).toBe(0);
    expect(winterTyreDiscount('winter_tyres', nov22, false)).toBe(0);
  });

  it('winter loads fill the server goal, five on time give the badge once, and the first winter week pays more', async () => {
    const p = await newPlayer();
    // A year of its own, so the shared goal of other tests is not touched.
    const at = new Date('2031-11-22T12:00:00+02:00');
    const key = prewinterKey(at);
    await db().delete(jobState).where(like(jobState.key, `${key}%`));
    const c0 = await coinsOf(p.userId);
    await db().transaction((tx) => recordPrewinterDelivery(tx, p.userId, { holiday: 'winter', tons: 20, late: false }, at));
    expect((await prewinterGoal(db(), at)).tons).toBe(0);
    await db().transaction((tx) => recordPrewinterDelivery(tx, p.userId, { holiday: 'prewinter', tons: 20, late: true }, at));
    expect(await prewinterLoadsOf(db(), p.userId, at)).toBe(0);
    for (let i = 0; i < PREWINTER.loadsForBadge + 1; i++) await db().transaction((tx) => recordPrewinterDelivery(tx, p.userId, { holiday: 'prewinter', tons: 20, late: false }, at));
    expect(await prewinterLoadsOf(db(), p.userId, at)).toBe(PREWINTER.loadsForBadge + 1);
    expect(await coinsOf(p.userId)).toBe(c0 + PREWINTER.coins);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, PREWINTER.badge)))).toHaveLength(1);
    const g = await prewinterGoal(db(), at);
    expect(g.tons).toBe(20 * (PREWINTER.loadsForBadge + 2));
    expect(g.reached).toBe(false);
    const dec3 = new Date('2031-12-03T12:00:00+02:00');
    expect(await winterWeekPay(db(), dec3)).toBe(1);
    await db().transaction((tx) => recordPrewinterDelivery(tx, p.userId, { holiday: 'prewinter', tons: PREWINTER.goalTons, late: false }, at));
    expect((await prewinterGoal(db(), at)).reached).toBe(true);
    expect(await winterWeekPay(db(), dec3)).toBe(PREWINTER.winterWeek.multiplier);
    expect(await winterWeekPay(db(), new Date('2031-12-09T12:00:00+02:00'))).toBe(1);
  });

  it('signup sources: only clean names, from the cookie; counted per source', async () => {
    expect(normalizeSource('FB-Shipka')).toBe('fb-shipka');
    expect(normalizeSource('<script>')).toBeNull();
    expect(normalizeSource('x')).toBeNull();
    expect(sourceFromCookie('a=1; tv_src=fb-test; b=2')).toBe('fb-test');
    expect(sourceFromCookie('a=1')).toBeNull();
    const src = `t-${Date.now().toString(36)}`;
    const [a, b] = [await newPlayer(), await newPlayer()];
    await db().update(users).set({ signupSource: src, lastSeenAt: new Date(), level: 3 }).where(eq(users.id, a.userId));
    await db().update(users).set({ signupSource: src }).where(eq(users.id, b.userId));
    const row = (await signupSources(db(), new Date(), 1000)).find((r) => r.source === src)!;
    expect(row.signups).toBe(2);
    expect(row.active).toBe(1);
    expect(row.level3).toBe(1);
    expect(row.paying).toBe(0);
  });
});
