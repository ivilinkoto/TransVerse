import { and, eq, sql } from 'drizzle-orm';
import { ACHIEVEMENTS, levelForXp, type CompanyStats } from '@/lib/game/progression';
import type { DbOrTx, Tx } from '@/server/db/client';
import { achievements, companies, deliveries, depots, drivers, cities, users, vehicles } from '@/server/db/schema';
import { post } from './finance';
import { notify } from './notify';

export async function companyStats(db: DbOrTx, companyId: string): Promise<CompanyStats> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw new Error('company not found');
  const [user] = await db.select({ level: users.level }).from(users).where(eq(users.id, company.ownerId));
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const vehiclesN = await count(db.select({ n: sql<number>`count(*)::int` }).from(vehicles).where(eq(vehicles.companyId, companyId)));
  const driversN = await count(db.select({ n: sql<number>`count(*)::int` }).from(drivers).where(eq(drivers.companyId, companyId)));
  const depotsN = await count(db.select({ n: sql<number>`count(*)::int` }).from(depots).where(eq(depots.companyId, companyId)));
  const countriesN = await count(
    db
      .select({ n: sql<number>`count(distinct ${cities.countryCode})::int` })
      .from(deliveries)
      .innerJoin(sql`contracts c`, sql`c.id = ${deliveries.contractId}`)
      .innerJoin(cities, sql`${cities.id} = c.dest_city_id`)
      .where(and(eq(deliveries.companyId, companyId), eq(deliveries.status, 'completed'))),
  );
  const [maxReward] = await db
    .select({ n: sql<number>`coalesce(max(${deliveries.payoutCents}), 0)::bigint` })
    .from(deliveries)
    .where(eq(deliveries.companyId, companyId));
  return {
    deliveries: company.deliveries,
    onTimeDeliveries: company.onTimeDeliveries,
    totalKm: company.totalKm,
    vehicles: vehiclesN,
    drivers: driversN,
    depots: depotsN,
    countriesServed: countriesN,
    level: user?.level ?? 1,
    balanceCents: company.balanceCents,
    maxSingleRewardCents: Number(maxReward?.n ?? 0),
  };
}

/** Adds XP, recomputes the level and notifies on level-up. */
export async function awardXp(tx: Tx, userId: string, xp: number): Promise<{ level: number; leveledUp: boolean }> {
  const [user] = await tx.update(users).set({ xp: sql`${users.xp} + ${xp}` }).where(eq(users.id, userId)).returning({ xp: users.xp, level: users.level });
  const level = levelForXp(user!.xp);
  if (level > user!.level) {
    await tx.update(users).set({ level }).where(eq(users.id, userId));
    await notify(tx, userId, 'achievement', `Ниво ${level}!`, 'Отключихте нови възможности. Вижте „Прогрес“.', '/game/progress');
    return { level, leveledUp: true };
  }
  return { level, leveledUp: false };
}

/** Unlocks any newly earned achievements (exactly once each) and pays their rewards. */
export async function checkAchievements(tx: Tx, userId: string, companyId: string): Promise<string[]> {
  const stats = await companyStats(tx, companyId);
  const unlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!a.check(stats)) continue;
    const inserted = await tx.insert(achievements).values({ userId, key: a.key }).onConflictDoNothing().returning({ key: achievements.key });
    if (!inserted.length) continue;
    unlocked.push(a.key);
    if (a.rewardCents) await post(tx, companyId, [{ category: 'achievement_reward', amountCents: a.rewardCents, description: `Постижение: ${a.title}`, idempotencyKey: `achievement:${userId}:${a.key}` }]);
    if (a.rewardXp) await awardXp(tx, userId, a.rewardXp);
    await notify(tx, userId, 'achievement', `Постижение: ${a.title}`, a.description, '/game/progress');
  }
  return unlocked;
}
