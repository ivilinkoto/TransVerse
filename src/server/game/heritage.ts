import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { BADGES } from '@/lib/game/halloween';
import { legendTier, legendTiersCrossed, LEGEND_BADGE, MUSEUM, SCRAP } from '@/lib/game/heritage';
import { powerUnitModel } from '@/lib/game/catalog';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { drivers, museumExhibits, trailers, userBadges, users, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { addChronicle } from './chronicle';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { assertNotLeased } from './leasing';
import { membershipOf } from './membership';
import { notify } from './notify';
import { t as tr, intlLocale } from '@/i18n/t';

/** A truck's odometer passed a legend mark on this trip: a title and ТрансКоин for its owner (once per tier). */
export async function checkLegend(tx: Tx, userId: string, v: { id: string; plate: string; ownership: string; modelId: string }, before: number, after: number, at: Date) {
  if (v.ownership !== 'owned' || !(await featureFor(tx, userId, 'legendary_trucks', at))) return;
  for (const t of legendTiersCrossed(before, after)) {
    const paid = await postCoins(tx, userId, { amount: t.coins, reason: 'legend', description: `${t.title}: ${v.plate}`, idempotencyKey: `legend:${v.id}:${t.tier}` });
    if (!paid) continue;
    await notify(tx, userId, 'achievement', `${t.title}! 🏆`, () => tr('{0} ({1}) измина {2} 000 км. +{3} TC.', powerUnitModel(v.modelId).name, v.plate, (t.km / 1000).toLocaleString(intlLocale()), t.coins), `/game/garage/${v.id}`);
    if (t.tier === 1) {
      const [got] = await tx.insert(userBadges).values({ userId, badge: LEGEND_BADGE, awardedAt: at }).onConflictDoNothing().returning();
      if (got) await notify(tx, userId, 'achievement', () => tr('Значка: {0}', BADGES[LEGEND_BADGE]?.label ?? ''), () => tr('Първият ти камион легенда.'), '/game/progress');
    }
  }
}

async function ownIdleTruck(tx: Tx, companyId: string, vehicleId: string) {
  const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, companyId), isNull(vehicles.soldAt))).for('update');
  if (!v) fail('vehicle_not_found', tr('Камионът не е намерен.'), 404);
  if (v!.ownership !== 'owned') fail('rented', tr('Само собствен камион.'));
  if (v!.status === 'listed') fail('listed', tr('Камионът е обявен на пазара — първо свали обявата.'));
  if (v!.status !== 'idle') fail('vehicle_busy', tr('Камионът е на курс.'));
  await assertNotLeased(tx, v!.id);
  return v!;
}

/** Takes a truck off the road: its trailer and drivers step off. */
async function retire(tx: Tx, vehicleId: string, status: 'scrapped' | 'museum', now: Date) {
  await tx.update(trailers).set({ vehicleId: null }).where(eq(trailers.vehicleId, vehicleId));
  await tx.update(drivers).set({ vehicleId: null }).where(eq(drivers.vehicleId, vehicleId));
  await tx.update(drivers).set({ coVehicleId: null }).where(eq(drivers.coVehicleId, vehicleId));
  await tx.update(vehicles).set({ status, soldAt: now }).where(eq(vehicles.id, vehicleId));
}

/** The scrapyard: a tenth of the new price and spare parts. */
export async function scrapVehicle(db: Database, userId: string, vehicleId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'scrapyard', now))) fail('not_released', tr('Това идва със следващото обновление.'), 403);
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const v = await ownIdleTruck(tx, company.id, vehicleId);
    const model = powerUnitModel(v.modelId);
    const cents = Math.round(model.priceCents * SCRAP.share);
    const parts = SCRAP.parts[model.kind] ?? 1;
    await post(tx, company.id, [{ category: 'vehicle_sale', amountCents: cents, description: tr('Скрап: {0} ({1})', model.name, v.plate), idempotencyKey: `scrap:${v.id}`, refType: 'vehicle', refId: v.id }]);
    await retire(tx, v.id, 'scrapped', now);
    await tx.update(users).set({ spareParts: sql`${users.spareParts} + ${parts}` }).where(eq(users.id, userId));
    return { cents, parts };
  });
}

/** A spare part repairs an own idle truck by a quarter. */
export async function repairWithPart(db: Database, userId: string, vehicleId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'scrapyard', now))) fail('not_released', tr('Това идва със следващото обновление.'), 403);
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ parts: users.spareParts }).from(users).where(eq(users.id, userId)).for('update');
    if (!u || u.parts < 1) fail('no_parts', tr('Нямаш резервни части — скрап камион ги дава.'));
    const company = await companyForUser(tx, userId);
    const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, company.id), isNull(vehicles.soldAt))).for('update');
    if (!v) fail('vehicle_not_found', tr('Камионът не е намерен.'), 404);
    if (v!.ownership !== 'owned') fail('rented', tr('Само собствен камион.'));
    if (v!.status !== 'idle') fail('vehicle_busy', tr('Камионът е на курс.'));
    if (v!.condition >= 100) fail('full', tr('Камионът е в отлично състояние.'));
    const condition = Math.min(100, v!.condition + SCRAP.repairPerPart);
    await tx.update(vehicles).set({ condition }).where(eq(vehicles.id, v!.id));
    await tx.update(users).set({ spareParts: sql`${users.spareParts} - 1` }).where(eq(users.id, userId));
    return { condition, parts: u!.parts - 1 };
  });
}

/** A member donates an own truck with a long life behind it to the company museum. */
export async function donateToMuseum(db: Database, userId: string, vehicleId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'museum', now))) fail('not_released', tr('Това идва със следващото обновление.'), 403);
  return db.transaction(async (tx) => {
    const m = await membershipOf(tx, userId, true);
    if (!m) fail('not_member', tr('Музеят е на компанията — не членувате в компания.'), 403);
    const level = (m!.company.upgrades as { museum?: number }).museum ?? 0;
    const capacity = MUSEUM.capacity[level] ?? 0;
    if (!capacity) fail('no_museum', tr('Компанията още няма музей на участъка.'));
    const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(museumExhibits).where(eq(museumExhibits.organizationId, m!.company.id));
    if (n >= capacity) fail('full', tr('Музеят е пълен ({0}) — следващото ниво побира повече.', capacity));
    const company = await companyForUser(tx, userId);
    const v = await ownIdleTruck(tx, company.id, vehicleId);
    if (v.odometerKm < MUSEUM.minKm) fail('young', tr('В музея влизат камиони с поне {0} км.', MUSEUM.minKm.toLocaleString(intlLocale())));
    await tx.insert(museumExhibits).values({ organizationId: m!.company.id, vehicleId: v.id, modelId: v.modelId, plate: v.plate, color: v.color, livery: v.livery, odometerKm: v.odometerKm, donatedBy: userId, donatedAt: now });
    await retire(tx, v.id, 'museum', now);
    const coins = legendTier(v.odometerKm) ? MUSEUM.legendCoins : MUSEUM.coins;
    await postCoins(tx, userId, { amount: coins, reason: 'legend', description: tr('Дарение за музея: {0}', v.plate), idempotencyKey: `museum:${v.id}` });
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    await addChronicle(tx, m!.company.id, 'museum', `${me!.username} дари ${powerUnitModel(v.modelId).name} (${v.plate}, ${Math.round(v.odometerKm).toLocaleString(intlLocale())} км) на музея.`, now);
    return { coins };
  });
}

/** The museum of a company: the exhibits, newest first. */
export async function museumOf(db: DbOrTx, organizationId: string) {
  return db
    .select({ id: museumExhibits.id, modelId: museumExhibits.modelId, plate: museumExhibits.plate, color: museumExhibits.color, livery: museumExhibits.livery, odometerKm: museumExhibits.odometerKm, donatedAt: museumExhibits.donatedAt, donor: users.username })
    .from(museumExhibits)
    .leftJoin(users, eq(users.id, museumExhibits.donatedBy))
    .where(eq(museumExhibits.organizationId, organizationId))
    .orderBy(desc(museumExhibits.donatedAt));
}

/** The player's spare parts. */
export async function sparePartsOf(db: DbOrTx, userId: string) {
  const [u] = await db.select({ parts: users.spareParts }).from(users).where(eq(users.id, userId));
  return u?.parts ?? 0;
}

