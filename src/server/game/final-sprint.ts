/**
 * 1.2.3.1 „Финален спринт“ (feature `final_sprint`): the last day of a season
 * (a reminder with the player's place and the gaps around it, and one message
 * in Discord #класации) and the player's season recap with a page to share.
 */
import { and, desc, eq, gt, gte, lte, sql } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { passLevelOf, passVersion } from '@/lib/game/season-pass';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, deliveries, jobState, seasonPasses, seasonScores, seasons, users } from '@/server/db/schema';
import { appUrl } from '@/server/discord/config';
import { announce } from '@/server/discord/outbox';
import { notify } from './notify';
import { activeSeason } from './seasons';
import { t } from '@/i18n/t';

export const FINAL_SPRINT = { remindHours: 24, countdownDays: 3, maxReminders: 2_000 } as const;

/** The season table with owners: place, points and the gaps to the places around. */
export async function seasonStanding(db: DbOrTx, seasonId: number, limit: number = FINAL_SPRINT.maxReminders) {
  const rows = await db
    .select({ companyId: seasonScores.companyId, points: seasonScores.points, userId: companies.ownerId, username: users.username })
    .from(seasonScores)
    .innerJoin(companies, eq(companies.id, seasonScores.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(seasonScores.seasonId, seasonId), gt(seasonScores.points, 0)))
    .orderBy(desc(seasonScores.points))
    .limit(limit);
  return rows.map((r, i) => ({ ...r, place: i + 1, ahead: i > 0 ? rows[i - 1]!.points - r.points : null, behind: i < rows.length - 1 ? r.points - rows[i + 1]!.points : null }));
}

/** Worker: once a season, a day before its end — every player in the table and Discord. */
export async function lastDayReminders(db: Database, now = new Date()) {
  if (!featureLive('final_sprint', now)) return 0;
  const season = await activeSeason(db, now);
  const left = season.endsAt.getTime() - now.getTime();
  if (left <= 0 || left > FINAL_SPRINT.remindHours * 3_600_000) return 0;
  const table = await seasonStanding(db, season.id);
  let sent = 0;
  for (const r of table) {
    const [first] = await db.insert(jobState).values({ key: `season-last-day:${season.id}:${r.userId}`, value: { at: now.toISOString() } }).onConflictDoNothing().returning();
    if (!first) continue;
    await notify(db, r.userId, 'info', () => t('{0} свършва след по-малко от ден!', season.name), () => (r.place === 1 ? t('Ти си #1 — {0} точки пред #2. Пази мястото!', r.behind ?? 0) : t('Ти си #{0} — на {1} точки от #{2}{3}.', r.place, r.ahead ?? 0, r.place - 1, r.behind != null ? t(' и {0} пред #{1}', r.behind, r.place + 1) : '')), '/game/seasons');
    sent++;
  }
  if (table.length) {
    await announce(db, `season-last-day:${season.id}`, 'rankings', () => ({
      embeds: [{
        title: t('⏳ {0} свършва след по-малко от ден!', season.name),
        description: [t('Последен шанс за място в класацията. Сега водят:'), ...table.slice(0, 3).map((r) => `**${r.place}.** ${r.username} — ${r.points.toLocaleString('bg-BG')}`)].join('\n'),
        url: `${appUrl()}/game/seasons`,
        color: 0xf6c343,
      }],
    }), now);
  }
  return sent;
}

/** One player's season: place, points, trips, kilometres, the longest trip and the pass level. */
export async function seasonRecap(db: DbOrTx, seasonId: number, userId: string) {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  const [acct] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  if (!season || !acct) return null;
  const [score] = await db.select().from(seasonScores).where(and(eq(seasonScores.seasonId, seasonId), eq(seasonScores.companyId, acct.id)));
  if (!score || score.points <= 0) return null;
  const place = score.finalRank ?? (await seasonStanding(db, seasonId)).find((r) => r.companyId === acct.id)?.place ?? null;
  const [players] = await db.select({ n: sql<number>`count(*)::int` }).from(seasonScores).where(and(eq(seasonScores.seasonId, seasonId), gt(seasonScores.points, 0)));
  const [trips] = await db
    .select({ km: sql<number>`coalesce(sum(${deliveries.loadedKm}), 0)::float`, longest: sql<number>`coalesce(max(${deliveries.loadedKm}), 0)::float` })
    .from(deliveries)
    .where(and(eq(deliveries.companyId, acct.id), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, season.startsAt), lte(deliveries.completedAt, season.endsAt)));
  const [pass] = await db.select({ points: seasonPasses.points }).from(seasonPasses).where(and(eq(seasonPasses.seasonId, seasonId), eq(seasonPasses.userId, userId)));
  return {
    season: { id: season.id, name: season.name, startsAt: season.startsAt, endsAt: season.endsAt, finished: season.status === 'finished' },
    place,
    players: players?.n ?? 0,
    points: score.points,
    deliveries: score.deliveries,
    km: Math.round(trips?.km ?? 0),
    longestKm: Math.round(trips?.longest ?? 0),
    passLevel: passLevelOf(pass?.points ?? 0, passVersion(season.rules)),
  };
}

/** The last finished season in which the player scored (for the season page). */
export async function lastRecapSeason(db: DbOrTx, userId: string) {
  const [row] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .innerJoin(seasonScores, eq(seasonScores.seasonId, seasons.id))
    .innerJoin(companies, eq(companies.id, seasonScores.companyId))
    .where(and(eq(seasons.status, 'finished'), eq(companies.ownerId, userId), gt(seasonScores.points, 0)))
    .orderBy(desc(seasons.id))
    .limit(1);
  return row?.id ?? null;
}
