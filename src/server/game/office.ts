import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, officeStaff, users } from '@/server/db/schema';
import { OFFICE_MAX_LEVEL, OFFICE_ROLES, officeEffect, officeHire, officeSalaryCents, officeTrainCents, type OfficeRole } from '@/lib/game/office';
import { t } from '@/i18n/t';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';

/** 1.1.4.2 „Офис“: one person per role; the salary is paid with the drivers' payroll. */
export async function officeOf(db: DbOrTx, companyId: string) {
  return db.select().from(officeStaff).where(eq(officeStaff.companyId, companyId));
}

export async function officeLevel(db: DbOrTx, companyId: string, role: OfficeRole) {
  const [r] = await db.select({ level: officeStaff.level }).from(officeStaff).where(and(eq(officeStaff.companyId, companyId), eq(officeStaff.role, role)));
  return r?.level ?? 0;
}

/** The office effects of a company in one read. */
export async function officeEffects(db: DbOrTx, companyId: string) {
  const rows = await officeOf(db, companyId);
  const level = (role: OfficeRole) => rows.find((r) => r.role === role)?.level ?? 0;
  return { dispatcher: officeEffect('dispatcher', level('dispatcher')), accountant: officeEffect('accountant', level('accountant')), sales: officeEffect('sales', level('sales')), inspector: officeEffect('inspector', level('inspector')) };
}

export async function hireOffice(db: Database, userId: string, role: OfficeRole) {
  if (!(role in OFFICE_ROLES)) fail('unknown_role', t('Непозната длъжност.'));
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    if (await officeLevel(tx, company.id, role)) fail('office_taken', t('Тази длъжност вече е заета.'));
    const hire = officeHire(Math.random);
    const salary = officeSalaryCents(1);
    // The first day is paid on hiring.
    await post(tx, company.id, [{ category: 'office', amountCents: -salary, description: t('Назначен: {0} ({1})', hire.name, OFFICE_ROLES[role].label), idempotencyKey: `office-hire:${company.id}:${role}:${Date.now()}` }], { requireFunds: true });
    const [row] = await tx.insert(officeStaff).values({ companyId: company.id, role, name: hire.name, trait: hire.trait, level: 1, salaryCentsPerDay: salary }).returning();
    return row!;
  });
}

export async function trainOffice(db: Database, userId: string, role: OfficeRole) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [row] = await tx.select().from(officeStaff).where(and(eq(officeStaff.companyId, company.id), eq(officeStaff.role, role))).for('update');
    if (!row) fail('office_missing', t('Няма назначен човек на тази длъжност.'), 404);
    if (row!.level >= OFFICE_MAX_LEVEL) fail('office_max', t('Вече е на най-високото ниво.'));
    const next = row!.level + 1;
    await post(tx, company.id, [{ category: 'office', amountCents: -officeTrainCents(next), description: t('Обучение: {0} → ниво {1}', row!.name, next), idempotencyKey: `office-train:${row!.id}:${next}` }], { requireFunds: true });
    await tx.update(officeStaff).set({ level: next, salaryCentsPerDay: officeSalaryCents(next) }).where(eq(officeStaff.id, row!.id));
    return { level: next };
  });
}

export async function fireOffice(db: DbOrTx, userId: string, role: OfficeRole) {
  const company = await companyForUser(db, userId);
  await db.delete(officeStaff).where(and(eq(officeStaff.companyId, company.id), eq(officeStaff.role, role)));
}

/** With the payroll: the office salaries of the day (not for players on vacation). */
export async function runOfficePayroll(db: Database, day: string, now = new Date()) {
  const rows = await db
    .select({ companyId: officeStaff.companyId, total: sql<number>`sum(${officeStaff.salaryCentsPerDay})::int`, n: sql<number>`count(*)::int` })
    .from(officeStaff)
    .innerJoin(companies, eq(companies.id, officeStaff.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(or(isNull(users.vacationUntil), lte(users.vacationUntil, now)))
    .groupBy(officeStaff.companyId);
  for (const r of rows) {
    await db.transaction((tx) => post(tx, r.companyId, [{ category: 'office', amountCents: -r.total, description: t('Офис: заплати за {0} ({1} души)', day, r.n), idempotencyKey: `office-payroll:${r.companyId}:${day}` }]));
  }
  return rows.length;
}

