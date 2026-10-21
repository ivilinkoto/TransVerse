import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { assertNotLeased } from './leasing';
import { powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { USED_MARKET, marketFeeCents, usedPriceBounds } from '@/lib/game/used-market';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, drivers, trailers, users, vehicleListings, vehicles } from '@/server/db/schema';
import { announceListing } from '@/server/discord/announce';
import { companyForUser } from './company';
import { fail } from './errors';
import { post, type Posting } from './finance';
import { fleetCapacity } from './fleet';
import { broadcast, logActivity, notify } from './notify';
import { checkAchievements } from './progression';
import { retireRentalFor } from './rentals';

const ageDays = (d: Date, now: Date) => (now.getTime() - d.getTime()) / 86_400_000;

/** Price limits for one of the player's own vehicles or trailers (for the listing form). */
export function boundsFor(kind: 'vehicle' | 'trailer', row: { modelId: string; condition: number; purchasedAt: Date }, now = new Date()) {
  const price = kind === 'vehicle' ? powerUnitModel(row.modelId).priceCents : trailerModel(row.modelId).priceCents;
  return usedPriceBounds(price, row.condition, ageDays(row.purchasedAt, now));
}

/** Puts an own, idle vehicle or trailer on the market. It cannot drive or be coupled until sold or withdrawn. */
export async function createListing(db: Database, userId: string, input: { kind: 'vehicle' | 'trailer'; id: string; priceCents: number }, now = new Date()) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [{ open = 0 } = {}] = await tx.select({ open: sql<number>`count(*)::int` }).from(vehicleListings).where(and(eq(vehicleListings.sellerCompanyId, company.id), eq(vehicleListings.status, 'open')));
    if (open >= USED_MARKET.maxOpenListings) fail('too_many_listings', `Можеш да имаш до ${USED_MARKET.maxOpenListings} активни обяви.`);
    let row: { modelId: string; condition: number; purchasedAt: Date; cityId: number; plate: string };
    if (input.kind === 'vehicle') {
      const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, input.id), eq(vehicles.companyId, company.id), sql`${vehicles.soldAt} is null`)).for('update');
      if (!v) fail('vehicle_not_found', 'Превозното средство не е намерено.', 404);
      if (v!.ownership !== 'owned') fail('rented', 'Наетите и фирмените превозни средства не могат да се продават.');
      if (v!.status !== 'idle') fail('vehicle_busy', 'Обява се пуска само за свободно превозно средство.');
      await assertNotLeased(tx, v!.id);
      await tx.update(trailers).set({ vehicleId: null }).where(eq(trailers.vehicleId, v!.id));
      await tx.update(vehicles).set({ status: 'listed' }).where(eq(vehicles.id, v!.id));
      row = v!;
    } else {
      const [t] = await tx.select().from(trailers).where(and(eq(trailers.id, input.id), eq(trailers.companyId, company.id), sql`${trailers.soldAt} is null`)).for('update');
      if (!t) fail('trailer_not_found', 'Ремаркето не е намерено.', 404);
      if (t!.ownership === 'rented') fail('rented', 'Наетите ремаркета не могат да се продават.');
      if (t!.listed) fail('already_listed', 'Ремаркето вече е обявено.');
      if (t!.vehicleId) {
        const [v] = await tx.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, t!.vehicleId));
        if (v?.status === 'on_delivery') fail('trailer_busy', 'Ремаркето е на курс.');
      }
      await tx.update(trailers).set({ vehicleId: null, listed: true }).where(eq(trailers.id, t!.id));
      row = t!;
    }
    const bounds = boundsFor(input.kind, row, now);
    if (input.priceCents < bounds.min || input.priceCents > bounds.max) fail('bad_price', `Цената трябва да е между ${(bounds.min / 100).toLocaleString('bg-BG')} лв. и ${(bounds.max / 100).toLocaleString('bg-BG')} лв.`);
    const [listing] = await tx
      .insert(vehicleListings)
      .values({
        sellerCompanyId: company.id,
        kind: input.kind,
        vehicleId: input.kind === 'vehicle' ? input.id : null,
        trailerId: input.kind === 'trailer' ? input.id : null,
        modelId: row.modelId,
        priceCents: input.priceCents,
        cityId: row.cityId,
        expiresAt: new Date(now.getTime() + USED_MARKET.listingDays * 86_400_000),
      })
      .returning();
    await logActivity(tx, userId, 'listing_created', { listingId: listing!.id, kind: input.kind, priceCents: input.priceCents });
    // #пазар-камиони in Discord, with "Купи".
    const [city] = await tx.select({ nameBg: cities.nameBg }).from(cities).where(eq(cities.id, row.cityId));
    const [seller] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    await announceListing(tx, listing!, { city: city?.nameBg ?? '', condition: row.condition, seller: seller?.username ?? '' }, now);
    await broadcast(tx, 'market');
    return listing!;
  });
}

/** Back to the fleet: the vehicle can drive again, the trailer can be coupled. */
async function release(tx: Tx, listing: typeof vehicleListings.$inferSelect, status: 'cancelled' | 'expired', now: Date) {
  await tx.update(vehicleListings).set({ status, closedAt: now }).where(eq(vehicleListings.id, listing.id));
  if (listing.vehicleId) await tx.update(vehicles).set({ status: 'idle' }).where(and(eq(vehicles.id, listing.vehicleId), eq(vehicles.status, 'listed')));
  if (listing.trailerId) await tx.update(trailers).set({ listed: false }).where(eq(trailers.id, listing.trailerId));
}

export async function cancelListing(db: Database, userId: string, listingId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [listing] = await tx.select().from(vehicleListings).where(and(eq(vehicleListings.id, listingId), eq(vehicleListings.sellerCompanyId, company.id))).for('update');
    if (!listing || listing.status !== 'open') fail('listing_unavailable', 'Обявата вече не е активна.', 409);
    await release(tx, listing!, 'cancelled', now);
    await broadcast(tx, 'market');
  });
}

/** Buys a listing: money from buyer to seller (minus the commission), the vehicle or trailer changes owner where it stands. */
export async function buyListing(db: Database, userId: string, listingId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const buyer = await companyForUser(tx, userId);
    const [listing] = await tx.select().from(vehicleListings).where(eq(vehicleListings.id, listingId)).for('update');
    if (!listing || listing.status !== 'open' || listing.expiresAt <= now) fail('listing_unavailable', 'Обявата вече не е активна.', 409);
    if (listing!.sellerCompanyId === buyer.id) fail('own_listing', 'Това е твоя обява.');
    const [me] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
    const model = listing!.kind === 'vehicle' ? powerUnitModel(listing!.modelId) : trailerModel(listing!.modelId);
    if ((me?.level ?? 1) < model.minLevel) fail('level', `Изисква ниво ${model.minLevel}.`);
    if (listing!.kind === 'vehicle') {
      const cap = await fleetCapacity(tx, buyer.id);
      if (cap.used >= cap.slots) fail('no_capacity', 'Нямаш свободно място в депата. Разшири депо или открий ново.');
    }
    const [seller] = await tx.select().from(companies).where(eq(companies.id, listing!.sellerCompanyId));
    const fee = marketFeeCents(listing!.priceCents);
    const [city] = await tx.select({ nameBg: cities.nameBg }).from(cities).where(eq(cities.id, listing!.cityId));
    const key = (k: string) => `used:${listing!.id}:${k}`;
    const buy: Posting[] = [{ category: 'vehicle_purchase', amountCents: -listing!.priceCents, description: `Употребяван ${model.name} (${city?.nameBg ?? ''})`, idempotencyKey: key('buyer'), refType: 'listing', refId: listing!.id }];
    const sell: Posting[] = [
      { category: 'vehicle_sale', amountCents: listing!.priceCents, description: `Продаден на пазара: ${model.name}`, idempotencyKey: key('seller'), refType: 'listing', refId: listing!.id },
      { category: 'market_fee', amountCents: -fee, description: 'Такса на пазара (5%)', idempotencyKey: key('fee'), refType: 'listing', refId: listing!.id },
    ];
    // Lock both accounts in a fixed order so two crossing purchases cannot deadlock.
    if (buyer.id < seller!.id) {
      await post(tx, buyer.id, buy, { requireFunds: true });
      await post(tx, seller!.id, sell);
    } else {
      await post(tx, seller!.id, sell);
      await post(tx, buyer.id, buy, { requireFunds: true });
    }
    if (listing!.vehicleId) {
      await tx.update(drivers).set({ vehicleId: null }).where(eq(drivers.vehicleId, listing!.vehicleId));
      await tx.update(drivers).set({ coVehicleId: null }).where(eq(drivers.coVehicleId, listing!.vehicleId));
      await tx.update(trailers).set({ vehicleId: null }).where(eq(trailers.vehicleId, listing!.vehicleId));
      await tx.update(vehicles).set({ companyId: buyer.id, status: 'idle', purchasePriceCents: listing!.priceCents }).where(eq(vehicles.id, listing!.vehicleId));
      await retireRentalFor(tx, buyer.id, listing!.vehicleId);
    } else if (listing!.trailerId) {
      await tx.update(trailers).set({ companyId: buyer.id, listed: false, vehicleId: null, purchasePriceCents: listing!.priceCents }).where(eq(trailers.id, listing!.trailerId));
    }
    await tx.update(vehicleListings).set({ status: 'sold', buyerCompanyId: buyer.id, closedAt: now }).where(eq(vehicleListings.id, listing!.id));
    await notify(tx, seller!.ownerId, 'success', `Продадено: ${model.name}`, `Получи ${((listing!.priceCents - fee) / 100).toLocaleString('bg-BG')} лв. след таксата на пазара.`, '/game/finance');
    await logActivity(tx, userId, 'listing_bought', { listingId: listing!.id });
    await checkAchievements(tx, userId, buyer.id);
    await broadcast(tx, 'market');
    return listing!;
  });
}

/** Worker: listings past their time go back to their owners. */
export async function expireListings(db: Database, now = new Date()): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx.select().from(vehicleListings).where(and(eq(vehicleListings.status, 'open'), lte(vehicleListings.expiresAt, now))).for('update', { skipLocked: true });
    for (const l of due) {
      await release(tx, l, 'expired', now);
      const [seller] = await tx.select({ ownerId: companies.ownerId }).from(companies).where(eq(companies.id, l.sellerCompanyId));
      if (seller) await notify(tx, seller.ownerId, 'info', 'Обявата изтече', 'Никой не купи техниката за 7 дни — тя е отново в автопарка ти. Можеш да я обявиш пак.', '/game/fleet');
    }
    return due.length;
  });
}

export type UsedSort = 'new' | 'cheap' | 'condition';

/** Open listings with what the buyer needs to decide: model, condition, mileage, place and seller. */
export async function openListings(db: DbOrTx, opts: { sort?: UsedSort; kind?: 'vehicle' | 'trailer'; limit?: number } = {}) {
  const order = opts.sort === 'cheap' ? vehicleListings.priceCents : desc(vehicleListings.createdAt);
  const rows = await db
    .select({ listing: vehicleListings, city: { nameBg: cities.nameBg, countryCode: cities.countryCode }, seller: users.username })
    .from(vehicleListings)
    .innerJoin(cities, eq(cities.id, vehicleListings.cityId))
    .innerJoin(companies, eq(companies.id, vehicleListings.sellerCompanyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(vehicleListings.status, 'open'), opts.kind ? eq(vehicleListings.kind, opts.kind) : undefined, sql`${vehicleListings.expiresAt} > now()`))
    .orderBy(order)
    .limit(opts.limit ?? 60);
  const vIds = rows.map((r) => r.listing.vehicleId).filter((x): x is string => !!x);
  const tIds = rows.map((r) => r.listing.trailerId).filter((x): x is string => !!x);
  const vRows = vIds.length ? await db.select().from(vehicles).where(inArray(vehicles.id, vIds)) : [];
  const tRows = tIds.length ? await db.select().from(trailers).where(inArray(trailers.id, tIds)) : [];
  const out = rows.map((r) => {
    const v = vRows.find((x) => x.id === r.listing.vehicleId);
    const t = tRows.find((x) => x.id === r.listing.trailerId);
    const item = v ?? t!;
    return {
      ...r.listing,
      city: r.city,
      seller: r.seller,
      plate: item.plate,
      color: v?.color ?? null,
      condition: item.condition,
      odometerKm: v?.odometerKm ?? null,
      upgrades: v?.upgrades ?? [],
      purchasedAt: item.purchasedAt,
      newPriceCents: r.listing.kind === 'vehicle' ? powerUnitModel(r.listing.modelId).priceCents : trailerModel(r.listing.modelId).priceCents,
    };
  });
  return opts.sort === 'condition' ? out.sort((a, b) => b.condition - a.condition) : out;
}

/** The player's own open listings. */
export async function myListings(db: DbOrTx, companyId: string) {
  return db.select().from(vehicleListings).where(and(eq(vehicleListings.sellerCompanyId, companyId), eq(vehicleListings.status, 'open'))).orderBy(desc(vehicleListings.createdAt));
}
