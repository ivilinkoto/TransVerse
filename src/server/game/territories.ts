import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { regionKey, TERRITORY } from '@/lib/game/empire';
import { featureLive } from '@/lib/game/features';
import { periodWindow } from '@/lib/game/missions';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companyMembers, contracts, deliveries, companies, organizations, territories } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { post } from './finance';
import { membershipOf, notifyMembers } from './membership';
import { t as tr } from '@/i18n/t';

/** The current week's key and the window of the week before it. */
function weeks(now: Date) {
  const current = periodWindow('weekly', now);
  const startsAt = new Date(current.endsAt.getTime() - 7 * 86_400_000);
  const last = periodWindow('weekly', new Date(startsAt.getTime() - 3_600_000));
  return { current: current.key, startsAt, last: last.key, lastStartsAt: new Date(startsAt.getTime() - 7 * 86_400_000) };
}

/** Tonnes each company's members brought into each region between two times, best first per region. */
export async function regionTons(db: DbOrTx, from: Date, to: Date, where?: { countryCode: string; region: string }) {
  const tons = sql<number>`sum(${contracts.weightTons})`.mapWith(Number);
  return db
    .select({ countryCode: cities.countryCode, region: cities.region, regionBg: cities.regionBg, organizationId: companyMembers.companyId, name: organizations.name, tons })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(companyMembers, eq(companyMembers.userId, companies.ownerId))
    .innerJoin(organizations, eq(organizations.id, companyMembers.companyId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .where(and(eq(deliveries.status, 'completed'), gte(deliveries.completedAt, from), lt(deliveries.completedAt, to), sql`${cities.region} is not null`, where ? and(eq(cities.countryCode, where.countryCode), eq(cities.region, where.region)) : undefined))
    .groupBy(cities.countryCode, cities.region, cities.regionBg, companyMembers.companyId, organizations.name)
    .orderBy(cities.countryCode, cities.region, desc(tons));
}

/**
 * Worker, once a week: last week's best company of every region (at least
 * the minimum tonnes) holds it this week. Members are told.
 */
export async function settleTerritories(db: Database, now: Date) {
  if (!featureLive('territories', now)) return null;
  const w = weeks(now);
  const [done] = await db.select({ n: sql<number>`count(*)::int` }).from(territories).where(eq(territories.week, w.current));
  if (done!.n > 0) return null;
  const best = new Map<string, { countryCode: string; region: string; regionBg: string | null; organizationId: string; tons: number }>();
  for (const r of await regionTons(db, w.lastStartsAt, w.startsAt)) {
    const key = regionKey(r.countryCode, r.region);
    if (key && !best.has(key) && r.tons >= TERRITORY.minTons) best.set(key, { ...r, region: r.region! });
  }
  if (!best.size) return { week: w.current, regions: 0 };
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(territories)
      .values([...best.values()].map((b) => ({ week: w.current, countryCode: b.countryCode, region: b.region, regionBg: b.regionBg, organizationId: b.organizationId, tons: Math.round(b.tons * 10) / 10 })))
      .onConflictDoNothing()
      .returning();
    const byOrg = new Map<string, string[]>();
    for (const r of rows) byOrg.set(r.organizationId, [...(byOrg.get(r.organizationId) ?? []), r.regionBg ?? r.region]);
    for (const [org, names] of byOrg) await notifyMembers(tx, org, null, () => tr('Нови територии: {0}', names.length), () => tr('Тази седмица компанията държи: {0}. Товарите до тях плащат повече.', names.map((n) => tr(n)).join(', ')), '/game/company/territories');
    return { week: w.current, regions: rows.length };
  });
}

/** The regions a company holds this week. */
export async function territoriesOf(db: DbOrTx, organizationId: string, now = new Date()) {
  return db.select().from(territories).where(and(eq(territories.organizationId, organizationId), eq(territories.week, weeks(now).current)));
}

/** Who holds which region this week (for the map and the list). */
export async function currentTerritories(db: DbOrTx, now = new Date()) {
  return db
    .select({ countryCode: territories.countryCode, region: territories.region, regionBg: territories.regionBg, organizationId: territories.organizationId, name: organizations.name, tag: organizations.tag, color: organizations.color, tons: territories.tons })
    .from(territories)
    .innerJoin(organizations, eq(organizations.id, territories.organizationId))
    .where(eq(territories.week, weeks(now).current))
    .orderBy(territories.countryCode, territories.region);
}

/** The race for a region this week: the companies so far. */
export async function territoryRace(db: DbOrTx, countryCode: string, region: string, now = new Date()) {
  const w = weeks(now);
  return (await regionTons(db, w.startsAt, now, { countryCode, region })).slice(0, 10);
}

/** A member's load into a region the company holds pays a little more (personal account). */
export async function territoryBonus(tx: Tx, userId: string, d: { id: string; companyId: string }, destCityId: number, rewardCents: number, now: Date) {
  if (!(await featureFor(tx, userId, 'territories', now))) return 0;
  const m = await membershipOf(tx, userId);
  if (!m) return 0;
  const [city] = await tx.select({ countryCode: cities.countryCode, region: cities.region, regionBg: cities.regionBg }).from(cities).where(eq(cities.id, destCityId));
  if (!city?.region) return 0;
  const [held] = await tx.select({ week: territories.week }).from(territories).where(and(eq(territories.week, weeks(now).current), eq(territories.countryCode, city.countryCode), eq(territories.region, city.region), eq(territories.organizationId, m.company.id)));
  if (!held) return 0;
  const bonus = Math.round(rewardCents * TERRITORY.bonusShare);
  if (bonus > 0) await post(tx, d.companyId, [{ category: 'territory_bonus', amountCents: bonus, description: tr('Територия на „{0}“: {1}', m.company.name, tr(city.regionBg ?? city.region)), idempotencyKey: `delivery:${d.id}:territory`, refType: 'delivery', refId: d.id }]);
  return bonus;
}

/** This week so far: every region's leader and the company's own tonnes there. */
export async function weekRace(db: DbOrTx, organizationId: string, now = new Date()) {
  const w = weeks(now);
  const out = new Map<string, { countryCode: string; region: string; regionBg: string | null; leader: string; leaderTons: number; mine: number }>();
  for (const r of await regionTons(db, w.startsAt, now)) {
    const key = regionKey(r.countryCode, r.region)!;
    const row = out.get(key) ?? { countryCode: r.countryCode, region: r.region!, regionBg: r.regionBg, leader: r.name, leaderTons: r.tons, mine: 0 };
    if (r.organizationId === organizationId) row.mine = r.tons;
    out.set(key, row);
  }
  return [...out.values()].filter((r) => r.mine > 0).sort((a, b) => b.mine - a.mine);
}
