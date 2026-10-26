import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { BUILD_BADGES, BUILDER_WEEK } from '@/lib/game/plot';
import { weekEndsAt, weekKey } from '@/lib/game/leagues';
import { money } from '@/lib/format';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, companyBattles, companyBuilderWeeks, companyBuildings, companyMembers, companyProjects, contracts, deliveries, organizations, userBadges, users } from '@/server/db/schema';
import { companyForUser } from './company';
import { post, postTreasury } from './finance';
import { notifyMembers } from './membership';
import { notify } from './notify';
import { announceBuilderOfWeek } from '@/server/discord/announce';
import { t } from '@/i18n/t';

/**
 * Worker, after a week ends: in every company, the member who delivered the
 * most tonnes of building materials that week becomes "Строител на седмицата"
 * — recorded once per company and week, with a prize from the treasury when
 * the treasury can pay it.
 */
export async function awardBuildersOfWeek(db: Database, now = new Date()) {
  const key = weekKey(new Date(now.getTime() - 7 * 86_400_000));
  const end = weekEndsAt(key);
  const start = new Date(end.getTime() - 7 * 86_400_000);
  if (end > now) return 0;
  const { rows } = await db.execute<{ organization_id: string; user_id: string; tons: number }>(sql`
    select distinct on (b.organization_id) b.organization_id, c.owner_id as user_id, sum(k.weight_tons)::float as tons
    from deliveries d
    join contracts k on k.id = d.contract_id
    join company_builds b on b.id = k.construction_id
    join companies c on c.id = d.company_id
    join company_members m on m.user_id = c.owner_id and m.company_id = b.organization_id
    where d.status = 'completed' and d.completed_at >= ${start} and d.completed_at < ${end}
      and not exists (select 1 from company_builder_weeks w where w.organization_id = b.organization_id and w.week_key = ${key})
    group by b.organization_id, c.owner_id
    order by b.organization_id, tons desc`);
  let n = 0;
  for (const r of rows) {
    if (r.tons < BUILDER_WEEK.minTons) continue;
    await db.transaction(async (tx) => {
      const inserted = await tx.insert(companyBuilderWeeks).values({ organizationId: r.organization_id, weekKey: key, userId: r.user_id, tons: r.tons }).onConflictDoNothing().returning();
      if (!inserted.length) return;
      // The member's own account first, then the treasury (fixed lock order).
      const account = await companyForUser(tx, r.user_id);
      await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, account.id)).for('update');
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, r.organization_id)).for('update');
      const [u] = await tx.select({ username: users.username }).from(users).where(eq(users.id, r.user_id));
      let prize = 0;
      if (org && org.treasuryCents >= BUILDER_WEEK.rewardCents) {
        prize = BUILDER_WEEK.rewardCents;
        await postTreasury(tx, org.id, [{ category: 'member_bonus', amountCents: -prize, description: t('Строител на седмицата: {0}', u!.username), idempotencyKey: `builder-week:${org.id}:${key}:out`, refType: 'user', refId: r.user_id }]);
        await post(tx, account.id, [{ category: 'member_bonus', amountCents: prize, description: t('Строител на седмицата в „{0}“', org.name), idempotencyKey: `builder-week:${org.id}:${key}:in`, refType: 'company', refId: org.id }]);
        await tx.update(companyBuilderWeeks).set({ rewardCents: prize }).where(and(eq(companyBuilderWeeks.organizationId, org.id), eq(companyBuilderWeeks.weekKey, key)));
      }
      const tons = Math.round(r.tons * 10) / 10;
      await notifyMembers(tx, r.organization_id, null, () => t('Строител на седмицата: {0}', u!.username), () => t('{0} т материали за базата{1}.', tons, prize ? t(' · награда {0} от касата', money(prize)) : ''), '/game/company/plot');
      await announceBuilderOfWeek(tx, key, org?.name ?? '', u!.username, r.tons, prize, now);
      if (prize) await notify(tx, r.user_id, 'success', () => t('Ти си строител на седмицата!'), () => t('Награда {0} от касата на „{1}“.', money(prize), org!.name), '/game/finance');
      n++;
    });
  }
  return n;
}

/** The latest "Строител на седмицата" of a company. */
export async function latestBuilderOfWeek(db: DbOrTx, organizationId: string) {
  const [row] = await db
    .select({ weekKey: companyBuilderWeeks.weekKey, tons: companyBuilderWeeks.tons, rewardCents: companyBuilderWeeks.rewardCents, username: users.username })
    .from(companyBuilderWeeks)
    .leftJoin(users, eq(users.id, companyBuilderWeeks.userId))
    .where(eq(companyBuilderWeeks.organizationId, organizationId))
    .orderBy(desc(companyBuilderWeeks.weekKey))
    .limit(1);
  return row ?? null;
}

/** The company's trophy case: battles won, projects done, builders of the week, building badges of its members. */
export async function companyShowcase(db: DbOrTx, organizationId: string) {
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const [battles, projects, builders, levels] = await Promise.all([
    count(db.select({ n: sql<number>`count(*)::int` }).from(companyBattles).where(eq(companyBattles.winnerId, organizationId))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(companyProjects).where(and(eq(companyProjects.organizationId, organizationId), eq(companyProjects.status, 'done')))),
    count(db.select({ n: sql<number>`count(*)::int` }).from(companyBuilderWeeks).where(eq(companyBuilderWeeks.organizationId, organizationId))),
    count(db.select({ n: sql<number>`coalesce(sum(${companyBuildings.level}), 0)::int` }).from(companyBuildings).where(eq(companyBuildings.organizationId, organizationId))),
  ]);
  const badgeRows = await db
    .select({ badge: userBadges.badge, n: sql<number>`count(*)::int` })
    .from(userBadges)
    .innerJoin(companyMembers, eq(companyMembers.userId, userBadges.userId))
    .where(and(eq(companyMembers.companyId, organizationId), sql`${userBadges.badge} in (${sql.join(Object.values(BUILD_BADGES).map((b) => sql`${b}`), sql`, `)})`))
    .groupBy(userBadges.badge);
  const badges = Object.fromEntries(badgeRows.map((r) => [r.badge, r.n])) as Record<string, number>;
  return { battles, projects, builders, levels, badges, latestBuilder: await latestBuilderOfWeek(db, organizationId) };
}

/** Members whose trip ended in the base city in the last 45 minutes (newest first): their trucks stand in the yard. */
export async function recentVisitors(db: DbOrTx, organizationId: string, hqCityId: number, now = new Date(), limit = 3) {
  const rows = await db
    .select({ username: users.username, at: sql<Date>`max(${deliveries.completedAt})` })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(companyMembers, and(eq(companyMembers.userId, companies.ownerId), eq(companyMembers.companyId, organizationId)))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(deliveries.status, 'completed'), eq(contracts.destCityId, hqCityId), gte(deliveries.completedAt, new Date(now.getTime() - 45 * 60_000)), lte(deliveries.completedAt, now)))
    .groupBy(users.username)
    .orderBy(sql`2 desc`)
    .limit(limit);
  return rows.map((r) => r.username);
}
