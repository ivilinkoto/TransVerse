import { and, eq, sql } from 'drizzle-orm';
import { RENTAL_OFFERS, STARTER_RENTAL } from '@/lib/game/catalog';
import { ECONOMY } from '@/lib/game/economy';
import { isFreightHub } from '@/lib/game/markets';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, companyMembers, depots, drivers, organizations, trailers, users, vehicles } from '@/server/db/schema';
import { fail } from './errors';
import { post } from './finance';
import { plate } from './names';
import { logActivity, notify } from './notify';
import { checkAchievements } from './progression';

export type Company = typeof companies.$inferSelect;

/** Name shown for a player: their company's name, or the player as a carrier / independent driver. */
export function displayName(companyName: string | null | undefined, username: string, kind = 'independent'): string {
  return companyName ?? `${username} · ${kind === 'company' ? 'частен превозвач' : 'самостоятелен шофьор'}`;
}

export async function companyForUser(db: DbOrTx, userId: string): Promise<Company> {
  const [company] = await db.select().from(companies).where(eq(companies.ownerId, userId));
  if (!company) fail('company_not_found', 'Профилът няма игрови акаунт.', 404);
  return company!;
}

/** Fails unless the player has founded a company (used to gate company-only features). */
export async function requireFoundedCompany(db: DbOrTx, userId: string): Promise<Company> {
  const company = await companyForUser(db, userId);
  if (company.kind !== 'company') fail('company_required', 'Тази възможност изисква лиценз от основана (или поета) транспортна компания.', 403);
  return company;
}

/** Hiring drivers: open to licensed operators and to members of any player company. */
export async function canHireStaff(db: DbOrTx, userId: string, company: Pick<Company, 'kind'>): Promise<boolean> {
  if (company.kind === 'company') return true;
  const [member] = await db.select({ id: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.userId, userId));
  return !!member;
}

/** Real Bulgarian cities taking part in the freight market (start city / headquarters). */
export async function headquarterOptions(db: DbOrTx) {
  const rows = await db
    .select({ id: cities.id, nameBg: cities.nameBg, population: cities.population, countryCode: cities.countryCode })
    .from(cities)
    .where(eq(cities.countryCode, 'BG'))
    .orderBy(sql`${cities.population} desc`);
  return rows.filter((c) => isFreightHub({ population: c.population, country: c.countryCode }));
}

/** Adds a rented vehicle (and trailer, for tractor offers) in a city. */
export async function addRental(tx: Tx, companyId: string, offerId: string, cityId: number) {
  const offer = RENTAL_OFFERS.find((o) => o.id === offerId);
  if (!offer) fail('unknown_offer', 'Непозната оферта за наем.');
  const [vehicle] = await tx
    .insert(vehicles)
    .values({ companyId, modelId: offer!.unitId, plate: plate(), color: '#f8fafc', cityId, ownership: 'rented', purchasePriceCents: 0 })
    .returning();
  if (offer!.trailerId) {
    await tx.insert(trailers).values({ companyId, modelId: offer!.trailerId, plate: plate(), cityId, vehicleId: vehicle!.id, ownership: 'rented', purchasePriceCents: 0 });
  }
  return vehicle!;
}

/**
 * Every new player starts as an independent driver: a rented truck that they
 * drive themselves, a little cash, and no company yet.
 */
export async function createIndependent(tx: Tx, input: { userId: string; username: string; startCityId: number }) {
  const options = await headquarterOptions(tx);
  if (!options.some((c) => c.id === input.startCityId)) fail('invalid_hq', 'Изберете начален град в България.');

  const [account] = await tx.insert(companies).values({ ownerId: input.userId, kind: 'independent', hqCityId: input.startCityId, balanceCents: 0 }).returning();
  await post(tx, account!.id, [{ category: 'starting_capital', amountCents: ECONOMY.startingBalanceCents, description: 'Начални средства', idempotencyKey: `start:${account!.id}` }]);
  const truck = await addRental(tx, account!.id, STARTER_RENTAL, input.startCityId);
  await tx.insert(drivers).values({ companyId: account!.id, name: input.username, skill: 1, salaryCentsPerDay: 0, isOwner: true, vehicleId: truck.id });

  await logActivity(tx, input.userId, 'registered_independent', { startCityId: input.startCityId });
  await notify(tx, input.userId, 'info', 'Добре дошли в TransVerse!', 'Започвате като самостоятелен шофьор с нает камион. Обучението ще ви преведе през първия курс.', '/game/contracts');
  return account!;
}

export interface FoundingCheck {
  level: { required: number; current: number; ok: boolean };
  deliveries: { required: number; current: number; ok: boolean };
  funds: { required: number; current: number; ok: boolean };
  ok: boolean;
}

export async function foundingCheck(db: DbOrTx, userId: string): Promise<FoundingCheck> {
  const company = await companyForUser(db, userId);
  const [user] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  const level = { required: ECONOMY.foundingMinLevel, current: user?.level ?? 1, ok: (user?.level ?? 1) >= ECONOMY.foundingMinLevel };
  const deliveries = { required: ECONOMY.foundingMinDeliveries, current: company.deliveries, ok: company.deliveries >= ECONOMY.foundingMinDeliveries };
  const funds = { required: ECONOMY.foundingFeeCents, current: company.balanceCents, ok: company.balanceCents >= ECONOMY.foundingFeeCents };
  return { level, deliveries, funds, ok: level.ok && deliveries.ok && funds.ok };
}

/**
 * Founds a transport company: a new organisation with its own (empty) treasury,
 * owned by the player, plus the operator licence and an HQ depot for the
 * player's own fleet. The fee is paid from the player's personal balance.
 */
export async function foundCompany(db: Database, userId: string, input: { name: string; hqCityId: number }) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const { membershipOf, setupCompanyMembership } = await import('./membership');
    if (await membershipOf(tx, userId)) fail('already_member', 'Вече членувате в компания. Напуснете я (или предайте собствеността), преди да основете нова.');
    const check = await foundingCheck(tx, userId);
    if (!check.level.ok) fail('founding_level', `Нужно е ниво ${check.level.required}.`);
    if (!check.deliveries.ok) fail('founding_deliveries', `Нужни са поне ${check.deliveries.required} изпълнени доставки.`);
    if (!check.funds.ok) fail('insufficient_funds', 'Нямате достатъчно средства за регистрация на компания.');

    const options = await headquarterOptions(tx);
    if (!options.some((c) => c.id === input.hqCityId)) fail('invalid_hq', 'Изберете град в България за седалище.');
    const [taken] = await tx.select({ id: organizations.id }).from(organizations).where(sql`lower(${organizations.name}) = lower(${input.name})`);
    if (taken) fail('company_name_taken', 'Компания с такова име вече съществува.', 409);

    const [org] = await tx.insert(organizations).values({ ownerId: userId, name: input.name, hqCityId: input.hqCityId }).returning();
    await post(tx, company.id, [{ category: 'company_founding', amountCents: -ECONOMY.foundingFeeCents, description: `Регистрация на „${input.name}“`, idempotencyKey: `founding:${org!.id}` }], { requireFunds: true });
    if (company.kind !== 'company') await tx.update(companies).set({ kind: 'company', hqCityId: input.hqCityId, foundedAt: new Date() }).where(eq(companies.id, company.id));
    await tx.insert(depots).values({ companyId: company.id, cityId: input.hqCityId, slots: ECONOMY.depotSlotsDefault }).onConflictDoNothing();
    await setupCompanyMembership(tx, org!.id, userId);
    await logActivity(tx, userId, 'company_founded', { name: input.name, hqCityId: input.hqCityId });
    await notify(tx, userId, 'achievement', `Основахте „${input.name}“!`, 'Вече можете да купувате и наемате техника, да наемате шофьори и да откривате депа.', '/game/market');
    await checkAchievements(tx, userId, company.id);
    return org!.id;
  });
}

/** Returns a rented vehicle (and its rented trailer) when it is idle. */
export async function returnRental(db: Database, userId: string, vehicleId: string) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, company.id))).for('update');
    if (!v || v.soldAt) fail('vehicle_not_found', 'Превозното средство не е намерено.', 404);
    if (v!.ownership !== 'rented') fail('not_rented', 'Това превозно средство е собствено.');
    if (v!.status !== 'idle') fail('vehicle_busy', 'Не можете да върнете камиона по време на курс.');
    const active = await tx.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.companyId, company.id), sql`${vehicles.soldAt} is null`));
    if (company.kind === 'independent' && active.length <= 1) fail('last_vehicle', 'Без камион не можете да работите. Първо основете компания или купете собствен.');
    await tx.update(drivers).set({ vehicleId: null }).where(eq(drivers.vehicleId, v!.id));
    await tx.update(trailers).set({ vehicleId: null, soldAt: new Date() }).where(and(eq(trailers.vehicleId, v!.id), eq(trailers.ownership, 'rented')));
    await tx.update(vehicles).set({ status: 'returned', soldAt: new Date() }).where(eq(vehicles.id, v!.id));
    await logActivity(tx, userId, 'rental_returned', { vehicleId });
  });
}

/** A company rents an additional vehicle into one of its depots. */
export async function rentVehicle(db: Database, userId: string, offerId: string, depotCityId: number) {
  return db.transaction(async (tx) => {
    const company = await requireFoundedCompany(tx, userId);
    const offer = RENTAL_OFFERS.find((o) => o.id === offerId);
    if (!offer) fail('unknown_offer', 'Непозната оферта за наем.');
    const [user] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
    if ((user?.level ?? 1) < offer!.minLevel) fail('level', `Изисква ниво ${offer!.minLevel}.`);
    const [depot] = await tx.select().from(depots).where(and(eq(depots.companyId, company.id), eq(depots.cityId, depotCityId)));
    if (!depot) fail('no_depot', 'Нямате депо в този град.');
    const { fleetCapacity } = await import('./fleet');
    const cap = await fleetCapacity(tx, company.id);
    if (cap.used >= cap.slots) fail('no_capacity', 'Нямате свободни места в депата.');
    const vehicle = await addRental(tx, company.id, offer!.id, depotCityId);
    await logActivity(tx, userId, 'vehicle_rented', { offerId, vehicleId: vehicle.id });
    return vehicle;
  });
}

export async function userWithCompany(db: DbOrTx, userId: string) {
  const [row] = await db
    .select({ user: users, company: companies, hq: cities })
    .from(users)
    .innerJoin(companies, eq(companies.ownerId, users.id))
    .innerJoin(cities, eq(cities.id, companies.hqCityId))
    .where(eq(users.id, userId));
  if (!row) fail('company_not_found', 'Профилът няма игрови акаунт.', 404);
  return row!;
}
