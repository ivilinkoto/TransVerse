/**
 * 1.4 „Зимни игри на компаниите“ on the server. Nothing new is recorded for the disciplines: they
 * are counted from what the games already keep (night-run / daily-route / courier days in
 * job_state, delivered loads, materials for the bases), for the members a company has now.
 * „Най-красивата коледна база“: `xmas-base-vote:<day>:<user>` = { org }.
 * The prizes are given once after the Games (`winter-games-awarded`), money only through postTreasury.
 */
import { and, eq, gte, inArray, isNotNull, like, lt, sql } from 'drizzle-orm';
import { dayKey } from '@/lib/game/daily';
import { featureLive } from '@/lib/game/features';
import { BASE_CONTEST, DISCIPLINES, inWinterGames, medalTable, topSum, WINTER_GAMES, type WinterDiscipline } from '@/lib/game/winter-games';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, companyBuildings, companyBuilds, companyMembers, contracts, deliveries, jobState, organizations, userBadges } from '@/server/db/schema';
import { t } from '@/i18n/t';
import { fail } from './errors';
import { postTreasury } from './finance';
import { notify } from './notify';

export interface Standing { orgId: string; name: string; value: number }

/** The day keys of the Games up to now. */
function gameDays(now: Date): string[] {
  const out: string[] = [];
  const start = new Date(WINTER_GAMES.from).getTime();
  const end = Math.min(now.getTime(), new Date(WINTER_GAMES.to).getTime());
  for (let at = start; at < end; at += 86_400_000) out.push(dayKey(new Date(at + 12 * 3_600_000)));
  return out;
}

async function members(db: DbOrTx) {
  const rows = await db.select({ userId: companyMembers.userId, orgId: companyMembers.companyId, name: organizations.name }).from(companyMembers).innerJoin(organizations, eq(organizations.id, companyMembers.companyId));
  return { orgOf: new Map(rows.map((r) => [r.userId, r.orgId])), names: new Map(rows.map((r) => [r.orgId, r.name])) };
}

/** A daily game: each member's best of the day; a company's day is the sum of its best members. */
async function dailyGame(db: DbOrTx, prefix: string, best: string, days: string[], orgOf: Map<string, string>) {
  if (!days.length) return new Map<string, number>();
  const res = await db.execute(sql`
    select split_part(j.key, ':', 2) as day, split_part(j.key, ':', 3) as uid, ${sql.raw(best)} as v
    from job_state j where j.key like ${`${prefix}:%:%`} and split_part(j.key, ':', 2) in (${sql.join(days.map((d) => sql`${d}`), sql`, `)})`);
  const perDay = new Map<string, number[]>();
  for (const r of res.rows as { day: string; uid: string; v: number | null }[]) {
    const org = orgOf.get(r.uid);
    if (!org || !r.v) continue;
    const k = `${org}|${r.day}`;
    perDay.set(k, [...(perDay.get(k) ?? []), Number(r.v)]);
  }
  const total = new Map<string, number>();
  for (const [k, values] of perDay) {
    const org = k.split('|')[0]!;
    total.set(org, (total.get(org) ?? 0) + topSum(values));
  }
  return total;
}

const runBest = (field: string, arr: string) => `(select max((x->>'${field}')::float) from jsonb_array_elements(j.value->'${arr}') x)`;

/** Every discipline's ranking now (or as it ended). */
export async function winterGamesStandings(db: DbOrTx, now: Date): Promise<Record<WinterDiscipline, Standing[]>> {
  const days = gameDays(now);
  const { orgOf, names } = await members(db);
  const from = new Date(WINTER_GAMES.from);
  const to = new Date(Math.min(now.getTime(), new Date(WINTER_GAMES.to).getTime()));
  const totals: Record<WinterDiscipline, Map<string, number>> = {
    night_run: await dailyGame(db, 'night-run', runBest('metres', 'runs'), days, orgOf),
    daily_route: await dailyGame(db, 'daily-route', runBest('pct', 'tries'), days, orgOf),
    courier: await dailyGame(db, 'courier', runBest('points', 'runs'), days, orgOf),
    deliveries: new Map(),
    builders: new Map(),
  };
  if (to > from) {
    // Tonnes each member delivered with their own company's trucks; a company counts its best members.
    const tons = await db
      .select({ uid: companies.ownerId, tons: sql<number>`sum(${contracts.weightTons})::float` })
      .from(deliveries)
      .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .innerJoin(companies, eq(companies.id, deliveries.companyId))
      .where(and(eq(deliveries.status, 'completed'), gte(deliveries.completedAt, from), lt(deliveries.completedAt, to)))
      .groupBy(companies.ownerId);
    const per = new Map<string, number[]>();
    for (const r of tons) {
      const org = orgOf.get(r.uid);
      if (org) per.set(org, [...(per.get(org) ?? []), Number(r.tons)]);
    }
    for (const [org, v] of per) totals.deliveries.set(org, Math.round(topSum(v)));
    const built = await db
      .select({ org: companyBuilds.organizationId, tons: sql<number>`sum(${contracts.weightTons})::float` })
      .from(deliveries)
      .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .innerJoin(companyBuilds, eq(companyBuilds.id, contracts.constructionId))
      .where(and(eq(deliveries.status, 'completed'), isNotNull(contracts.constructionId), gte(deliveries.completedAt, from), lt(deliveries.completedAt, to)))
      .groupBy(companyBuilds.organizationId);
    for (const r of built) totals.builders.set(r.org, Math.round(Number(r.tons)));
  }
  const out = {} as Record<WinterDiscipline, Standing[]>;
  for (const d of DISCIPLINES) {
    out[d.id] = [...totals[d.id]]
      .filter(([org, v]) => v > 0 && names.has(org))
      .map(([orgId, value]) => ({ orgId, name: names.get(orgId)!, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  }
  return out;
}

/** The medal table from the standings. */
export function medals(standings: Record<WinterDiscipline, Standing[]>) {
  const rows = new Map<string, { orgId: string; name: string; gold: number; silver: number; bronze: number }>();
  for (const d of DISCIPLINES) {
    standings[d.id].slice(0, 3).forEach((s, i) => {
      const r = rows.get(s.orgId) ?? { orgId: s.orgId, name: s.name, gold: 0, silver: 0, bronze: 0 };
      if (i === 0) r.gold++;
      else if (i === 1) r.silver++;
      else r.bronze++;
      rows.set(s.orgId, r);
    });
  }
  return medalTable([...rows.values()]);
}

// ───────────── „Най-красивата коледна база“ ─────────────

/** One vote a day, for a base of another company, while the Games are on. */
export async function voteXmasBase(db: Database, userId: string, organizationId: string, now: Date) {
  if (!inWinterGames(now)) fail('contest_closed', t('Конкурсът за най-красива коледна база не е отворен.'));
  const [mine] = await db.select({ org: companyMembers.companyId }).from(companyMembers).where(eq(companyMembers.userId, userId));
  if (mine?.org === organizationId) fail('own_base', t('Не можеш да гласуваш за базата на своята компания.'));
  const [built] = await db.select({ id: companyBuildings.organizationId }).from(companyBuildings).where(and(eq(companyBuildings.organizationId, organizationId), sql`${companyBuildings.level} > 0`)).limit(1);
  if (!built) fail('no_base', t('Тази компания още няма база.'));
  const [row] = await db.insert(jobState).values({ key: `xmas-base-vote:${dayKey(now)}:${userId}`, value: { org: organizationId } }).onConflictDoNothing().returning();
  if (!row) fail('voted_today', t('Днес вече гласува — утре пак.'));
  return { ok: true };
}

/** Votes so far, by base; and whom the player voted for today. */
export async function xmasBaseVotes(db: DbOrTx, now: Date, userId?: string) {
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(like(jobState.key, 'xmas-base-vote:%'));
  const days = new Set(gameDays(now));
  const count = new Map<string, number>();
  let today: string | null = null;
  for (const r of rows) {
    const [, day, uid] = r.key.split(':');
    if (!days.has(day!)) continue;
    const org = (r.value as { org: string }).org;
    count.set(org, (count.get(org) ?? 0) + 1);
    if (uid === userId && day === dayKey(now)) today = org;
  }
  const ids = [...count.keys()];
  const names = ids.length ? new Map((await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, ids))).map((o) => [o.id, o.name])) : new Map<string, string>();
  const ranking = ids.map((orgId) => ({ orgId, name: names.get(orgId) ?? '—', votes: count.get(orgId)! })).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  return { ranking, today };
}

async function membersOf(tx: DbOrTx, orgId: string) {
  return (await tx.select({ userId: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.companyId, orgId))).map((m) => m.userId);
}

/** Worker: after the Games, the prizes — once. */
export async function awardWinterGames(db: Database, now = new Date()): Promise<boolean> {
  if (!featureLive('winter_games', now) || now < new Date(WINTER_GAMES.to)) return false;
  const [first] = await db.insert(jobState).values({ key: 'winter-games-awarded:2026', value: { at: now.toISOString() } }).onConflictDoNothing().returning();
  if (!first) return false;
  const standings = await winterGamesStandings(db, now);
  const table = medals(standings);
  const votes = (await xmasBaseVotes(db, now)).ranking;
  await db.transaction(async (tx) => {
    for (const d of DISCIPLINES) {
      for (const [i, s] of standings[d.id].slice(0, 3).entries()) {
        await postTreasury(tx, s.orgId, [{ category: 'winter_games', amountCents: WINTER_GAMES.prizesCents[i]!, description: t('Зимни игри · {0}: {1} място', d.label, i + 1), idempotencyKey: `winter-games:2026:${d.id}:${s.orgId}` }]);
      }
    }
    const champ = table[0];
    if (champ) {
      await postTreasury(tx, champ.orgId, [{ category: 'winter_games', amountCents: WINTER_GAMES.championCents, description: t('Шампион на Зимните игри'), idempotencyKey: `winter-games:2026:champion:${champ.orgId}` }]);
      for (const uid of await membersOf(tx, champ.orgId)) {
        await tx.insert(userBadges).values({ userId: uid, badge: WINTER_GAMES.championTitle, awardedAt: now }).onConflictDoNothing();
        await notify(tx, uid, 'achievement', () => t('Шампиони на Зимните игри!'), () => t('Компанията ви спечели Зимните игри — титла „Шампион на Зимните игри“ за всеки член.'), '/game/winter-games');
      }
    }
    for (const [i, v] of votes.slice(0, 3).entries()) {
      await postTreasury(tx, v.orgId, [{ category: 'winter_games', amountCents: BASE_CONTEST.prizesCents[i]!, description: t('Най-красивата коледна база: {0} място', i + 1), idempotencyKey: `xmas-base:2026:${v.orgId}` }]);
      if (i === 0) for (const uid of await membersOf(tx, v.orgId)) await tx.insert(userBadges).values({ userId: uid, badge: BASE_CONTEST.title, awardedAt: now }).onConflictDoNothing();
    }
  });
  return true;
}
