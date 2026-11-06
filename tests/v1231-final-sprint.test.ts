import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { adminGroupsFor, adminOnlyPath, adminPageOf, ADMIN_GROUPS } from '@/lib/admin-nav';
import { closeDb } from '@/server/db/client';
import { companies, jobState, notifications, seasonScores, seasons } from '@/server/db/schema';
import { adminTodo } from '@/server/admin-todo';
import { lastDayReminders, seasonRecap, seasonStanding } from '@/server/game/final-sprint';
import { activeSeason } from '@/server/game/seasons';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;

describe('1.2.3.1 „Финален спринт“', () => {
  it('a day before the end: one notification each with the place and the gaps', async () => {
    const [a, b] = [await newPlayer(), await newPlayer()];
    const season = await activeSeason(db());
    const top = (await seasonStanding(db(), season.id, 1))[0]?.points ?? 0;
    await db().insert(seasonScores).values([
      { seasonId: season.id, companyId: (await accountOf(a.userId)).id, points: top + 5_000, deliveries: 9 },
      { seasonId: season.id, companyId: (await accountOf(b.userId)).id, points: top + 4_000, deliveries: 7 },
    ]);
    const now = new Date(season.endsAt.getTime() - 3 * 3_600_000);
    await db().delete(jobState).where(like(jobState.key, `season-last-day:${season.id}:%`));
    expect(await lastDayReminders(db(), now)).toBeGreaterThanOrEqual(2);
    expect(await lastDayReminders(db(), now)).toBe(0);
    const forB = await db().select().from(notifications).where(eq(notifications.userId, b.userId));
    expect(forB.some((n) => n.body.includes('1000') || n.body.includes('1 000'))).toBe(true);
    expect(await lastDayReminders(db(), new Date(season.endsAt.getTime() - 30 * 3_600_000))).toBe(0);
  });

  it('the season recap: place, points, trips and the pass level', async () => {
    const p = await newPlayer();
    const season = await activeSeason(db());
    expect(await seasonRecap(db(), season.id, p.userId)).toBeNull();
    await db().insert(seasonScores).values({ seasonId: season.id, companyId: (await accountOf(p.userId)).id, points: 1_234, deliveries: 3 });
    const recap = (await seasonRecap(db(), season.id, p.userId))!;
    expect(recap.points).toBe(1_234);
    expect(recap.deliveries).toBe(3);
    expect(recap.place).toBeGreaterThan(0);
    expect(recap.season.id).toBe(season.id);
    expect((await db().select().from(seasons).where(and(eq(seasons.id, season.id)))).length).toBe(1);
  });

  it('the admin menu: groups, pages by role, the page of a path', () => {
    const all = ADMIN_GROUPS.flatMap((g) => g.pages.map((p) => p.href));
    expect(new Set(all).size).toBe(all.length);
    const support = adminGroupsFor(false).flatMap((g) => g.pages.map((p) => p.href));
    expect(support).toContain('/admin/tickets');
    expect(support).not.toContain('/admin/economy');
    expect(adminGroupsFor(true).flatMap((g) => g.pages).length).toBe(all.length);
    expect(adminPageOf('/admin')?.href).toBe('/admin');
    expect(adminPageOf('/admin/users/abc')?.href).toBe('/admin/users');
    expect(adminOnlyPath('/admin/audit')).toBe(true);
    expect(adminOnlyPath('/admin/reports')).toBe(false);
  });

  it('„Сега за правене“ shows only what waits, and support sees only its part', async () => {
    const forAdmin = await adminTodo(db(), new Date(), true);
    const forSupport = await adminTodo(db(), new Date(), false);
    expect(forAdmin.every((i) => i.count > 0)).toBe(true);
    expect(forSupport.every((i) => i.id === 'tickets' || i.id === 'reports')).toBe(true);
  });
});
