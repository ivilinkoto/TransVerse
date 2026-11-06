import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// The features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { REGION_PROJECT, REGION_PROJECTS, regionTemplateFor } from '@/lib/game/region-projects';
import { closeDb } from '@/server/db/client';
import { chatMessages, regionProjects, userBadges } from '@/server/db/schema';
import { ensureRegionProject, recordRegionDelivery, regionProjectView } from '@/server/game/region-projects';
import { passView } from '@/server/game/season-pass';
import { db, newPlayer } from './helpers';

const made: string[] = [];
afterAll(async () => {
  if (made.length) await db().delete(regionProjects).where(inArray(regionProjects.id, made));
  await closeDb();
});

const tpl = REGION_PROJECTS.find((p) => p.id === 'winter-reserve')!;

describe('1.2.6 region projects', () => {
  it('one project a week, in turn, told in the „Проекти“ channel', async () => {
    const monday = new Date('2031-03-03T10:00:00+02:00');
    const id = await ensureRegionProject(db(), monday);
    expect(id).toBeTruthy();
    made.push(id!);
    expect(await ensureRegionProject(db(), new Date('2031-03-04T10:00:00+02:00'))).toBeNull();
    const [p] = await db().select().from(regionProjects).where(eq(regionProjects.id, id!));
    expect(p!.templateId).toBe(regionTemplateFor(p!.startsAt).id);
    expect(p!.endsAt.getTime() - p!.startsAt.getTime()).toBe(7 * 86_400_000);
    const [line] = await db().select().from(chatMessages).where(and(eq(chatMessages.channel, 'projects'), eq(chatMessages.kind, 'project'))).orderBy(chatMessages.id);
    expect(line).toBeTruthy();
    await db().update(regionProjects).set({ status: 'failed' }).where(eq(regionProjects.id, id!));
  });

  it('deliveries of the stage cargo to the country fill the stages; all who helped get points, the most — the title', async () => {
    const now = new Date();
    const [p] = await db().insert(regionProjects).values({ templateId: tpl.id, week: `T${now.getTime()}`, country: tpl.country, startsAt: new Date(now.getTime() - 3_600_000), endsAt: new Date(now.getTime() + 86_400_000) }).returning();
    made.push(p!.id);
    const a = await newPlayer();
    const b = await newPlayer();
    const rec = (userId: string, cargoType: string, tons: number, destCountry = tpl.country) => db().transaction((tx) => recordRegionDelivery(tx, userId, { cargoType, destCountry, tons }, now));
    // The wrong cargo or country does not count.
    expect(await rec(a.userId, 'pallets', 50)).toBe(false);
    expect(await rec(a.userId, tpl.stages[0]!.cargo, 50, 'RO')).toBe(false);
    const before = (await passView(db(), a.userId, now)).points;
    expect(await rec(a.userId, tpl.stages[0]!.cargo, tpl.stages[0]!.tons - 10)).toBe(true);
    expect((await regionProjectView(db(), a.userId, now))!.mine).toBe(tpl.stages[0]!.tons - 10);
    await rec(b.userId, tpl.stages[0]!.cargo, 20);
    const view = await regionProjectView(db(), b.userId, now);
    expect(view!.stage).toBe(2);
    expect(view!.progress).toBe(10);
    expect((await passView(db(), a.userId, now)).points - before).toBe(REGION_PROJECT.stagePoints);
    // The other stages.
    await rec(b.userId, tpl.stages[1]!.cargo, tpl.stages[1]!.tons);
    await rec(b.userId, tpl.stages[2]!.cargo, tpl.stages[2]!.tons);
    const [done] = await db().select().from(regionProjects).where(eq(regionProjects.id, p!.id));
    expect(done!.status).toBe('done');
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, b.userId), eq(userBadges.badge, REGION_PROJECT.title)))).toHaveLength(1);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, a.userId), eq(userBadges.badge, REGION_PROJECT.title)))).toHaveLength(0);
    expect((await passView(db(), a.userId, now)).points - before).toBe(REGION_PROJECT.stagePoints + REGION_PROJECT.finalPoints);
  });
});
