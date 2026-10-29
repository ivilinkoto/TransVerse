import { and, eq } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { FEATURES } from '@/lib/game/features';
import { releaseByVersion } from '@/lib/game/releases';
import { modelAvailable, POWER_UNITS } from '@/lib/game/catalog';
import { COMPANY_ACHIEVEMENTS, companyMedal, medalCounts, playerMedal } from '@/lib/game/medals';
import { ACHIEVEMENT_TIERS, ACHIEVEMENTS } from '@/lib/game/progression';
import { BADGES } from '@/lib/game/halloween';
import { VehicleDrawing } from '@/components/vehicles/VehicleIllustration';
import { closeDb } from '@/server/db/client';
import { achievements, companies, companyMembers, notifications, organizationSeasonScores, organizations, seasons, seasonScores, userBadges, users, vehicles } from '@/server/db/schema';
import { achievementRarity, topCollectors } from '@/server/game/achievement-stats';
import { backfillMedalBadges, checkCompanyAchievements, companyAchievementsOf, organizationMedals, playerMedals } from '@/server/game/medals';
import { startTestDrive } from '@/server/game/rentals';
import { activeSeason, rotateSeasons } from '@/server/game/seasons';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const NEW_MODELS = ['sokol-cargo-72', 'hemus-r18-tipper', 'hemus-r18-tanker', 'danubia-t380-classic'];
const badges = async (userId: string) => (await db().select().from(userBadges).where(eq(userBadges.userId, userId))).map((b) => b.badge);
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;

describe('v1.1.3.1', () => {
  it('ships as its own release with its features', () => {
    for (const id of ['more_achievements', 'season_medals', 'company_achievements', 'new_vehicles_1131'] as const) expect(FEATURES[id]).toBe('1.1.3.1');
    expect(releaseByVersion('1.1.3.1')?.name).toBe('Медали');
  });

  it('15 new achievements, each with a tier, appear with the release', () => {
    const fresh = ACHIEVEMENTS.filter((a) => a.since === 'more_achievements');
    expect(fresh).toHaveLength(15);
    for (const tier of ACHIEVEMENT_TIERS) expect(fresh.some((a) => a.tier === tier)).toBe(true);
    expect(new Set(ACHIEVEMENTS.map((a) => a.key)).size).toBe(ACHIEVEMENTS.length);
  });

  it('rarity is a share of the players; collectors are sorted by count', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await db().insert(achievements).values([{ userId: a.userId, key: 'km_1000' }, { userId: a.userId, key: 'level_5' }, { userId: b.userId, key: 'km_1000' }]);
    const rarity = await achievementRarity(db());
    expect(rarity.get('km_1000')!).toBeGreaterThan(0);
    expect(rarity.get('km_1000')!).toBeLessThanOrEqual(1);
    expect(rarity.get('km_1000')!).toBeGreaterThanOrEqual(rarity.get('level_5')!);
    const top = await topCollectors(db(), 50);
    expect(top.map((c) => c.n)).toEqual([...top.map((c) => c.n)].sort((x, y) => y - x));
  });

  it('four new vehicles: hidden before the release, drawn, marked new, free to test drive', async () => {
    const models = POWER_UNITS.filter((m) => m.since === 'new_vehicles_1131');
    expect(models.map((m) => m.id).sort()).toEqual([...NEW_MODELS].sort());
    for (const m of models) {
      expect(m.newUntil).toBe('2026-11-12');
      expect(modelAvailable(m, () => false)).toBe(false);
      expect(modelAvailable(m, (f) => f === 'new_vehicles_1131')).toBe(true);
      const svg = renderToStaticMarkup(createElement(VehicleDrawing, { modelId: m.id, uid: 't' }));
      expect(svg).toContain('<svg');
    }
    expect(renderToStaticMarkup(createElement(VehicleDrawing, { modelId: 'hemus-r18-tanker', uid: 't' }))).toContain('33');

    const p = await newPlayer();
    await db().update(users).set({ level: 2 }).where(eq(users.id, p.userId));
    const drive = await startTestDrive(db(), p.userId, 'sokol-cargo-72');
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.id, drive.vehicleId));
    expect(truck!.modelId).toBe('sokol-cargo-72');
    expect(truck!.purchasePriceCents).toBe(0);
  });

  it('medal bands: players 1–3 / 4–10 / 11–25, companies 1 / 2 / 3', () => {
    expect([1, 3, 4, 10, 11, 25, 26].map(playerMedal)).toEqual(['gold', 'gold', 'silver', 'silver', 'bronze', 'bronze', null]);
    expect([1, 2, 3, 4, null].map(companyMedal)).toEqual(['gold', 'silver', 'bronze', null, null]);
    expect(medalCounts(['gold', 'gold', 'bronze', null])).toEqual({ gold: 2, silver: 0, bronze: 1 });
    for (const id of ['season-gold', 'season-silver', 'season-bronze']) expect(BADGES[id]).toBeDefined();
  });

  it('the season end gives medals to players and companies (badges, notifications); the backfill restores them', async () => {
    const solo = await newPlayer();
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    const season = await activeSeason(db());
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, solo.userId));
    await db().insert(seasonScores).values({ seasonId: season.id, companyId: account!.id, points: 2_000_000_000, deliveries: 1 });
    await db().insert(organizationSeasonScores).values({ seasonId: season.id, organizationId: org.id, points: 2_000_000_000, deliveries: 1 });
    await db().update(seasons).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(seasons.id, season.id));
    expect(await rotateSeasons(db())).toBe(1);

    expect(await badges(solo.userId)).toContain('season-gold');
    expect((await playerMedals(db(), solo.userId))[0]).toMatchObject({ seasonId: season.id, rank: 1, medal: 'gold' });
    expect(await badges(owner.userId)).toContain('season-gold');
    expect((await organizationMedals(db(), org.id))[0]).toMatchObject({ seasonId: season.id, rank: 1, medal: 'gold' });
    const notes = await db().select().from(notifications).where(and(eq(notifications.userId, solo.userId), eq(notifications.kind, 'achievement')));
    expect(notes.length).toBeGreaterThan(0);

    await db().delete(userBadges).where(and(eq(userBadges.userId, solo.userId), eq(userBadges.badge, 'season-gold')));
    expect(await backfillMedalBadges(db())).toBeGreaterThan(0);
    expect(await badges(solo.userId)).toContain('season-gold');
    expect(await backfillMedalBadges(db())).toBe(0);
  });

  it('company achievements are granted once and listed in catalogue order', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    const season = await activeSeason(db());
    await db().update(organizations).set({ treasuryCents: 1_000_000_00, companyLevel: 10 }).where(eq(organizations.id, org.id));
    await db().insert(organizationSeasonScores).values({ seasonId: season.id, organizationId: org.id, points: 10, deliveries: 120 }).onConflictDoUpdate({ target: [organizationSeasonScores.seasonId, organizationSeasonScores.organizationId], set: { deliveries: 120 } });
    await checkCompanyAchievements(db());
    const got = await companyAchievementsOf(db(), org.id);
    expect(got.map((a) => a.key)).toEqual(['co_trips_100', 'co_treasury_1m', 'co_level_10']);
    expect(COMPANY_ACHIEVEMENTS.map((a) => a.key).filter((k) => got.some((g) => g.key === k))).toEqual(got.map((a) => a.key));
    await checkCompanyAchievements(db());
    expect(await companyAchievementsOf(db(), org.id)).toHaveLength(3);
    const members = await db().select().from(companyMembers).where(eq(companyMembers.companyId, org.id));
    const notes = await db().select().from(notifications).where(and(eq(notifications.userId, members[0]!.userId), eq(notifications.kind, 'achievement')));
    expect(notes.length).toBeGreaterThanOrEqual(3);
  });
});
