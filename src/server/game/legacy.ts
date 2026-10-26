import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { STARTER_RENTAL } from '@/lib/game/catalog';
import { ECONOMY } from '@/lib/game/economy';
import { LEGACY, legacyShare } from '@/lib/game/empire';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, depots, drivers, legacyRuns, loans, organizations, trailers, users, vehicleLeases, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { addRental, companyForUser, headquarterOptions } from './company';
import { fail } from './errors';
import { post } from './finance';
import { logActivity, notify } from './notify';
import { t as tr } from '@/i18n/t';

/** What stands between the player and a new start (empty = ready). */
export async function legacyBlockers(db: DbOrTx, userId: string, now = new Date()): Promise<string[]> {
  const [u] = await db.select({ level: users.level, stars: users.legacyStars }).from(users).where(eq(users.id, userId));
  const company = await companyForUser(db, userId);
  const out: string[] = [];
  if ((u?.level ?? 1) < LEGACY.minLevel) out.push(tr('Нужно е ниво {0}.', LEGACY.minLevel));
  if ((u?.stars ?? 0) >= LEGACY.maxStars) out.push(tr('Имаш всичките {0} звезди на наследството.', LEGACY.maxStars));
  const [last] = await db.select({ at: legacyRuns.createdAt }).from(legacyRuns).where(eq(legacyRuns.userId, userId)).orderBy(desc(legacyRuns.createdAt)).limit(1);
  if (last && now.getTime() - last.at.getTime() < LEGACY.cooldownDays * 86_400_000) out.push(tr('Ново начало е възможно веднъж на {0} дни.', LEGACY.cooldownDays));
  const busy = await db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.companyId, company.id), isNull(vehicles.soldAt), ne(vehicles.status, 'idle')));
  if (busy.length) out.push(tr('Всички камиони трябва да са свободни (без курс и без обява).'));
  const hired = await db.select({ id: trailers.id }).from(trailers).where(and(eq(trailers.companyId, company.id), isNull(trailers.soldAt), or(eq(trailers.hiredOut, true), inArray(trailers.ownership, ['company', 'hired']))));
  const lent = await db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.companyId, company.id), isNull(vehicles.soldAt), eq(vehicles.ownership, 'company')));
  if (hired.length || lent.length) out.push(tr('Върни фирмената техника и наетите ремаркета (и прибери даденото под наем).'));
  const [loan] = await db.select({ id: loans.id }).from(loans).where(and(eq(loans.companyId, company.id), eq(loans.status, 'active')));
  if (loan) out.push(tr('Първо върни кредита.'));
  const [lease] = await db.select({ id: vehicleLeases.id }).from(vehicleLeases).where(and(eq(vehicleLeases.companyId, company.id), eq(vehicleLeases.status, 'active')));
  if (lease) out.push(tr('Първо приключи лизинга.'));
  const [owned] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.ownerId, userId));
  if (owned) out.push(tr('Първо предай собствеността на компанията си.'));
  return out;
}

/**
 * New Game+ (v2.0): the career starts over — level 1, the starting money, a
 * rented truck in a city of the player's choice; the fleet, the depots and
 * the hired drivers are gone. The player keeps a legacy star (a little more
 * on every load, for good), ТрансКоин, VIP, badges, licences and friends.
 */
export async function startNewCareer(db: Database, userId: string, startCityId: number, now = new Date()) {
  if (!(await featureFor(db, userId, 'legacy', now))) fail('not_released', tr('Това идва със следващото обновление.'), 403);
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ level: users.level, stars: users.legacyStars, username: users.username }).from(users).where(eq(users.id, userId)).for('update');
    const blockers = await legacyBlockers(tx, userId, now);
    if (blockers.length) fail('legacy_blocked', blockers[0]!);
    if (!(await headquarterOptions(tx)).some((c) => c.id === startCityId)) fail('invalid_hq', tr('Изберете начален град в България.'));
    const company = await companyForUser(tx, userId);
    const [account] = await tx.select().from(companies).where(eq(companies.id, company.id)).for('update');
    const star = (u!.stars ?? 0) + 1;
    await tx.insert(legacyRuns).values({ userId, star, level: u!.level, deliveries: account!.deliveries, totalKm: account!.totalKm, createdAt: now });
    // The old fleet leaves the game (kept for the history); the hired drivers go.
    const fleet = (await tx.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.companyId, company.id), isNull(vehicles.soldAt)))).map((v) => v.id);
    if (fleet.length) {
      await tx.update(drivers).set({ vehicleId: null, coVehicleId: null }).where(eq(drivers.companyId, company.id));
      await tx.update(trailers).set({ vehicleId: null }).where(inArray(trailers.vehicleId, fleet));
      await tx.update(vehicles).set({ status: 'sold', soldAt: now }).where(inArray(vehicles.id, fleet));
    }
    await tx.update(trailers).set({ soldAt: now }).where(and(eq(trailers.companyId, company.id), isNull(trailers.soldAt)));
    await tx.delete(drivers).where(and(eq(drivers.companyId, company.id), eq(drivers.isOwner, false)));
    await tx.delete(depots).where(eq(depots.companyId, company.id));
    // The money back to the starting capital.
    const diff = ECONOMY.startingBalanceCents - account!.balanceCents;
    if (diff) await post(tx, company.id, [{ category: 'legacy_reset', amountCents: diff, description: tr('Ново начало · звезда {0} на наследството', star), idempotencyKey: `legacy:${userId}:${star}` }]);
    await tx.update(companies).set({ kind: 'independent', hqCityId: startCityId, foundedAt: null, reputation: 0, deliveries: 0, onTimeDeliveries: 0, totalKm: 0 }).where(eq(companies.id, company.id));
    await tx.update(users).set({ xp: 0, level: 1, legacyStars: star }).where(eq(users.id, userId));
    const truck = await addRental(tx, company.id, STARTER_RENTAL, startCityId);
    await tx.update(drivers).set({ vehicleId: truck.id }).where(and(eq(drivers.companyId, company.id), eq(drivers.isOwner, true)));
    await logActivity(tx, userId, 'legacy_start', { star, level: u!.level });
    await notify(tx, userId, 'achievement', () => tr('Ново начало! ⭐ {0}', star), () => tr('Кариерата започва отново с нает камион. Звездите на наследството плащат +{0} % на всеки товар.', Math.round(legacyShare(star) * 100)), '/game/contracts');
    return { star };
  });
}

/** The legacy stars pay a little more on every load (personal account). */
export async function legacyBonus(tx: Tx, userId: string, d: { id: string; companyId: string }, rewardCents: number, now: Date) {
  const [u] = await tx.select({ stars: users.legacyStars }).from(users).where(eq(users.id, userId));
  if (!u?.stars || !(await featureFor(tx, userId, 'legacy', now))) return 0;
  const bonus = Math.round(rewardCents * legacyShare(u.stars));
  if (bonus > 0) await post(tx, d.companyId, [{ category: 'legacy_bonus', amountCents: bonus, description: tr('Наследство: {0} ⭐', u.stars), idempotencyKey: `delivery:${d.id}:legacy`, refType: 'delivery', refId: d.id }]);
  return bonus;
}

/** A player's earlier careers. */
export async function legacyOf(db: DbOrTx, userId: string) {
  return db.select().from(legacyRuns).where(eq(legacyRuns.userId, userId)).orderBy(legacyRuns.star);
}
