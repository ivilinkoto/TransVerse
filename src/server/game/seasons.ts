import { and, desc, eq, lte, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, companyMembers, organizationSeasonScores, organizations, seasonScores, seasons } from '@/server/db/schema';
import { post, postTreasury } from './finance';
import { notify } from './notify';
import { awardSeasonMedals } from './medals';
import { t, intlLocale } from '@/i18n/t';

export interface SeasonRules {
  /** Season length in days. */
  lengthDays: number;
  /** Prize money for the top places (euro cents). Persistent assets are never reset. */
  prizesCents: number[];
  /** Prizes for the best player companies, paid into their treasury (older seasons: the default). */
  companyPrizesCents?: number[];
}

export const DEFAULT_COMPANY_PRIZES_CENTS = [150_000_00, 90_000_00, 60_000_00, 40_000_00, 25_000_00];
export const DEFAULT_SEASON_RULES: SeasonRules = { lengthDays: 28, prizesCents: [50_000_00, 30_000_00, 15_000_00, 10_000_00, 5_000_00], companyPrizesCents: DEFAULT_COMPANY_PRIZES_CENTS };

export const companyPrizes = (rules: SeasonRules) => rules.companyPrizesCents ?? DEFAULT_COMPANY_PRIZES_CENTS;

const MONTHS_BG = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];

export async function activeSeason(db: DbOrTx, now = new Date()) {
  const [season] = await db.select().from(seasons).where(eq(seasons.status, 'active')).orderBy(desc(seasons.id)).limit(1);
  if (season) return season;
  const [created] = await db
    .insert(seasons)
    .values({
      name: `Сезон ${MONTHS_BG[now.getUTCMonth()]} ${now.getUTCFullYear()}`,
      startsAt: now,
      endsAt: new Date(now.getTime() + DEFAULT_SEASON_RULES.lengthDays * 86_400_000),
      status: 'active',
      rules: DEFAULT_SEASON_RULES,
    })
    .returning();
  return created!;
}

export async function addSeasonScore(tx: Tx, companyId: string, points: number, revenueCents: number, now = new Date()) {
  const season = await activeSeason(tx, now);
  await tx
    .insert(seasonScores)
    .values({ seasonId: season.id, companyId, points, deliveries: 1, revenueCents })
    .onConflictDoUpdate({
      target: [seasonScores.seasonId, seasonScores.companyId],
      set: { points: sql`${seasonScores.points} + ${points}`, deliveries: sql`${seasonScores.deliveries} + 1`, revenueCents: sql`${seasonScores.revenueCents} + ${revenueCents}` },
    });
}

/** A member's delivery also counts for their company's season score. */
export async function addOrganizationSeasonScore(tx: Tx, organizationId: string, points: number, now = new Date()) {
  const season = await activeSeason(tx, now);
  await tx
    .insert(organizationSeasonScores)
    .values({ seasonId: season.id, organizationId, points, deliveries: 1 })
    .onConflictDoUpdate({
      target: [organizationSeasonScores.seasonId, organizationSeasonScores.organizationId],
      set: { points: sql`${organizationSeasonScores.points} + ${points}`, deliveries: sql`${organizationSeasonScores.deliveries} + 1` },
    });
}

/** Company season table with names, tags and member counts. */
export async function organizationSeasonTable(db: DbOrTx, seasonId: number, limit = 100) {
  return db
    .select({
      organizationId: organizationSeasonScores.organizationId,
      points: organizationSeasonScores.points,
      deliveries: organizationSeasonScores.deliveries,
      finalRank: organizationSeasonScores.finalRank,
      prizeCents: organizationSeasonScores.prizeCents,
      name: organizations.name,
      tag: organizations.tag,
      color: organizations.color,
      level: organizations.companyLevel,
      members: sql<number>`(select count(*)::int from ${companyMembers} where ${companyMembers.companyId} = ${organizations.id})`,
    })
    .from(organizationSeasonScores)
    .innerJoin(organizations, eq(organizations.id, organizationSeasonScores.organizationId))
    .where(and(eq(organizationSeasonScores.seasonId, seasonId), sql`${organizationSeasonScores.points} > 0`))
    .orderBy(desc(organizationSeasonScores.points), organizations.name)
    .limit(limit);
}

/** Final places of a company in finished seasons (badges on its profile). */
export async function organizationSeasonResults(db: DbOrTx, organizationId: string) {
  return db
    .select({ seasonId: seasons.id, name: seasons.name, rank: organizationSeasonScores.finalRank, points: organizationSeasonScores.points, prizeCents: organizationSeasonScores.prizeCents })
    .from(organizationSeasonScores)
    .innerJoin(seasons, eq(seasons.id, organizationSeasonScores.seasonId))
    .where(and(eq(organizationSeasonScores.organizationId, organizationId), eq(seasons.status, 'finished'), sql`${organizationSeasonScores.finalRank} is not null`))
    .orderBy(desc(seasons.id));
}

async function closeOrganizationSeason(tx: Tx, season: typeof seasons.$inferSelect) {
  const ranking = await tx
    .select()
    .from(organizationSeasonScores)
    .innerJoin(organizations, eq(organizations.id, organizationSeasonScores.organizationId))
    .where(and(eq(organizationSeasonScores.seasonId, season.id), sql`${organizationSeasonScores.points} > 0`))
    .orderBy(desc(organizationSeasonScores.points), organizations.name);
  const prizes = companyPrizes(season.rules as SeasonRules);
  for (const [i, { organization_season_scores: row, organizations: org }] of ranking.entries()) {
    const prize = prizes[i] ?? 0;
    await tx.update(organizationSeasonScores).set({ finalRank: i + 1, prizeCents: prize || null }).where(and(eq(organizationSeasonScores.seasonId, season.id), eq(organizationSeasonScores.organizationId, row.organizationId)));
    if (prize) await postTreasury(tx, org.id, [{ category: 'season_prize', amountCents: prize, description: t('{0}: {1}. място', season.name, i + 1), idempotencyKey: `season:${season.id}:company-prize:${org.id}` }]);
    const members = await tx.select({ userId: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.companyId, org.id));
    for (const m of members) {
      await notify(tx, m.userId, 'achievement', () => t('{0}: „{1}“ е {2}.', season.name, org.name, i + 1), () => prize ? t('Компанията спечели {0} лв. за касата.', (prize / 100).toLocaleString(intlLocale())) : t('Компанията събра {0} сезонни точки.', row.points), '/game/seasons?tab=companies');
    }
  }
}

/**
 * Closes finished seasons: stores final ranks, pays prizes and opens the next
 * season. Companies keep all their assets — only the season table restarts.
 */
export async function rotateSeasons(db: Database, now = new Date()): Promise<number> {
  return db.transaction(async (tx) => {
    const ended = await tx.select().from(seasons).where(and(eq(seasons.status, 'active'), lte(seasons.endsAt, now))).for('update');
    for (const season of ended) {
      const ranking = await tx.select().from(seasonScores).where(eq(seasonScores.seasonId, season.id)).orderBy(desc(seasonScores.points));
      const rules = season.rules as SeasonRules;
      for (const [i, row] of ranking.entries()) {
        await tx.update(seasonScores).set({ finalRank: i + 1 }).where(and(eq(seasonScores.seasonId, season.id), eq(seasonScores.companyId, row.companyId)));
        const prize = rules.prizesCents[i];
        const [company] = await tx.select({ ownerId: companies.ownerId }).from(companies).where(eq(companies.id, row.companyId));
        if (prize && row.points > 0) await post(tx, row.companyId, [{ category: 'achievement_reward', amountCents: prize, description: t('{0}: {1}. място', season.name, i + 1), idempotencyKey: `season:${season.id}:prize:${row.companyId}` }]);
        if (company) await notify(tx, company.ownerId, 'achievement', () => t('{0} приключи', season.name), () => t('Класирахте се на {0}. място с {1} точки.', i + 1, row.points), '/game/seasons');
      }
      await closeOrganizationSeason(tx, season);
      await awardSeasonMedals(tx, season, now);
      await tx.update(seasons).set({ status: 'finished' }).where(eq(seasons.id, season.id));
    }
    if (ended.length) await activeSeason(tx, now);
    return ended.length;
  });
}
