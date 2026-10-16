import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { driverCandidates, drivers, vehicles } from '@/server/db/schema';
import { canHireStaff, companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { driverName } from './names';
import { logActivity } from './notify';
import { checkAchievements } from './progression';
import { pickWeighted, randInt } from './random';

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
    if (!(await canHireStaff(tx, userId, company))) fail('company_required', 'Наемането на шофьори изисква да членуваш в компания (или да имаш своя).', 403);
    const [c] = await tx.delete(driverCandidates).where(and(eq(driverCandidates.id, candidateId), eq(driverCandidates.companyId, company.id))).returning();
    if (!c) fail('candidate_not_found', 'Кандидатът вече не е наличен.', 404);
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
    if (!d) fail('driver_not_found', 'Шофьорът не е намерен.', 404);
    if (d!.isOwner) fail('owner_driver', 'Не можете да освободите себе си.');
    if (d!.vehicleId) {
      const [v] = await tx.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, d!.vehicleId));
      if (v?.status === 'on_delivery') fail('driver_busy', 'Шофьорът е на курс.');
    }
    await post(tx, company.id, [{ category: 'severance', amountCents: -d!.salaryCentsPerDay * 3, description: `Обезщетение: ${d!.name}`, idempotencyKey: `severance:${d!.id}` }]);
    await tx.delete(drivers).where(eq(drivers.id, d!.id));
    await logActivity(tx, userId, 'driver_fired', { driverId });
  });
}

/** Assigns a driver to a vehicle (or unassigns with vehicleId = null). One driver per vehicle. */
export async function assignDriver(db: Database, userId: string, driverId: string, vehicleId: string | null) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [d] = await tx.select().from(drivers).where(and(eq(drivers.id, driverId), eq(drivers.companyId, company.id))).for('update');
    if (!d) fail('driver_not_found', 'Шофьорът не е намерен.', 404);
    if (d!.vehicleId) {
      const [current] = await tx.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, d!.vehicleId));
      if (current?.status === 'on_delivery') fail('driver_busy', 'Шофьорът е на курс.');
    }
    if (vehicleId) {
      const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, company.id), isNull(vehicles.soldAt))).for('update');
      if (!v) fail('vehicle_not_found', 'Превозното средство не е намерено.', 404);
      if (v!.status !== 'idle') fail('vehicle_busy', 'Превозното средство е на курс.');
      await tx.update(drivers).set({ vehicleId: null }).where(eq(drivers.vehicleId, vehicleId));
    }
    await tx.update(drivers).set({ vehicleId }).where(eq(drivers.id, d!.id));
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
      post(tx, r.companyId, [{ category: 'salaries', amountCents: -r.total, description: `Заплати за ${day} (${r.n} шофьори)`, idempotencyKey: `payroll:${r.companyId}:${day}` }]),
    );
  }
  return charged;
}
