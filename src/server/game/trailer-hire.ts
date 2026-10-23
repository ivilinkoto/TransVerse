import { and, asc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { money } from '@/lib/format';
import { trailerModel } from '@/lib/game/catalog';
import { TRAILER_HIRE } from '@/lib/game/trailer-hire';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, trailerHires, trailers, users, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';

async function gate(db: DbOrTx, userId: string, now: Date) {
  if (!(await featureFor(db, userId, 'trailer_hire', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
}

/** The owner offers an idle own trailer for hire (it stays parked and cannot be used meanwhile). */
export async function offerTrailer(db: Database, userId: string, input: { trailerId: string; pricePerDayCents: number; maxDays: number }, now = new Date()) {
  await gate(db, userId, now);
  if (!Number.isSafeInteger(input.pricePerDayCents) || input.pricePerDayCents < TRAILER_HIRE.minPricePerDayCents || input.pricePerDayCents > TRAILER_HIRE.maxPricePerDayCents) fail('price', `Цената е от ${money(TRAILER_HIRE.minPricePerDayCents)} до ${money(TRAILER_HIRE.maxPricePerDayCents)} на ден.`);
  const maxDays = Math.max(1, Math.min(TRAILER_HIRE.maxDays, Math.floor(input.maxDays)));
  return db.transaction(async (tx) => {
    const account = await companyForUser(tx, userId);
    const [t] = await tx.select().from(trailers).where(and(eq(trailers.id, input.trailerId), eq(trailers.companyId, account.id), isNull(trailers.soldAt))).for('update');
    if (!t) fail('trailer_not_found', 'Ремаркето не е намерено.', 404);
    if (t!.ownership !== 'owned') fail('rented', 'Само собствено ремарке.');
    if (t!.listed) fail('listed', 'Ремаркето е обявено на пазара.');
    if (t!.hiredOut) fail('hired_out', 'Ремаркето вече е предложено под наем.');
    if (t!.vehicleId) {
      const [v] = await tx.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, t!.vehicleId));
      if (v?.status === 'on_delivery') fail('trailer_busy', 'Ремаркето е на курс.');
    }
    await tx.update(trailers).set({ hiredOut: true, vehicleId: null }).where(eq(trailers.id, t!.id));
    const [row] = await tx.insert(trailerHires).values({ trailerId: t!.id, ownerId: userId, pricePerDayCents: input.pricePerDayCents, maxDays, createdAt: now }).returning();
    return row!;
  });
}

/** The owner takes an offer back (only while nobody hires the trailer). */
export async function withdrawTrailer(db: Database, userId: string, hireId: string) {
  return db.transaction(async (tx) => {
    const [h] = await tx.select().from(trailerHires).where(and(eq(trailerHires.id, hireId), eq(trailerHires.ownerId, userId), isNull(trailerHires.endedAt))).for('update');
    if (!h) fail('not_found', 'Обявата я няма.', 404);
    if (h!.renterId) fail('hired', 'Ремаркето е наето — връща се след края на наема.');
    await tx.update(trailerHires).set({ endedAt: new Date() }).where(eq(trailerHires.id, h!.id));
    await tx.update(trailers).set({ hiredOut: false }).where(eq(trailers.id, h!.trailerId));
    return { withdrawn: true };
  });
}

/** Another player hires the trailer for some days: pays the owner up front and gets the trailer where it stands. */
export async function hireTrailer(db: Database, userId: string, hireId: string, days: number, now = new Date()) {
  await gate(db, userId, now);
  return db.transaction(async (tx) => {
    const [h] = await tx.select().from(trailerHires).where(and(eq(trailerHires.id, hireId), isNull(trailerHires.endedAt))).for('update');
    if (!h || h.renterId) fail('taken', 'Ремаркето вече е наето.', 409);
    if (h!.ownerId === userId) fail('own', 'Това е твоето ремарке.');
    const d = Math.floor(days);
    if (d < 1 || d > h!.maxDays) fail('days', `Наемът е от 1 до ${h!.maxDays} дни.`);
    const [t] = await tx.select().from(trailers).where(eq(trailers.id, h!.trailerId)).for('update');
    const renter = await companyForUser(tx, userId);
    const owner = await companyForUser(tx, h!.ownerId);
    const cost = h!.pricePerDayCents * d;
    const label = `${trailerModel(t!.modelId).name} (${t!.plate}), ${d} ${d === 1 ? 'ден' : 'дни'}`;
    // Both personal accounts, locked in a fixed order.
    for (const id of [renter.id, owner.id].sort()) await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, id)).for('update');
    await post(tx, renter.id, [{ category: 'trailer_hire', amountCents: -cost, description: `Наем на ремарке: ${label}`, idempotencyKey: `trailer-hire:${h!.id}:pay`, refType: 'trailer', refId: t!.id }], { requireFunds: true });
    await post(tx, owner.id, [{ category: 'trailer_hire', amountCents: cost, description: `Отдадено ремарке: ${label}`, idempotencyKey: `trailer-hire:${h!.id}:earn`, refType: 'trailer', refId: t!.id }]);
    const [copy] = await tx
      .insert(trailers)
      .values({ companyId: renter.id, modelId: t!.modelId, plate: t!.plate, cityId: t!.cityId, condition: t!.condition, ownership: 'hired', purchasePriceCents: 0, upgrades: t!.upgrades, logo: t!.logo, cosmetics: t!.cosmetics, hireId: h!.id })
      .returning();
    const until = new Date(now.getTime() + d * 86_400_000);
    await tx.update(trailerHires).set({ renterId: userId, hiredTrailerId: copy!.id, days: d, startedAt: now, until }).where(eq(trailerHires.id, h!.id));
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    await notify(tx, h!.ownerId, 'success', 'Ремаркето ти е наето', `${me!.username} нае ${label} — ${money(cost)}.`, '/game/trailer-hire');
    return { trailerId: copy!.id, cost, until };
  });
}

/** Gives a hired trailer back to its owner (not on a trip): wear and place go with it. */
async function giveBack(tx: Tx, hireId: string, now: Date) {
  const [h] = await tx.select().from(trailerHires).where(and(eq(trailerHires.id, hireId), isNull(trailerHires.endedAt))).for('update');
  if (!h || !h.hiredTrailerId) return false;
  const [copy] = await tx.select().from(trailers).where(eq(trailers.id, h.hiredTrailerId)).for('update');
  if (copy?.vehicleId) {
    const [v] = await tx.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, copy.vehicleId));
    if (v?.status === 'on_delivery') return false;
  }
  if (copy) await tx.update(trailers).set({ vehicleId: null, soldAt: now }).where(eq(trailers.id, copy.id));
  await tx.update(trailers).set({ hiredOut: false, ...(copy ? { cityId: copy.cityId, condition: copy.condition } : {}) }).where(eq(trailers.id, h.trailerId));
  await tx.update(trailerHires).set({ endedAt: now }).where(eq(trailerHires.id, h.id));
  await notify(tx, h.ownerId, 'info', 'Ремаркето ти се върна', 'Наемът свърши — ремаркето е отново твое, там където е спряло.', '/game/garage');
  if (h.renterId) await notify(tx, h.renterId, 'info', 'Наетото ремарке е върнато', 'Наемът свърши.', '/game/garage');
  return true;
}

/** The renter gives the trailer back early (no refund). */
export async function returnHiredTrailer(db: Database, userId: string, hireId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [h] = await tx.select({ renterId: trailerHires.renterId }).from(trailerHires).where(eq(trailerHires.id, hireId));
    if (!h || h.renterId !== userId) fail('not_found', 'Наемът не е намерен.', 404);
    if (!(await giveBack(tx, hireId, now))) fail('trailer_busy', 'Ремаркето е на курс — върни го след края му.');
    return { returned: true };
  });
}

/** Worker: hires that ended go back (those on a trip after the trip). */
export async function endTrailerHires(db: Database, now = new Date()) {
  const due = await db.select({ id: trailerHires.id }).from(trailerHires).where(and(isNull(trailerHires.endedAt), isNotNull(trailerHires.renterId), lte(trailerHires.until, now)));
  let n = 0;
  for (const h of due) if (await db.transaction((tx) => giveBack(tx, h.id, now))) n++;
  return n;
}

/** Offers open to hire, and the player's own offers and hires. */
export async function trailerHireView(db: DbOrTx, userId: string) {
  const rows = await db
    .select({ id: trailerHires.id, ownerId: trailerHires.ownerId, owner: users.username, pricePerDayCents: trailerHires.pricePerDayCents, maxDays: trailerHires.maxDays, renterId: trailerHires.renterId, until: trailerHires.until, modelId: trailers.modelId, plate: trailers.plate, condition: trailers.condition, city: cities.nameBg })
    .from(trailerHires)
    .innerJoin(trailers, eq(trailers.id, trailerHires.trailerId))
    .innerJoin(users, eq(users.id, trailerHires.ownerId))
    .innerJoin(cities, eq(cities.id, trailers.cityId))
    .where(isNull(trailerHires.endedAt))
    .orderBy(asc(trailerHires.pricePerDayCents));
  const out = rows.map((r) => ({ ...r, model: trailerModel(r.modelId).name }));
  return {
    offers: out.filter((r) => !r.renterId && r.ownerId !== userId),
    mine: out.filter((r) => r.ownerId === userId),
    hired: out.filter((r) => r.renterId === userId),
  };
}

