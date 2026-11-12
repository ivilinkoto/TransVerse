import { eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the season as released (before 13.12 it is staff-only).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { arrivesAtNight, CHRISTMAS_NIGHT, CHRISTMAS_NIGHT_TASKS, inChristmasNightWindow } from '@/lib/game/christmas-night';
import { taskIncrements, weekTasks, TITLES } from '@/lib/game/first-snow';
import { ITEMS } from '@/lib/game/items';
import { PASS_REWARDS_CN, PASS_REWARDS_V2, passRewards, SEASON_TRUCK_LOOK } from '@/lib/game/season-pass';
import { closeDb } from '@/server/db/client';
import { jobState, seasons, userBadges } from '@/server/db/schema';
import { awardSantas, recordSnowSeason, santaRanking } from '@/server/game/first-snow';
import { activeSeason, newSeasonSetup, upgradeToChristmasNight } from '@/server/game/seasons';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const DEC = new Date('2026-12-18T20:00:00+02:00');

/** A plain season (version-2 pass, no theme) on top of the others for the body, then gone. */
async function withPlainSeason<T>(startsAt: Date, body: (id: number) => Promise<T>): Promise<T> {
  await activeSeason(db());
  const [s] = await db().insert(seasons).values({ name: 'Сезон декември 2026', startsAt, endsAt: new Date(startsAt.getTime() + 28 * 86_400_000), status: 'active', rules: { lengthDays: 28, prizesCents: [], pass: 2 } }).returning();
  try {
    return await body(s!.id);
  } finally {
    await db().delete(jobState).where(like(jobState.key, `%:${s!.id}:%`));
    await db().delete(jobState).where(eq(jobState.key, `santa-awarded:${s!.id}`));
    await db().delete(seasons).where(eq(seasons.id, s!.id));
  }
}

describe('1.4 „Коледна нощ“', () => {
  it('a season that starts in December is „Коледна нощ“; one that starts in „Първи сняг“ is not', () => {
    expect(newSeasonSetup(new Date('2026-12-11T09:00:00+02:00'), true)).toMatchObject({ name: CHRISTMAS_NIGHT.seasonName, rules: { pass: 2, theme: 'christmas_night' } });
    expect(newSeasonSetup(new Date('2026-11-20T09:00:00+02:00'), true).rules.theme).toBe('first_snow');
    expect(newSeasonSetup(new Date('2027-01-08T09:00:00+02:00'), true).rules.theme).toBeUndefined();
    expect(inChristmasNightWindow(new Date('2026-11-30T23:00:00+02:00'))).toBe(false);
  });

  it('has its own pass rewards: the paint, the frame, two titles and the season truck', () => {
    expect(passRewards(2, 'christmas_night')).toBe(PASS_REWARDS_CN);
    expect(passRewards(2, 'first_snow')).toBe(PASS_REWARDS_V2);
    expect(passRewards(2, null)).toBe(PASS_REWARDS_V2);
    const all = PASS_REWARDS_CN.flatMap((r) => [r.free, r.premium]).filter(Boolean);
    const items = all.flatMap((r) => r!.items ?? []).map((i) => i.itemId);
    expect(items).toContain('paint_christmasnight');
    expect(items).toContain('night_frame');
    for (const id of items) expect(ITEMS[id as keyof typeof ITEMS]).toBeTruthy();
    for (const r of all) if (r!.title) expect(TITLES[r!.title]).toBeTruthy();
    expect(PASS_REWARDS_CN[49]!.premium.truck).toBe(CHRISTMAS_NIGHT.truck);
    expect(SEASON_TRUCK_LOOK[CHRISTMAS_NIGHT.truck]).toMatchObject({ livery: 'christmasnight' });
    expect(PASS_REWARDS_CN).toHaveLength(50);
  });

  it('weekly tasks: the season adds Christmas loads (from 15.12) and night arrivals', () => {
    const extra = { tasks: CHRISTMAS_NIGHT_TASKS, xmasOk: false };
    for (let w = 1; w <= 52; w++) expect(weekTasks(`2026-W${String(w).padStart(2, '0')}`, true, extra).some((x) => x.kind === 'xmas')).toBe(false);
    const seen = new Set<string>();
    for (let w = 1; w <= 52; w++) for (const x of weekTasks(`2026-W${String(w).padStart(2, '0')}`, true, { ...extra, xmasOk: true })) seen.add(x.kind);
    expect(seen.has('xmas')).toBe(true);
    expect(seen.has('night')).toBe(true);
    // Without the season the pool is as before.
    for (let w = 1; w <= 52; w++) expect(weekTasks(`2026-W${String(w).padStart(2, '0')}`).every((x) => x.kind !== 'xmas' && x.kind !== 'night')).toBe(true);
    const f = { loadedKm: 300, late: false, cargoType: 'pallets', convoy: false, destCountry: 'BG', tons: 10 };
    expect(taskIncrements({ ...f, holiday: 'christmas', night: true }, []).xmas).toBe(1);
    expect(taskIncrements({ ...f, holiday: null, night: true }, []).night).toBe(1);
    expect(arrivesAtNight(new Date('2026-12-18T20:00:00+02:00'))).toBe(true);
    expect(arrivesAtNight(new Date('2026-12-18T05:30:00+02:00'))).toBe(true);
    expect(arrivesAtNight(new Date('2026-12-18T12:00:00+02:00'))).toBe(false);
  });

  it('a plain season that started in December becomes „Коледна нощ“ when 1.4 is out — once', async () => {
    await withPlainSeason(new Date('2026-12-11T09:00:00+02:00'), async (id) => {
      expect(await upgradeToChristmasNight(db(), DEC)).toBe(true);
      const [s] = await db().select().from(seasons).where(eq(seasons.id, id));
      expect(s!.name).toBe(CHRISTMAS_NIGHT.seasonName);
      expect(s!.rules).toMatchObject({ pass: 2, theme: 'christmas_night', lengthDays: 28 });
      expect(await upgradeToChristmasNight(db(), DEC)).toBe(false);
    });
    // A season that started before December keeps its name.
    await withPlainSeason(new Date('2026-11-25T09:00:00+02:00'), async () => {
      expect(await upgradeToChristmasNight(db(), DEC)).toBe(false);
    });
  });

  it('„Дядо Коледа на пътищата“ counts Christmas loads and gives the top three titles and ТрансКоин', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await withPlainSeason(new Date('2026-12-11T09:00:00+02:00'), async (id) => {
      await upgradeToChristmasNight(db(), DEC);
      const facts = { loadedKm: 400, late: false, cargoType: 'pallets', convoy: false, destCountry: 'BG', holiday: 'christmas', goods: 'Коледни подаръци', roadEvents: [], ownerDrove: true };
      await db().transaction(async (tx) => {
        await recordSnowSeason(tx, { ...facts, userId: a.userId, tons: 18 }, DEC);
        await recordSnowSeason(tx, { ...facts, userId: b.userId, tons: 12 }, DEC);
        await recordSnowSeason(tx, { ...facts, userId: b.userId, tons: 10 }, DEC);
        // An ordinary load does not count.
        await recordSnowSeason(tx, { ...facts, userId: a.userId, tons: 30, holiday: null, goods: 'Палети' }, DEC);
      });
      const top = await santaRanking(db(), id);
      expect(top.map((k) => [k.userId, k.tons])).toEqual([[b.userId, 22], [a.userId, 18]]);
      await db().update(seasons).set({ status: 'finished' }).where(eq(seasons.id, id));
      expect(await awardSantas(db(), DEC)).toBe(2);
      expect(await awardSantas(db(), DEC)).toBe(0);
      const badges = await db().select().from(userBadges).where(eq(userBadges.userId, b.userId));
      expect(badges.map((x) => x.badge)).toContain('santa-of-roads');
    });
  });
});
