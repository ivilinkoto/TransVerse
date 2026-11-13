import { eq, gt } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Dress rehearsal of 11–28 December 2026 with the real release dates (no feature mocks):
 * „Първи сняг“ ends on the 11th and a plain season starts; 1.4 „Своя база“ comes out on the
 * 13th and that season becomes „Коледна нощ“; the Winter Games run 14–27 December.
 */
import { FEATURES, featureLive, type FeatureId } from '@/lib/game/features';
import { inWinterGames } from '@/lib/game/winter-games';
import { latestPublished } from '@/lib/game/releases';
import { closedByWeather, PASSES } from '@/lib/game/road-service';
import { passRewards, passVersion } from '@/lib/game/season-pass';
import { closeDb } from '@/server/db/client';
import { seasons } from '@/server/db/schema';
import { passTasksView } from '@/server/game/first-snow';
import { activeSeason, rotateSeasons, upgradeToChristmasNight } from '@/server/game/seasons';
import { db, newPlayer } from './helpers';

const at = (s: string) => new Date(s);
const NEW_14: FeatureId[] = ['christmas_night', 'road_service', 'city_courier', 'winter_games', 'first_week', 'base_staff'];

let original: typeof seasons.$inferSelect;
beforeAll(async () => {
  original = await activeSeason(db());
});
afterAll(async () => {
  await db().delete(seasons).where(gt(seasons.id, original.id));
  await db().update(seasons).set({ status: original.status, startsAt: original.startsAt, endsAt: original.endsAt, rules: original.rules, name: original.name }).where(eq(seasons.id, original.id));
  await closeDb();
});

describe('1.4 rehearsal', () => {
  it('the new features are staff-only until 13.12 00:00 and the release is 1.4 from then', () => {
    for (const id of NEW_14) {
      expect(FEATURES[id]).toBe('1.4');
      expect(featureLive(id, at('2026-12-12T23:59:00+02:00'))).toBe(false);
      expect(featureLive(id, at('2026-12-13T00:00:00+02:00'))).toBe(true);
      expect(featureLive(id, at('2026-12-12T12:00:00+02:00'), true)).toBe(true);
    }
    expect(latestPublished(at('2026-12-13T00:01:00+02:00'))?.version).toBe('1.4');
    expect(latestPublished(at('2026-12-12T23:59:00+02:00'))?.version).not.toBe('1.4');
  });

  it('„Първи сняг“ → a plain season on the 11th → „Коледна нощ“ on the 13th, with its rewards and tasks', async () => {
    // „Първи сняг“ as it runs in production: from 13.11 for 28 days.
    await db().update(seasons).set({ name: 'Сезон „Първи сняг“', startsAt: at('2026-11-13T10:00:00+02:00'), endsAt: at('2026-12-11T10:00:00+02:00'), status: 'active', rules: { lengthDays: 28, prizesCents: [], pass: 2, theme: 'first_snow' } }).where(eq(seasons.id, original.id));
    await rotateSeasons(db(), at('2026-12-11T10:05:00+02:00'));
    const plain = await activeSeason(db(), at('2026-12-11T10:05:00+02:00'));
    expect(plain.id).not.toBe(original.id);
    expect((plain.rules as { theme?: string }).theme).toBeUndefined();
    expect(await upgradeToChristmasNight(db(), at('2026-12-12T23:00:00+02:00'))).toBe(false);
    expect(await upgradeToChristmasNight(db(), at('2026-12-13T00:05:00+02:00'))).toBe(true);
    const cn = await activeSeason(db(), at('2026-12-13T00:05:00+02:00'));
    expect(cn.id).toBe(plain.id);
    expect(cn.name).toBe('Сезон „Коледна нощ“');
    expect(passRewards(passVersion(cn.rules), (cn.rules as { theme?: string }).theme)[49]!.premium.truck).toBe('rila-xt620');
    // In the week of 14–20 December the Christmas tasks can come up; the plain pool can never have them.
    const p = await newPlayer();
    const tasks = await passTasksView(db(), p.userId, at('2026-12-16T12:00:00+02:00'));
    expect(tasks).not.toBeNull();
    expect(tasks!.length).toBe(3);
  });

  it('the Winter Games run 14–27 December; winter closes some passes in December', () => {
    expect(inWinterGames(at('2026-12-13T23:59:00+02:00'))).toBe(false);
    expect(inWinterGames(at('2026-12-14T00:00:00+02:00'))).toBe(true);
    expect(inWinterGames(at('2026-12-27T23:59:00+02:00'))).toBe(true);
    expect(inWinterGames(at('2026-12-28T00:00:00+02:00'))).toBe(false);
    let closures = 0;
    for (let d = 13; d <= 31; d++) for (const p of PASSES) if (closedByWeather(p, at(`2026-12-${d}T12:00:00+02:00`), null)) closures++;
    // Some, but not every pass every day.
    expect(closures).toBeGreaterThan(5);
    expect(closures).toBeLessThan(19 * PASSES.length * 0.6);
  });
});
