import { and, eq, gt, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Dress rehearsal of 12–20 November 2026 with the real release dates (no feature mocks):
 * 1.2.5 „Първи сняг“ goes live on the 12th at 10:00, the season turns on the 13th,
 * and 1.2.4 „Преди зимата“ comes out on the 20th (a lower number, later).
 */
import { featureLive } from '@/lib/game/features';
import { isEarlySnow, isSnowTime, roadCondition } from '@/lib/game/winter';
import { PASS_V2 } from '@/lib/game/season-pass';
import { DEFAULT_SEASON_RULES } from '@/server/game/seasons';
import { latestPublished, unseenRelease } from '@/lib/game/releases';
import { closeDb } from '@/server/db/client';
import { companies, jobState, notifications, seasonScores, seasons } from '@/server/db/schema';
import { lastDayReminders, seasonRecap } from '@/server/game/final-sprint';
import { passTasksView } from '@/server/game/first-snow';
import { passView } from '@/server/game/season-pass';
import { activeSeason, rotateSeasons } from '@/server/game/seasons';
import { db, newPlayer } from './helpers';

const at = (s: string) => new Date(s);
const BEFORE = at('2026-11-12T09:00:00+02:00');
const LIVE = at('2026-11-12T10:30:00+02:00');
const ROTATE = at('2026-11-13T10:05:00+02:00');
const SEASON_END = at('2026-11-13T10:00:00+02:00');

let original: typeof seasons.$inferSelect;

beforeAll(async () => {
  original = await activeSeason(db());
});

afterAll(async () => {
  // Leave the shared test database as it was: the season the rehearsal opened goes, the old one is active again.
  await db().delete(seasons).where(gt(seasons.id, original.id));
  await db().update(seasons).set({ status: 'active', startsAt: original.startsAt, endsAt: original.endsAt, rules: original.rules }).where(eq(seasons.id, original.id));
  await closeDb();
});

describe('rehearsal: 12–20 November 2026', () => {
  it('the release date: 1.3 „Зимен път“ (with the former 1.2.4–1.2.6) on the 12th at 10:00', () => {
    expect(featureLive('season_v2', BEFORE)).toBe(false);
    expect(featureLive('season_v2', LIVE)).toBe(true);
    // „Преди зимата“ is part of 1.3 now; its server goal still runs by its own dates (20–30 November).
    expect(featureLive('winter_prep', BEFORE)).toBe(false);
    expect(featureLive('winter_prep', LIVE)).toBe(true);
  });

  it('„Какво ново“ shows 1.3 once, from the 12th', () => {
    expect(latestPublished(LIVE)?.version).toBe('1.3');
    expect(unseenRelease('1.2.3.2', LIVE)?.version).toBe('1.3');
    expect(unseenRelease('1.3', LIVE)).toBeNull();
    // Nothing new on the 20th any more: the November update came out whole on the 12th.
    expect(latestPublished(at('2026-11-20T11:00:00+02:00'))?.version).toBe('1.3');
  });

  it('the season that runs keeps its old pass on the 12th; the last-day reminder goes out', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    await db().update(seasons).set({ startsAt: at('2026-10-16T10:00:00+02:00'), endsAt: SEASON_END, rules: DEFAULT_SEASON_RULES }).where(eq(seasons.id, original.id));
    await db().insert(seasonScores).values({ seasonId: original.id, companyId: account!.id, points: 5_000, deliveries: 4 }).onConflictDoNothing();

    const before = await passView(db(), p.userId, BEFORE);
    expect(before.version).toBe(1);
    const live = await passView(db(), p.userId, LIVE);
    expect(live.version).toBe(1); // the new pass starts with the new season
    expect(await passTasksView(db(), p.userId, LIVE)).toBeFalsy(); // no weekly tasks with the old pass

    await db().delete(jobState).where(like(jobState.key, `season-last-day:${original.id}:%`));
    expect(await lastDayReminders(db(), LIVE)).toBeGreaterThanOrEqual(1);
    const mine = await db().select().from(notifications).where(eq(notifications.userId, p.userId));
    expect(mine.length).toBeGreaterThanOrEqual(1);
  });

  it('on the 13th the season turns into „Първи сняг“ with the 50-level pass and weekly tasks', async () => {
    expect(await rotateSeasons(db(), ROTATE)).toBe(1);
    const [old] = await db().select().from(seasons).where(eq(seasons.id, original.id));
    expect(old!.status).toBe('finished');
    const now = await activeSeason(db(), ROTATE);
    expect(now.id).toBeGreaterThan(original.id);
    expect(now.name).toBe('Сезон „Първи сняг“');
    expect((now.rules as { pass?: number; theme?: string }).pass).toBe(2);
    expect((now.rules as { theme?: string }).theme).toBe('first_snow');
    expect(now.endsAt.getTime() - now.startsAt.getTime()).toBe(28 * 86_400_000);

    const p = await newPlayer();
    const view = await passView(db(), p.userId, ROTATE);
    expect(view.version).toBe(2);
    expect(view.max).toBe(PASS_V2.levels);
    expect(view.points).toBe(0);
    expect(await passTasksView(db(), p.userId, ROTATE)).toHaveLength(3);
  });

  it('the old season: final places, the recap and its link in the notification', async () => {
    const rows = await db().select().from(seasonScores).where(and(eq(seasonScores.seasonId, original.id), gt(seasonScores.points, 0)));
    expect(rows.every((r) => r.finalRank != null)).toBe(true);
    const owner = await db().select({ ownerId: companies.ownerId }).from(companies).where(inArray(companies.id, rows.map((r) => r.companyId)));
    const recap = await seasonRecap(db(), original.id, owner[0]!.ownerId);
    expect(recap?.place).toBeGreaterThan(0);
    const told = await db().select().from(notifications).where(and(eq(notifications.userId, owner[0]!.ownerId), like(notifications.href, `/game/seasons/recap/${original.id}%`)));
    expect(told.length).toBe(1);
  });

  it('the first snow: light snow in the mountains from the 13th, no ice before December', () => {
    const days = Array.from({ length: 18 }, (_, i) => new Date(Date.UTC(2026, 10, 13 + i, 10)));
    expect(isEarlySnow(at('2026-11-12T12:00:00+02:00'))).toBe(false);
    expect(days.every((d) => isEarlySnow(d) && isSnowTime(d))).toBe(true);
    const snowy = (c: string) => days.filter((d) => roadCondition(c, d) === 'snow').length;
    expect(days.every((d) => ['clear', 'snow'].includes(roadCondition('AT', d)))).toBe(true);
    expect(snowy('AT') + snowy('CH') + snowy('RU')).toBeGreaterThan(0);
    expect(snowy('GR')).toBe(0);
    expect(snowy('ES')).toBe(0);
    expect(isEarlySnow(at('2026-12-02T12:00:00+02:00'))).toBe(false); // winter itself
    expect(isSnowTime(at('2026-12-02T12:00:00+02:00'))).toBe(true);
  });
});
