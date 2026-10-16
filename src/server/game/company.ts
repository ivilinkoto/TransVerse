import { and, eq, sql } from 'drizzle-orm';
import { ECONOMY } from '@/lib/game/economy';
import { isFreightHub } from '@/lib/game/markets';
import type { DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, depots, drivers, users, vehicles } from '@/server/db/schema';
import { fail } from './errors';
import { post } from './finance';
import { driverName, plate } from './names';
import { logActivity, notify } from './notify';

export type Company = typeof companies.$inferSelect;

export async function companyForUser(db: DbOrTx, userId: string): Promise<Company> {
  const [company] = await db.select().from(companies).where(eq(companies.ownerId, userId));
  if (!company) fail('company_not_found', 'Нямате компания.', 404);
  return company!;
}

/** BG cities you may choose as headquarters (real cities taking part in the freight market). */
export async function headquarterOptions(db: DbOrTx) {
  const rows = await db
    .select({ id: cities.id, nameBg: cities.nameBg, population: cities.population, countryCode: cities.countryCode })
    .from(cities)
    .where(eq(cities.countryCode, 'BG'))
    .orderBy(sql`${cities.population} desc`);
  return rows.filter((c) => isFreightHub({ population: c.population, country: c.countryCode }));
}

/**
 * New company with its starter kit: capital, HQ depot, a used van and a junior
 * driver — so the first delivery is possible right after registration.
 */
export async function createCompany(tx: Tx, input: { userId: string; name: string; hqCityId: number }) {
  const options = await headquarterOptions(tx);
  if (!options.some((c) => c.id === input.hqCityId)) fail('invalid_hq', 'Изберете град в България за седалище.');

  const [taken] = await tx.select({ id: companies.id }).from(companies).where(sql`lower(${companies.name}) = lower(${input.name})`);
  if (taken) fail('company_name_taken', 'Компания с такова име вече съществува.', 409);

  const [company] = await tx.insert(companies).values({ ownerId: input.userId, name: input.name, hqCityId: input.hqCityId, balanceCents: 0 }).returning();
  await post(tx, company!.id, [{ category: 'starting_capital', amountCents: ECONOMY.startingBalanceCents, description: 'Начален капитал', idempotencyKey: `start:${company!.id}` }]);
  await tx.insert(depots).values({ companyId: company!.id, cityId: input.hqCityId, slots: ECONOMY.depotSlotsDefault });

  const [van] = await tx
    .insert(vehicles)
    .values({ companyId: company!.id, modelId: 'sokol-courier', plate: plate(), color: '#e5e7eb', cityId: input.hqCityId, condition: 85, odometerKm: 96_400, purchasePriceCents: 0 })
    .returning();
  await tx.insert(drivers).values({ companyId: company!.id, name: driverName(), skill: 2, salaryCentsPerDay: 110_00, vehicleId: van!.id });

  await logActivity(tx, input.userId, 'company_created', { companyId: company!.id, name: input.name });
  await notify(tx, input.userId, 'info', 'Добре дошли в TransVerse!', 'Имате ван, шофьор и 60 000 €. Отворете „Поръчки“ и изберете първия си курс.', '/game/contracts');
  return company!;
}

export async function userWithCompany(db: DbOrTx, userId: string) {
  const [row] = await db
    .select({ user: users, company: companies, hq: cities })
    .from(users)
    .innerJoin(companies, eq(companies.ownerId, users.id))
    .innerJoin(cities, eq(cities.id, companies.hqCityId))
    .where(and(eq(users.id, userId)));
  if (!row) fail('company_not_found', 'Нямате компания.', 404);
  return row!;
}
