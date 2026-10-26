import { and, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { powerUnitModel } from '@/lib/game/catalog';
import { TRAIT_MAX, TRAITS, traitLevel, traitPointsLeft, type TraitId } from '@/lib/game/crew';
import type { Database, DbOrTx } from '@/server/db/client';
import { driverCandidates, drivers, vehicles } from '@/server/db/schema';
import { canHireStaff, companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { driverName } from './names';
import { logActivity } from './notify';
import { checkAchievements } from './progression';
import { pickWeighted, randInt } from './random';
import { t } from '@/i18n/t';

const CANDIDATES = 4;
const salaryFor = (skill: number) => (75 + skill * 20 + randInt(0, 12)) * 100;

/** Current hiring pool for a company; refreshed every 24 h. */
export async function candidates(db: DbOrTx, companyId: string, now = new Date()) {
  const current = await db.select().from(driverCandidates).where(and(eq(driverCandidates.companyId, companyId), gt(driverCandidates.expiresAt, now)));
  if (current.length) return current;
  await db.delete(driverCandidates).where(and(eq(driverCandidates.companyId, companyId), lte(driverCandidates.expiresAt, now)));
  const expiresAt = new Date(now.getTime() + 86_400_000);
  const rows = Array.from({ length: CANDIDATES }, () => {
    const skill = pickWeighted([1, 2, 3, 4, 5], (s) => [0, 40, 32, 17, 8, 3][s] ?? 0) ?? 1;
    return { companyId, name: driverName(), skill, salaryCentsPerDay: salaryFor(skill), expiresAt };
  });
  return db.insert(driverCandidates).values(rows).returning();
}

export async function hireDriver(db: Database, userId: string, candidateId: string) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    if (!(await canHireStaff(tx, userId, company))) fail('company_required', t('Наемането на шофьори изисква да членуваш в компания (или да имаш своя).'), 403);
    const [c] = await tx.delete(driverCandidates).where(and(eq(driverCandidates.id, candidateId), eq(driverCandidates.companyId, company.id))).returning();
    if (!c) fail('candidate_not_found', t('Кандидатът вече не е наличен.'), 404);
    const [driver] = await tx.insert(drivers).values({ companyId: company.id, name: c!.name, skill: c!.skill, salaryCentsPerDay: c!.salaryCentsPerDay }).returning();
    await logActivity(tx, userId, 'driver_hired', { driverId: driver!.id });
    await checkAchievements(tx, userId, company.id);
    return driver!;
  });
}

export async function fireDriver(db: Database, userId: string, driverId: string) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [d] = await tx.select().from(drivers).where(and(eq(drivers.id, driverId), eq(drivers.companyId, company.id))).for('update');
    if (!d) fail('driver_not_found', t('Шофьорът не е намерен.'), 404);
    if (d!.isOwner) fail('owner_driver', t('Не можете да освободите себе си.'));
    await assertNotDriving(tx, d!);
    await post(tx, company.id, [{ category: 'severance', amountCents: -d!.salaryCentsPerDay * 3, description: t('Обезщетение: {0}', d!.name), idempotencyKey: `severance:${d!.id}` }]);
    await tx.delete(drivers).where(eq(drivers.id, d!.id));
    await logActivity(tx, userId, 'driver_fired', { driverId });
  });
}

async function assertNotDriving(tx: DbOrTx, d: { vehicleId: string | null; coVehicleId: string | null }) {
  const seats = [d.vehicleId, d.coVehicleId].filter((x): x is string => !!x);
  if (!seats.length) return;
  const busy = await tx.select({ id: vehicles.id }).from(vehicles).where(and(inArray(vehicles.id, seats), eq(vehicles.status, 'on_delivery')));
  if (busy.length) fail('driver_busy', t('Шофьорът е на курс.'));
}

/**
 * Puts a driver on a vehicle (or takes them off with vehicleId = null). The
 * main seat drives; the second seat makes a team (not in vans). A driver sits
 * in one seat at a time.
 */
export async function assignDriver(db: Database, userId: string, driverId: string, vehicleId: string | null, seat: 'main' | 'co' = 'main') {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [d] = await tx.select().from(drivers).where(and(eq(drivers.id, driverId), eq(drivers.companyId, company.id))).for('update');
    if (!d) fail('driver_not_found', t('Шофьорът не е намерен.'), 404);
    await assertNotDriving(tx, d!);
    if (vehicleId) {
      const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, company.id), isNull(vehicles.soldAt))).for('update');
      if (!v) fail('vehicle_not_found', t('Превозното средство не е намерено.'), 404);
      if (v!.status !== 'idle') fail('vehicle_busy', t('Превозното средство е на курс.'));
      if (seat === 'co' && powerUnitModel(v!.modelId).kind === 'van') fail('no_team_in_van', t('Във вана няма място за втори шофьор.'));
      if (seat === 'co' && v!.ownership === 'rented') fail('rented', t('Наетият камион се кара от един шофьор.'));
      if (seat === 'main') await tx.update(drivers).set({ vehicleId: null }).where(eq(drivers.vehicleId, vehicleId));
      else await tx.update(drivers).set({ coVehicleId: null }).where(eq(drivers.coVehicleId, vehicleId));
    }
    await tx
      .update(drivers)
      .set(seat === 'main' || !vehicleId ? { vehicleId, coVehicleId: null } : { vehicleId: null, coVehicleId: vehicleId })
      .where(eq(drivers.id, d!.id));
  });
}

/** Spends one of a driver's skill points (one per skill level above the first). */
export async function trainDriver(db: Database, userId: string, driverId: string, trait: TraitId) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [d] = await tx.select().from(drivers).where(and(eq(drivers.id, driverId), eq(drivers.companyId, company.id))).for('update');
    if (!d) fail('driver_not_found', t('Шофьорът не е намерен.'), 404);
    if (traitPointsLeft(d!.skill, d!.traits) <= 0) fail('no_points', t('Няма свободни точки — шофьорът получава точка с всяко ново ниво на умение.'));
    if (traitLevel(d!.traits, trait) >= TRAIT_MAX) fail('max_trait', t('{0} е на максимум.', TRAITS[trait].short));
    await tx.update(drivers).set({ traits: { ...d!.traits, [trait]: traitLevel(d!.traits, trait) + 1 } }).where(eq(drivers.id, d!.id));
  });
}

/** Daily payroll. Idempotent per company and UTC day. */
export async function runPayroll(db: Database, day: string) {
  const rows = await db
    .select({ companyId: drivers.companyId, total: sql<number>`sum(${drivers.salaryCentsPerDay})::int`, n: sql<number>`count(*)::int` })
    .from(drivers)
    .groupBy(drivers.companyId);
  let charged = 0;
  for (const r of rows) {
    if (r.total <= 0) continue; // owner-drivers draw no salary
    charged += await db.transaction((tx) =>
      post(tx, r.companyId, [{ category: 'salaries', amountCents: -r.total, description: t('Заплати за {0} ({1} шофьори)', day, r.n), idempotencyKey: `payroll:${r.companyId}:${day}` }]),
    );
  }
  return charged;
}
