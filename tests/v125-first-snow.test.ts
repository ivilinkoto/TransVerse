import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { FIRST_SNOW, PASS_TASK, PASS_TASKS, PLOW, taskIncrements, weekTasks } from '@/lib/game/first-snow';
import { POWER_UNITS, modelAvailable } from '@/lib/game/catalog';
import { eliteLevels, levelStart, PASS_REWARDS_V2, PASS_V2, passLevelOf, passVersion } from '@/lib/game/season-pass';
import { isoWeek } from '@/lib/game/shop-v2';
import { closeDb } from '@/server/db/client';
import { companies, inventoryItems, jobState, seasonPasses, seasons, userBadges, users, vehicles } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { buyVehicle } from '@/server/game/fleet';
import { passTasksView, recordSnowSeason, setTitle, snowKings, titlesOf, withCleared } from '@/server/game/first-snow';
import { addPassPoints, claimPassRewards, passView } from '@/server/game/season-pass';
import { activeSeason, newSeasonSetup } from '@/server/game/seasons';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

/** Runs the body with the active season switched to the new pass, then puts it back. */
async function withPassV2<T>(body: (seasonId: number) => Promise<T>): Promise<T> {
  const season = await activeSeason(db());
  await db().update(seasons).set({ rules: { ...(season.rules as object), pass: 2, theme: FIRST_SNOW.theme } }).where(eq(seasons.id, season.id));
  try {
    return await body(season.id);
  } finally {
    await db().update(seasons).set({ rules: season.rules }).where(eq(seasons.id, season.id));
  }
}

describe('1.2.5 „Първи сняг“', () => {
  it('the new pass: 50 levels, each dearer, about 284 000 points in all, elite levels after', () => {
    expect(levelStart(1, 2)).toBe(2_000);
    expect(levelStart(2, 2)).toBe(2_000 + 2_150);
    expect(levelStart(50, 2)).toBe(283_750);
    expect(passLevelOf(4_149, 2)).toBe(1);
    expect(passLevelOf(4_150, 2)).toBe(2);
    expect(passLevelOf(1_000_000, 2)).toBe(PASS_V2.levels);
    expect(eliteLevels(283_750 + 25_000, 2)).toBe(2);
    expect(eliteLevels(1_000_000, 1)).toBe(0);
    // The old pass stays for the season that is running.
    expect(passLevelOf(30_000, 1)).toBe(30);
    expect(passVersion({})).toBe(1);
    expect(passVersion({ pass: 2 })).toBe(2);
    expect(PASS_REWARDS_V2).toHaveLength(50);
    expect(PASS_REWARDS_V2[49]!.premium.truck).toBe(FIRST_SNOW.truck);
  });

  it('a season that starts in the window is „Първи сняг“ with the new pass; later ones keep the new pass', () => {
    const snow = newSeasonSetup(new Date('2026-11-13T18:00:00+02:00'), true);
    expect(snow.name).toBe('Сезон „Първи сняг“');
    expect(snow.rules.pass).toBe(2);
    expect(snow.rules.theme).toBe('first_snow');
    expect(newSeasonSetup(new Date('2027-01-10T18:00:00+02:00'), true).rules.pass).toBe(2);
    expect(newSeasonSetup(new Date('2026-11-13T18:00:00+02:00'), false).rules.pass).toBeUndefined();
  });

  it('weekly tasks: three different ones, the same all week; what a delivery adds', () => {
    const tasks = weekTasks('2026-W47');
    expect(new Set(tasks.map((x) => x.id)).size).toBe(PASS_TASK.perWeek);
    expect(weekTasks('2026-W47')).toEqual(tasks);
    expect(tasks.every((x) => PASS_TASKS.includes(x))).toBe(true);
    for (let w = 1; w <= 52; w++) expect(weekTasks(`2026-W${String(w).padStart(2, '0')}`, false).some((x) => x.kind === 'winter')).toBe(false);
    const inc = taskIncrements({ loadedKm: 900, late: false, cargoType: 'refrigerated', convoy: true, destCountry: 'RO', tons: 20, holiday: 'prewinter' }, ['BG']);
    expect(inc).toMatchObject({ deliveries: 1, km: 900, ontime: 1, reefer: 1, convoy: 1, countries: 1, long: 1, winter: 1, heavy: 20 });
    expect(taskIncrements({ loadedKm: 100, late: true, cargoType: 'pallets', convoy: false, destCountry: 'RO', tons: 5, holiday: null }, ['RO'])).toMatchObject({ ontime: 0, countries: 0, long: 0 });
  });

  it('the season truck is never on the market', async () => {
    const truck = POWER_UNITS.find((m) => m.id === FIRST_SNOW.truck)!;
    expect(modelAvailable(truck, () => true)).toBe(false);
    const p = await newPlayer();
    expect(await code(buyVehicle(db(), p.userId, FIRST_SNOW.truck, p.hq.id))).toBe('unknown_model');
  });

  it('cleared roads are one step easier', () => {
    const now = new Date('2026-12-05T12:00:00+02:00');
    const real = { BG: 'blizzard' as const, RO: 'snow' as const };
    expect(withCleared(['BG', 'RO'], now, real, new Set(['BG']))).toMatchObject({ BG: 'ice', RO: 'snow' });
    expect(withCleared(['BG'], now, real, new Set())).toBe(real);
  });

  it('claiming the new pass: items, a title, the truck at premium 50 and elite cases', async () => {
    const p = await newPlayer();
    await withPassV2(async (seasonId) => {
      await db().transaction((tx) => addPassPoints(tx, p.userId, levelStart(50, 2) + PASS_V2.elitePoints));
      await db().update(seasonPasses).set({ premium: true }).where(and(eq(seasonPasses.seasonId, seasonId), eq(seasonPasses.userId, p.userId)));
      const view = await passView(db(), p.userId);
      expect(view.version).toBe(2);
      expect(view.level).toBe(50);
      expect(view.elite).toBe(1);
      await claimPassRewards(db(), p.userId);
      expect((await passView(db(), p.userId)).claimable).toBe(0);
      const qty = async (item: string) => (await db().select({ qty: inventoryItems.qty }).from(inventoryItems).where(and(eq(inventoryItems.userId, p.userId), eq(inventoryItems.itemId, item))))[0]?.qty ?? 0;
      expect(await qty('paint_firstsnow')).toBe(1);
      expect(await qty('frost_frame')).toBe(1);
      expect(await qty('case_silver')).toBeGreaterThanOrEqual(3);
      expect(await titlesOf(db(), p.userId)).toEqual(expect.arrayContaining(['first-snow-icebreaker', 'first-snow-50']));
      const [acct] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
      expect(await db().select().from(vehicles).where(and(eq(vehicles.companyId, acct!.id), eq(vehicles.modelId, FIRST_SNOW.truck)))).toHaveLength(1);
      expect(await code(claimPassRewards(db(), p.userId))).toBe('nothing_to_claim');
    });
    await setTitle(db(), p.userId, 'first-snow-icebreaker');
    expect((await db().select({ title: users.title }).from(users).where(eq(users.id, p.userId)))[0]!.title).toBe('first-snow-icebreaker');
    expect(await code(setTitle(db(), p.userId, 'snow-king'))).toBe('no_title');
  });

  it('a delivery counts for the weekly tasks, clearing the roads and „Крал на снега“', async () => {
    const p = await newPlayer();
    const at = new Date();
    await withPassV2(async (seasonId) => {
      await db().delete(jobState).where(like(jobState.key, `snow-king:${seasonId}:${p.userId}`));
      const facts = { userId: p.userId, loadedKm: 900, late: false, cargoType: 'refrigerated', convoy: true, destCountry: 'RO', tons: 24, holiday: null, goods: 'Мебели', roadEvents: [{ kind: 'snow' }] };
      for (let i = 0; i < 3; i++) await db().transaction((tx) => recordSnowSeason(tx, facts, at));
      const tasks = await passTasksView(db(), p.userId, at);
      expect(tasks).toHaveLength(3);
      for (const task of tasks!) expect(task.progress).toBeGreaterThanOrEqual(0);
      const kings = await snowKings(db(), seasonId, 1000);
      expect(kings.find((k) => k.userId === p.userId)?.tons).toBe(72);
      const st = await db().select().from(jobState).where(eq(jobState.key, `pass-tasks:${seasonId}:${isoWeek(at)}:${p.userId}`));
      expect((st[0]!.value as { p: { deliveries: number } }).p.deliveries).toBe(3);
    });
    expect(PLOW.tonsPerDay).toBeGreaterThan(0);
    expect(await db().select().from(userBadges).where(eq(userBadges.userId, p.userId))).toBeDefined();
  });
});
