import { and, asc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { POWER_UNITS, powerUnitModel } from '@/lib/game/catalog';
import { COMPANY_FLEET, fleetLimit } from '@/lib/game/company-fleet';
import type { UpgradeLevels } from '@/lib/game/company';
import { resaleValueCents } from '@/lib/game/economy';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, drivers, orgVehicles, organizations, trailers, users, vehicles } from '@/server/db/schema';
import { fail } from './errors';
import { postTreasury } from './finance';
import { can, membershipOf, notifyMembers, requirePermission } from './membership';
import { uniquePlate } from './names';
import { logActivity } from './notify';
import { t } from '@/i18n/t';

type OrgVehicle = typeof orgVehicles.$inferSelect;

const ageDays = (from: Date, now: Date) => (now.getTime() - from.getTime()) / 86_400_000;

/**
 * The company's own trucks (v1.3): bought from the treasury, they stand on
 * the plot's parking; a member borrows one at a time and drives it like their
 * own (fuel and repairs are theirs), then returns it. The truck keeps its
 * wear and kilometres between borrowers. Vans and rigid trucks only — no
 * trailers to sort out when it changes hands.
 */
export async function orgFleetView(db: DbOrTx, organizationId: string) {
  const [org] = await db.select({ upgrades: organizations.upgrades }).from(organizations).where(eq(organizations.id, organizationId));
  if (!org) return null;
  const noteAuthor = alias(users, 'note_author');
  const rows = await db
    .select({ v: orgVehicles, borrower: users.username, city: cities.nameBg, noteBy: noteAuthor.username })
    .from(orgVehicles)
    .leftJoin(users, eq(users.id, orgVehicles.lentTo))
    .leftJoin(noteAuthor, eq(noteAuthor.id, orgVehicles.noteBy))
    .innerJoin(cities, eq(cities.id, orgVehicles.cityId))
    .where(and(eq(orgVehicles.organizationId, organizationId), isNull(orgVehicles.soldAt)))
    .orderBy(asc(orgVehicles.createdAt));
  return {
    limit: fleetLimit(org.upgrades as UpgradeLevels),
    vehicles: rows.map((r) => ({ id: r.v.id, modelId: r.v.modelId, name: powerUnitModel(r.v.modelId).name, kind: powerUnitModel(r.v.modelId).kind, plate: r.v.plate, city: r.city, condition: r.v.condition, odometerKm: r.v.odometerKm, borrower: r.borrower, lentTo: r.v.lentTo, note: r.v.note ? { text: r.v.note, by: r.noteBy } : null })),
  };
}

/** Buys a truck for the company from the treasury (places: 2 per parking level). */
export async function buyOrgVehicle(db: Database, actorId: string, modelId: string, now = new Date()) {
  const model = POWER_UNITS.find((m) => m.id === modelId);
  if (!model || !COMPANY_FLEET.kinds.includes(model.kind)) fail('unknown_model', t('Компанията купува бусове и камиони без ремарке.'));
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_upgrades');
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, actor.company.id)).for('update');
    const limit = fleetLimit(org!.upgrades as UpgradeLevels);
    if (!limit) fail('no_parking', t('Първо постройте паркинг на участъка.'));
    const have = await tx.select({ id: orgVehicles.id }).from(orgVehicles).where(and(eq(orgVehicles.organizationId, org!.id), isNull(orgVehicles.soldAt)));
    if (have.length >= limit) fail('parking_full', t('Паркингът побира {0} фирмени камиона — вдигнете нивото му.', limit));
    const [row] = await tx.insert(orgVehicles).values({ organizationId: org!.id, modelId: model!.id, plate: await uniquePlate(tx), cityId: org!.hqCityId, createdAt: now }).returning();
    await postTreasury(tx, org!.id, [{ category: 'company_fleet', amountCents: -model!.priceCents, description: t('Фирмен камион: {0} ({1})', model!.name, row!.plate), idempotencyKey: `org-vehicle:${row!.id}:buy`, actorUserId: actorId, refType: 'org_vehicle', refId: row!.id }], { requireFunds: true });
    await notifyMembers(tx, org!.id, null, () => t('Нов фирмен камион'), () => t('{0} ({1}) чака на паркинга — всеки член може да го вземе за курсове.', model!.name, row!.plate), '/game/company/plot');
    await logActivity(tx, actorId, 'org_vehicle_bought', { id: row!.id, modelId });
    return row!;
  });
}

/** Sells a company truck that is in the yard; the money goes back to the treasury. */
export async function sellOrgVehicle(db: Database, actorId: string, orgVehicleId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_upgrades');
    const ov = await lockOrgVehicle(tx, actor.company.id, orgVehicleId);
    if (ov.lentTo) fail('lent', t('Камионът е при член на компанията — първо трябва да го върне.'));
    const value = resaleValueCents(powerUnitModel(ov.modelId).priceCents, ov.condition, ageDays(ov.createdAt, now));
    await tx.update(orgVehicles).set({ soldAt: now }).where(eq(orgVehicles.id, ov.id));
    await postTreasury(tx, actor.company.id, [{ category: 'company_fleet', amountCents: value, description: t('Продаден фирмен камион ({0})', ov.plate), idempotencyKey: `org-vehicle:${ov.id}:sell`, actorUserId: actorId, refType: 'org_vehicle', refId: ov.id }]);
    return value;
  });
}

/** On dissolution: every company truck (all in the yard by now) is sold into the treasury. Returns the sum. */
export async function sellFleetOnDissolve(tx: Tx, organizationId: string, now: Date) {
  const rows = await tx.select().from(orgVehicles).where(and(eq(orgVehicles.organizationId, organizationId), isNull(orgVehicles.soldAt))).for('update');
  let sum = 0;
  for (const ov of rows) {
    const value = resaleValueCents(powerUnitModel(ov.modelId).priceCents, ov.condition, ageDays(ov.createdAt, now));
    await tx.update(orgVehicles).set({ soldAt: now }).where(eq(orgVehicles.id, ov.id));
    await postTreasury(tx, organizationId, [{ category: 'company_fleet', amountCents: value, description: t('Продаден фирмен камион ({0})', ov.plate), idempotencyKey: `org-vehicle:${ov.id}:sell`, refType: 'org_vehicle', refId: ov.id }]);
    sum += value;
  }
  return sum;
}

async function lockOrgVehicle(tx: Tx, organizationId: string, id: string): Promise<OrgVehicle> {
  const [ov] = await tx.select().from(orgVehicles).where(and(eq(orgVehicles.id, id), eq(orgVehicles.organizationId, organizationId), isNull(orgVehicles.soldAt))).for('update');
  if (!ov) fail('not_found', t('Няма такъв фирмен камион.'), 404);
  return ov!;
}

/** A member takes a company truck from the yard: it joins their fleet where it stands. One at a time. */
export async function borrowOrgVehicle(db: Database, userId: string, orgVehicleId: string) {
  return db.transaction(async (tx) => {
    const m = await membershipOf(tx, userId);
    if (!m) fail('not_member', t('Не членувате в компания.'), 403);
    const ov = await lockOrgVehicle(tx, m!.company.id, orgVehicleId);
    if (ov.lentTo) fail('lent', t('Камионът вече е взет от друг член.'));
    const [account] = await tx.select().from(companies).where(eq(companies.ownerId, userId));
    if (!account) fail('company_not_found', t('Профилът няма игрови акаунт.'), 404);
    const [mine] = await tx.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.companyId, account!.id), eq(vehicles.ownership, 'company'), isNull(vehicles.soldAt)));
    if (mine) fail('has_company_truck', t('Вече карате фирмен камион — върнете го, преди да вземете друг.'));
    const [vehicle] = await tx
      .insert(vehicles)
      .values({ companyId: account!.id, modelId: ov.modelId, plate: ov.plate, color: m!.company.liveryColor ?? '#f8fafc', cityId: ov.cityId, ownership: 'company', purchasePriceCents: 0, condition: ov.condition, odometerKm: ov.odometerKm, serviceKm: ov.serviceKm, orgVehicleId: ov.id })
      .returning();
    await tx.update(orgVehicles).set({ lentTo: userId, vehicleId: vehicle!.id }).where(eq(orgVehicles.id, ov.id));
    await logActivity(tx, userId, 'org_vehicle_borrowed', { id: ov.id });
    return vehicle!;
  });
}

/** Gives a borrowed truck back (between trips): its wear, kilometres and city go with it. */
export async function returnCompanyTruck(tx: Tx, vehicleId: string, now: Date) {
  const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.ownership, 'company'), isNull(vehicles.soldAt))).for('update');
  if (!v) fail('vehicle_not_found', t('Превозното средство не е намерено.'), 404);
  if (v!.status !== 'idle') fail('vehicle_busy', t('Камионът е на курс — върнете го след края му.'));
  await tx.update(trailers).set({ vehicleId: null }).where(eq(trailers.vehicleId, v!.id));
  await tx.update(drivers).set({ vehicleId: null }).where(eq(drivers.vehicleId, v!.id));
  await tx.update(drivers).set({ coVehicleId: null }).where(eq(drivers.coVehicleId, v!.id));
  await tx.update(vehicles).set({ status: 'sold', soldAt: now }).where(eq(vehicles.id, v!.id));
  if (v!.orgVehicleId) await tx.update(orgVehicles).set({ lentTo: null, vehicleId: null, cityId: v!.cityId, condition: v!.condition, odometerKm: v!.odometerKm, serviceKm: v!.serviceKm }).where(eq(orgVehicles.id, v!.orgVehicleId));
}

export async function returnOrgVehicle(db: Database, userId: string, vehicleId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [account] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
    const [v] = await tx.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, account?.id ?? '00000000-0000-0000-0000-000000000000')));
    if (!v) fail('vehicle_not_found', t('Превозното средство не е намерено.'), 404);
    await returnCompanyTruck(tx, vehicleId, now);
  });
}

/**
 * A member leaves (or is removed): a borrowed truck between trips goes back at
 * once; one on a trip fails the leave, so it is never lost.
 */
export async function returnOnLeave(tx: Tx, userId: string, now: Date) {
  const rows = await tx
    .select({ id: vehicles.id, status: vehicles.status })
    .from(vehicles)
    .innerJoin(companies, eq(companies.id, vehicles.companyId))
    .where(and(eq(companies.ownerId, userId), eq(vehicles.ownership, 'company'), isNull(vehicles.soldAt)));
  for (const r of rows) {
    if (r.status !== 'idle') fail('company_truck_on_trip', t('Фирменият камион е на курс — върнете го на компанията след края на курса.'));
    await returnCompanyTruck(tx, r.id, now);
  }
}

export const NOTE_MAX = 140;

/**
 * A note on a company truck for the next driver ("the tyres are worn"): by
 * whoever has it now or ranks with "Развитие"; empty clears it.
 */
export async function setOrgVehicleNote(db: Database, userId: string, orgVehicleId: string, raw: string) {
  const note = raw.trim().slice(0, NOTE_MAX);
  return db.transaction(async (tx) => {
    const m = await membershipOf(tx, userId);
    if (!m) fail('not_member', t('Не членувате в компания.'), 403);
    const ov = await lockOrgVehicle(tx, m!.company.id, orgVehicleId);
    if (ov.lentTo !== userId && !can(m!.rank, 'manage_upgrades')) fail('forbidden', t('Бележка оставя шофьорът, който кара камиона, или длъжност с право „Развитие“.'), 403);
    await tx.update(orgVehicles).set({ note: note || null, noteBy: note ? userId : null }).where(eq(orgVehicles.id, ov.id));
  });
}
