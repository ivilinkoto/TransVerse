import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the feature as released (before 13.12 it is staff-only).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { FIRST_WEEK, FIRST_WEEK_STEPS, signupDay } from '@/lib/game/first-week';
import { closeDb } from '@/server/db/client';
import { companies, jobState, userBadges, users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { claimFirstWeek, firstWeekView } from '@/server/game/first-week';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const DAY = 86_400_000;

describe('1.4 „Първите 7 дни“', () => {
  it('a step a day, from the sign-up day', () => {
    const c = new Date('2026-12-14T10:00:00Z');
    expect(signupDay(c, new Date('2026-12-14T23:00:00Z'))).toBe(1);
    expect(signupDay(c, new Date('2026-12-16T11:00:00Z'))).toBe(3);
    expect(FIRST_WEEK_STEPS.map((s) => s.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('opens by day, pays when done, once; the last step gives the badge; gone after the third week', async () => {
    const p = await newPlayer();
    const [u] = await db().select({ createdAt: users.createdAt }).from(users).where(eq(users.id, p.userId));
    const at = (day: number) => new Date(u!.createdAt.getTime() + (day - 1) * DAY + 3_600_000);
    const v1 = (await firstWeekView(db(), p.userId, at(1)))!;
    expect(v1.steps.filter((s) => s.open).map((s) => s.id)).toEqual(['first-load']);
    expect(await code(claimFirstWeek(db(), p.userId, 'first-load', at(1)))).toBe('not_done');
    expect(await code(claimFirstWeek(db(), p.userId, 'daily-route', at(1)))).toBe('not_yet');
    // The daily puzzle played: the third step can be claimed from day 3.
    await db().insert(jobState).values({ key: `daily-route:D2026-12-16:${p.userId}`, value: { tries: [{ order: [1, 2], km: 100, pct: 90, at: new Date().toISOString() }] } });
    const [co] = await db().select({ balance: companies.balanceCents, id: companies.id }).from(companies).where(eq(companies.ownerId, p.userId));
    expect(await code(claimFirstWeek(db(), p.userId, 'daily-route', at(3)))).toBe('ok');
    const [after] = await db().select({ balance: companies.balanceCents }).from(companies).where(eq(companies.id, co!.id));
    expect(after!.balance - co!.balance).toBe(FIRST_WEEK_STEPS.find((s) => s.id === 'daily-route')!.cents);
    expect(await code(claimFirstWeek(db(), p.userId, 'daily-route', at(3)))).toBe('claimed');
    // Pretend all other steps are claimed but one: the last claim gives the badge.
    await db().update(jobState).set({ value: { claimed: FIRST_WEEK_STEPS.filter((s) => s.id !== 'second-truck').map((s) => s.id) } }).where(eq(jobState.key, `first-week:${p.userId}`));
    await db().update(users).set({ level: 4 }).where(eq(users.id, p.userId));
    const v7 = (await firstWeekView(db(), p.userId, at(7)))!;
    expect(v7.steps.find((s) => s.id === 'second-truck')!.open).toBe(true);
    expect(await code(claimFirstWeek(db(), p.userId, 'nope', at(7)))).toBe('no_step');
    expect((await firstWeekView(db(), p.userId, at(FIRST_WEEK.openDays + 1)))).toBeNull();
    const q = await newPlayer();
    await db().insert(jobState).values({ key: `first-week:${q.userId}`, value: { claimed: FIRST_WEEK_STEPS.slice(0, 6).map((s) => s.id) } });
    await db().update(users).set({ level: 4, createdAt: new Date(Date.now() - 8 * DAY) }).where(eq(users.id, q.userId));
    expect(await code(claimFirstWeek(db(), q.userId, 'level-4', new Date()))).toBe('ok');
    expect((await db().select().from(userBadges).where(eq(userBadges.userId, q.userId))).map((b) => b.badge)).toContain(FIRST_WEEK.badge);
    expect(await firstWeekView(db(), q.userId, new Date())).toBeNull();
  });
});
