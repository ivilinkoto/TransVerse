import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { companies, companyBattles, companyMembers, contracts, deliveries, organizations, treasuryEntries, users } from '@/server/db/schema';

/**
 * A company's week in numbers (v1.4): the members' deliveries, tonnes, km
 * and earnings, the treasury, the three busiest drivers and the battle.
 * For the weekly report picture in the company's Discord channel.
 */
export async function companyWeekReport(db: DbOrTx, organizationId: string, from: Date, to: Date) {
  const [org] = await db.select({ name: organizations.name, tag: organizations.tag, treasuryCents: organizations.treasuryCents, level: organizations.companyLevel }).from(organizations).where(eq(organizations.id, organizationId));
  if (!org) return null;
  const done = and(eq(deliveries.status, 'completed'), gte(deliveries.completedAt, from), lt(deliveries.completedAt, to), eq(companyMembers.companyId, organizationId));
  const members = await db
    .select({ username: users.username, trips: sql<number>`count(*)::int`, tons: sql<number>`coalesce(sum(${contracts.weightTons}), 0)::float`, km: sql<number>`coalesce(sum(${deliveries.loadedKm} + ${deliveries.emptyKm}), 0)::float`, earned: sql<number>`coalesce(sum(${deliveries.payoutCents}), 0)::bigint` })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(companyMembers, eq(companyMembers.userId, companies.ownerId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(done)
    .groupBy(users.username)
    .orderBy(desc(sql`sum(${contracts.weightTons})`));
  const [treasury] = await db.select({ net: sql<number>`coalesce(sum(${treasuryEntries.amountCents}), 0)::bigint` }).from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, organizationId), gte(treasuryEntries.createdAt, from), lt(treasuryEntries.createdAt, to)));
  const [battle] = await db.select().from(companyBattles).where(and(sql`(${companyBattles.aId} = ${organizationId} or ${companyBattles.bId} = ${organizationId})`, gte(companyBattles.endsAt, from), lt(companyBattles.endsAt, new Date(to.getTime() + 3_600_000)))).limit(1);
  const sum = (k: 'trips' | 'tons' | 'km' | 'earned') => members.reduce((s, m) => s + Number(m[k]), 0);
  return {
    ...org,
    trips: sum('trips'),
    tons: Math.round(sum('tons') * 10) / 10,
    km: Math.round(sum('km')),
    earnedCents: sum('earned'),
    treasuryNetCents: Number(treasury?.net ?? 0),
    top: members.slice(0, 3).map((m) => ({ username: m.username, tons: Math.round(Number(m.tons) * 10) / 10, trips: Number(m.trips) })),
    battle: battle ? { won: battle.winnerId === organizationId, draw: battle.status === 'done' && !battle.winnerId, done: battle.status === 'done' } : null,
  };
}
