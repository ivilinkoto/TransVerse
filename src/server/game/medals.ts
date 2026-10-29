import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, companyMembers, organizationAchievements, organizationSeasonScores, organizations, seasonScores, seasons, userBadges, users } from '@/server/db/schema';
import { featureLive } from '@/lib/game/features';
import { COMPANY_ACHIEVEMENTS, COMPANY_MEDAL_PLACES, MEDAL_INFO, PLAYER_MEDAL_PLACES, companyMedal, playerMedal, type CompanyStats, type Medal } from '@/lib/game/medals';
import { announceCompanyAchievement, announceGoldMedal } from '@/server/discord/announce';
import { notify } from './notify';
import { organizationSeasonResults } from './seasons';
import { t, tx as tr } from '@/i18n/t';

const MEDAL_TITLE: Record<Medal, string> = { gold: 'Златен медал!', silver: 'Сребърен медал!', bronze: 'Бронзов медал!' };

/** A player's medals from finished seasons (their own account's places), newest first. */
export async function playerMedals(db: DbOrTx, userId: string) {
  const rows = await db
    .select({ seasonId: seasons.id, name: seasons.name, rank: seasonScores.finalRank, points: seasonScores.points })
    .from(seasonScores)
    .innerJoin(companies, eq(companies.id, seasonScores.companyId))
    .innerJoin(seasons, eq(seasons.id, seasonScores.seasonId))
    .where(and(eq(companies.ownerId, userId), eq(seasons.status, 'finished'), lte(seasonScores.finalRank, PLAYER_MEDAL_PLACES.bronze), sql`${seasonScores.points} > 0`))
    .orderBy(desc(seasons.id));
  return rows.map((r) => ({ ...r, medal: playerMedal(r.rank)! }));
}

/** A company's medals from finished seasons, newest first. */
export async function organizationMedals(db: DbOrTx, organizationId: string) {
  return (await organizationSeasonResults(db, organizationId))
    .filter((r) => companyMedal(r.rank))
    .map((r) => ({ ...r, medal: companyMedal(r.rank)! }));
}

/**
 * At the end of a season (from rotateSeasons, after the final places are
 * stored): a medal badge, a notification and — for gold — a Discord post.
 */
export async function awardSeasonMedals(tx: Tx, season: { id: number; name: string }, now = new Date()) {
  if (!featureLive('season_medals', now)) return;
  const players = await tx
    .select({ userId: companies.ownerId, username: users.username, rank: seasonScores.finalRank })
    .from(seasonScores)
    .innerJoin(companies, eq(companies.id, seasonScores.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(seasonScores.seasonId, season.id), lte(seasonScores.finalRank, PLAYER_MEDAL_PLACES.bronze), sql`${seasonScores.points} > 0`));
  for (const p of players) {
    const medal = playerMedal(p.rank)!;
    await tx.insert(userBadges).values({ userId: p.userId, badge: MEDAL_INFO[medal].badge, awardedAt: now }).onConflictDoNothing();
    await notify(tx, p.userId, 'achievement', () => `${MEDAL_INFO[medal].icon} ${tr(MEDAL_TITLE[medal])}`, () => t('{0}: {1}. място в класацията на играчите. Медалът е в профила ти.', season.name, p.rank!), '/game/progress');
    if (medal === 'gold') await announceGoldMedal(tx, { kind: 'player', id: p.userId, name: p.username }, season, p.rank!, now);
  }
  const orgs = await tx
    .select({ id: organizations.id, name: organizations.name, rank: organizationSeasonScores.finalRank })
    .from(organizationSeasonScores)
    .innerJoin(organizations, eq(organizations.id, organizationSeasonScores.organizationId))
    .where(and(eq(organizationSeasonScores.seasonId, season.id), lte(organizationSeasonScores.finalRank, COMPANY_MEDAL_PLACES.bronze)));
  for (const o of orgs) {
    const medal = companyMedal(o.rank)!;
    const members = await tx.select({ userId: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.companyId, o.id));
    if (members.length) await tx.insert(userBadges).values(members.map((m) => ({ userId: m.userId, badge: MEDAL_INFO[medal].badge, awardedAt: now }))).onConflictDoNothing();
    for (const m of members) {
      await notify(tx, m.userId, 'achievement', () => `${MEDAL_INFO[medal].icon} ${tr(MEDAL_TITLE[medal])}`, () => t('{0}: „{1}“ е {2}. сред компаниите. Медалът е на профила на компанията.', season.name, o.name, o.rank!), `/game/companies/${o.id}`);
    }
    if (medal === 'gold') await announceGoldMedal(tx, { kind: 'company', id: o.id, name: o.name }, season, o.rank!, now);
  }
}

/** Once, on release: the medal badges for seasons that finished before medals existed (quietly, no notifications). */
export async function backfillMedalBadges(db: Database, now = new Date()): Promise<number> {
  if (!featureLive('season_medals', now)) return 0;
  const players = await db
    .select({ userId: companies.ownerId, rank: seasonScores.finalRank })
    .from(seasonScores)
    .innerJoin(companies, eq(companies.id, seasonScores.companyId))
    .innerJoin(seasons, eq(seasons.id, seasonScores.seasonId))
    .where(and(eq(seasons.status, 'finished'), lte(seasonScores.finalRank, PLAYER_MEDAL_PLACES.bronze), sql`${seasonScores.points} > 0`));
  const members = await db
    .select({ userId: companyMembers.userId, rank: organizationSeasonScores.finalRank })
    .from(organizationSeasonScores)
    .innerJoin(seasons, eq(seasons.id, organizationSeasonScores.seasonId))
    .innerJoin(companyMembers, eq(companyMembers.companyId, organizationSeasonScores.organizationId))
    .where(and(eq(seasons.status, 'finished'), lte(organizationSeasonScores.finalRank, COMPANY_MEDAL_PLACES.bronze)));
  const values = [
    ...players.map((p) => ({ userId: p.userId, badge: MEDAL_INFO[playerMedal(p.rank)!].badge, awardedAt: now })),
    ...members.map((m) => ({ userId: m.userId, badge: MEDAL_INFO[companyMedal(m.rank)!].badge, awardedAt: now })),
  ];
  if (!values.length) return 0;
  const added = await db.insert(userBadges).values(values).onConflictDoNothing().returning({ userId: userBadges.userId });
  return added.length;
}

/** The numbers company achievements are checked against, for many companies at once. */
export async function companyStats(db: DbOrTx, organizationIds: string[]): Promise<Map<string, CompanyStats>> {
  if (!organizationIds.length) return new Map();
  const [orgs, scores, members] = await Promise.all([
    db.select({ id: organizations.id, treasury: organizations.treasuryCents, level: organizations.companyLevel }).from(organizations).where(inArray(organizations.id, organizationIds)),
    db
      .select({
        id: organizationSeasonScores.organizationId,
        trips: sql<number>`coalesce(sum(${organizationSeasonScores.deliveries}), 0)::int`,
        top10: sql<number>`(count(*) filter (where ${organizationSeasonScores.finalRank} <= 10))::int`,
        wins: sql<number>`(count(*) filter (where ${organizationSeasonScores.finalRank} = 1))::int`,
      })
      .from(organizationSeasonScores)
      .where(inArray(organizationSeasonScores.organizationId, organizationIds))
      .groupBy(organizationSeasonScores.organizationId),
    db.select({ id: companyMembers.companyId, n: sql<number>`count(*)::int` }).from(companyMembers).where(inArray(companyMembers.companyId, organizationIds)).groupBy(companyMembers.companyId),
  ]);
  const byScore = new Map(scores.map((s) => [s.id, s]));
  const byMembers = new Map(members.map((m) => [m.id, m.n]));
  return new Map(orgs.map((o) => {
    const s = byScore.get(o.id);
    return [o.id, { trips: s?.trips ?? 0, members: byMembers.get(o.id) ?? 0, treasuryCents: o.treasury, level: o.level, top10: s?.top10 ?? 0, wins: s?.wins ?? 0 }];
  }));
}

/** Worker: grants the company achievements every company has reached (each once). */
export async function checkCompanyAchievements(db: Database, now = new Date()): Promise<number> {
  if (!featureLive('company_achievements', now)) return 0;
  const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
  const stats = await companyStats(db, orgs.map((o) => o.id));
  const have = await db.select({ id: organizationAchievements.organizationId, key: organizationAchievements.key }).from(organizationAchievements);
  const owned = new Set(have.map((h) => `${h.id}:${h.key}`));
  let granted = 0;
  for (const org of orgs) {
    const s = stats.get(org.id);
    if (!s) continue;
    for (const a of COMPANY_ACHIEVEMENTS) {
      if (owned.has(`${org.id}:${a.key}`) || !a.check(s)) continue;
      await db.transaction(async (tx) => {
        const [row] = await tx.insert(organizationAchievements).values({ organizationId: org.id, key: a.key, unlockedAt: now }).onConflictDoNothing().returning();
        if (!row) return;
        granted++;
        const members = await tx.select({ userId: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.companyId, org.id));
        for (const m of members) await notify(tx, m.userId, 'achievement', () => t('Фирмено постижение: {0} {1}', a.icon, tr(a.title)), () => tr(a.description), `/game/companies/${org.id}`);
        if (a.tier === 'gold' || a.tier === 'prestige') await announceCompanyAchievement(tx, org.id, org.name, a.key, a.title, a.tier, now);
      });
    }
  }
  return granted;
}

/** The company achievements a company has, in the catalogue order. */
export async function companyAchievementsOf(db: DbOrTx, organizationId: string) {
  const rows = await db.select().from(organizationAchievements).where(eq(organizationAchievements.organizationId, organizationId));
  const at = new Map(rows.map((r) => [r.key, r.unlockedAt]));
  return COMPANY_ACHIEVEMENTS.filter((a) => at.has(a.key)).map((a) => ({ key: a.key, title: a.title, description: a.description, tier: a.tier, icon: a.icon, unlockedAt: at.get(a.key)! }));
}
