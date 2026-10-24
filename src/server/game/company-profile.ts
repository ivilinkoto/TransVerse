import { aliasedTable, and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { ONLINE_MS } from '@/lib/game/social';
import type { DbOrTx } from '@/server/db/client';
import { cities, companies, companyMembers, companyTenders, contracts, deliveries, organizations, users, vehicles } from '@/server/db/schema';
import { battleRecord } from './battles';
import { finishedProjects } from './projects';
import { organizationSeasonResults } from './seasons';
import { t as tr } from '@/i18n/t';

/**
 * The public highlights of a company: totals and records of its current
 * members (counted from when each joined), who is on the road now, and a
 * short history. Game data only — no balances.
 */
export async function companyHighlights(db: DbOrTx, organizationId: string, now = new Date()) {
  const [org] = await db.select({ ownerId: organizations.ownerId, foundedAt: organizations.foundedAt, hq: cities.nameBg, level: organizations.companyLevel }).from(organizations).innerJoin(cities, eq(cities.id, organizations.hqCityId)).where(eq(organizations.id, organizationId));
  if (!org) return null;
  const members = await db
    .select({ userId: companyMembers.userId, joinedAt: companyMembers.joinedAt, username: users.username, lastSeenAt: users.lastSeenAt, accountId: companies.id })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .innerJoin(companies, eq(companies.ownerId, companyMembers.userId))
    .where(eq(companyMembers.companyId, organizationId));
  const accountIds = members.map((m) => m.accountId);

  // A delivery counts for the company when its driver was already a member.
  const whileMember = sql`exists (select 1 from ${companyMembers} cm join ${companies} a on a.owner_id = cm.user_id where a.id = ${deliveries.companyId} and cm.company_id = ${organizationId} and ${deliveries.completedAt} >= cm.${sql.raw(companyMembers.joinedAt.name)})`;
  const origin = aliasedTable(cities, 'origin');
  const dest = aliasedTable(cities, 'dest');
  const record = () =>
    db
      .select({ player: users.username, km: deliveries.loadedKm, tons: contracts.weightTons, goods: contracts.goods, from: origin.nameBg, to: dest.nameBg, at: deliveries.completedAt })
      .from(deliveries)
      .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .innerJoin(companies, eq(companies.id, deliveries.companyId))
      .innerJoin(users, eq(users.id, companies.ownerId))
      .innerJoin(origin, eq(origin.id, contracts.originCityId))
      .innerJoin(dest, eq(dest.id, contracts.destCityId))
      .where(and(eq(deliveries.status, 'completed'), whileMember))
      .limit(1);

  const [[totals], [longest], [heaviest], weekly, [onRoad], tenders, seasons] = accountIds.length
    ? await Promise.all([
        db
          .select({ trips: sql<number>`count(*)::int`, km: sql<number>`coalesce(sum(${deliveries.emptyKm} + ${deliveries.loadedKm}), 0)::float`, tons: sql<number>`coalesce(sum(${contracts.weightTons}), 0)::float` })
          .from(deliveries)
          .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
          .where(and(eq(deliveries.status, 'completed'), whileMember)),
        record().orderBy(desc(deliveries.loadedKm)),
        record().orderBy(desc(contracts.weightTons), desc(deliveries.loadedKm)),
        db
          .select({ player: users.username, trips: sql<number>`count(*)::int`, km: sql<number>`sum(${deliveries.loadedKm})::float` })
          .from(deliveries)
          .innerJoin(companies, eq(companies.id, deliveries.companyId))
          .innerJoin(users, eq(users.id, companies.ownerId))
          .where(and(eq(deliveries.status, 'completed'), whileMember, gte(deliveries.completedAt, new Date(now.getTime() - 7 * 86_400_000))))
          .groupBy(users.username)
          .orderBy(sql`count(*) desc`, sql`sum(${deliveries.loadedKm}) desc`)
          .limit(3),
        db.select({ n: sql<number>`count(*)::int` }).from(vehicles).where(and(inArray(vehicles.companyId, accountIds), eq(vehicles.status, 'on_delivery'))),
        db.select({ title: companyTenders.title, at: companyTenders.finishedAt }).from(companyTenders).where(and(eq(companyTenders.companyId, organizationId), eq(companyTenders.status, 'completed'))).orderBy(desc(companyTenders.finishedAt)).limit(5),
        organizationSeasonResults(db, organizationId),
      ])
    : [[undefined], [undefined], [undefined], [], [undefined], [], []];

  const battles = await battleRecord(db, organizationId, 10);
  // History: founding, the newest members, completed tenders and season places — newest first.
  const history = [
    { at: org.foundedAt, kind: 'founded' as const, text: tr('Компанията е основана в {0}', org.hq) },
    // The founder "joins" at the founding itself; that is not news.
    ...members.filter((m) => m.userId !== org.ownerId || Math.abs(m.joinedAt.getTime() - org.foundedAt.getTime()) > 60_000).map((m) => ({ at: m.joinedAt, kind: 'joined' as const, text: tr('{0} се присъедини', m.username) })),
    ...tenders.filter((t) => t.at).map((t) => ({ at: t.at!, kind: 'tender' as const, text: tr('Изпълнен търг: {0}', t.title) })),
    ...seasons.filter((s) => (s.rank ?? 99) <= 10).map((s) => ({ at: null, kind: 'season' as const, text: tr('{0}: {1}. място', s.name, s.rank) })),
    ...(await finishedProjects(db, organizationId)).filter((p) => p.completedAt).map((p) => ({ at: p.completedAt!, kind: 'project' as const, text: tr('Завършен проект: {0}', p.title) })),
    ...battles.recent.filter((b) => b.result === 'win').map((b) => ({ at: b.at, kind: 'battle' as const, text: tr('Победа в битка срещу „{0}“ ({1} : {2} т)', b.rival, Math.round(b.ourTons), Math.round(b.theirTons)) })),
  ]
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
    .slice(0, 12);

  return {
    foundedAt: org.foundedAt,
    hq: org.hq,
    level: org.level,
    online: members.filter((m) => m.lastSeenAt && now.getTime() - m.lastSeenAt.getTime() < ONLINE_MS).length,
    onRoad: onRoad?.n ?? 0,
    trips: totals?.trips ?? 0,
    km: Math.round(totals?.km ?? 0),
    tons: Math.round(totals?.tons ?? 0),
    longest: longest ?? null,
    heaviest: heaviest ?? null,
    weekly,
    history,
    trophies: battles.wins,
  };
}

export type CompanyHighlights = NonNullable<Awaited<ReturnType<typeof companyHighlights>>>;
