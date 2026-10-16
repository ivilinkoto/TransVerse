import { and, desc, eq, lte, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, seasonScores, seasons } from '@/server/db/schema';
import { post } from './finance';
import { notify } from './notify';

export interface SeasonRules {
  /** Season length in days. */
  lengthDays: number;
  /** Prize money for the top places (euro cents). Persistent assets are never reset. */
  prizesCents: number[];
}

export const DEFAULT_SEASON_RULES: SeasonRules = { lengthDays: 28, prizesCents: [50_000_00, 30_000_00, 15_000_00, 10_000_00, 5_000_00] };

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
        if (prize && row.points > 0) await post(tx, row.companyId, [{ category: 'achievement_reward', amountCents: prize, description: `${season.name}: ${i + 1}. място`, idempotencyKey: `season:${season.id}:prize:${row.companyId}` }]);
        if (company) await notify(tx, company.ownerId, 'achievement', `${season.name} приключи`, `Класирахте се на ${i + 1}. място с ${row.points} точки.`, '/game/seasons');
      }
      await tx.update(seasons).set({ status: 'finished' }).where(eq(seasons.id, season.id));
    }
    if (ended.length) await activeSeason(tx, now);
    return ended.length;
  });
}
