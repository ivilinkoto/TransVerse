import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { AUCTION_RULES, floorBidCents, maxBidCents, SPECIAL_LOADS } from '@/lib/game/auctions';
import { CARGO, canCarry, type CargoType } from '@/lib/game/cargo';
import { combinationCapability, powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { rewardCents } from '@/lib/game/economy';
import { contractWindowMinutes } from '@/lib/game/schedule';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { auctionBids, cities, companies, contracts, routes, specialAuctions, trailers, users, vehicles } from '@/server/db/schema';
import { getRoute } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { loadHubs } from './contracts';
import { fail } from './errors';
import { heldLicences, missingFor } from './licences';
import { broadcast, notify } from './notify';
import { pick, pickWeighted, rand } from './random';

type Auction = typeof specialAuctions.$inferSelect;

const sofia = (now: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
};

/** Worker: opens the auction of the current slot (once), at the set hours. */
export async function ensureAuction(db: Database, now = new Date(), provider?: RoutingProvider) {
  const t = sofia(now);
  if (!(AUCTION_RULES.hours as readonly number[]).includes(t.hour) || t.minute >= AUCTION_RULES.minutes - 2) return null;
  const slot = `${t.date}T${String(t.hour).padStart(2, '0')}`;
  const [exists] = await db.select({ id: specialAuctions.id }).from(specialAuctions).where(eq(specialAuctions.slot, slot));
  if (exists) return null;
  return openAuction(db, slot, now, new Date(now.getTime() + (AUCTION_RULES.minutes - t.minute) * 60_000), provider);
}

/** Opens an auction for a slot (the load and the lane are picked at random). */
export async function openAuction(db: Database, slot: string, now: Date, endsAt: Date, provider?: RoutingProvider, loadId?: string) {
  const load = SPECIAL_LOADS.find((l) => l.id === loadId) ?? pick(SPECIAL_LOADS);
  const hubs = await loadHubs(db);
  const origin = pickWeighted(hubs, (h) => Math.sqrt(h.population));
  if (!origin) return null;
  const destination = pickWeighted(hubs, (h) => {
    const km = haversineKm([origin.lat, origin.lon], [h.lat, h.lon]) * 1.25;
    return km < 200 || km > 1200 ? 0 : Math.sqrt(h.population);
  });
  if (!destination) return null;
  const route = await getRoute(db, origin.id, destination.id, 'truck', provider);
  const tons = Math.round((load.tons[0] + rand() * (load.tons[1] - load.tons[0])) * 10) / 10;
  const [row] = await db
    .insert(specialAuctions)
    .values({
      slot,
      loadId: load.id,
      title: load.title,
      goods: load.goods,
      cargoType: load.cargo,
      weightTons: tons,
      originCityId: origin.id,
      destCityId: destination.id,
      routeId: route.id,
      distanceKm: route.distanceKm,
      startPriceCents: Math.round(rewardCents(load.cargo, tons, route.distanceKm, AUCTION_RULES.startMultiplier) / 100) * 100,
      coins: load.coins,
      startsAt: now,
      endsAt,
    })
    .onConflictDoNothing()
    .returning();
  if (row) await broadcast(db, 'market');
  return row ?? null;
}

/** Whether the player has some truck (busy or not) and the licences for this load. */
async function canHaul(db: DbOrTx, userId: string, companyId: string, a: Auction) {
  const [u] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  if ((u?.level ?? 1) < CARGO[a.cargoType as CargoType].minLevel) return `Изисква ниво ${CARGO[a.cargoType as CargoType].minLevel}.`;
  const vs = await db.select({ id: vehicles.id, modelId: vehicles.modelId }).from(vehicles).where(and(eq(vehicles.companyId, companyId), isNull(vehicles.soldAt)));
  const ts = vs.length ? await db.select({ vehicleId: trailers.vehicleId, modelId: trailers.modelId }).from(trailers).where(inArray(trailers.vehicleId, vs.map((v) => v.id))) : [];
  const fits = vs.some((v) => {
    const t = ts.find((x) => x.vehicleId === v.id);
    const cap = combinationCapability({ unit: powerUnitModel(v.modelId), trailer: t ? trailerModel(t.modelId) : null });
    return canCarry(cap.bodies, a.cargoType as CargoType) && cap.payloadTons >= a.weightTons;
  });
  if (!fits) return `Нужен е камион за „${CARGO[a.cargoType as CargoType].label}“ с поне ${a.weightTons} т.`;
  const [route] = await db.select({ countries: routes.countries }).from(routes).where(eq(routes.id, a.routeId));
  const ends = await db.select({ id: cities.id, country: cities.countryCode }).from(cities).where(inArray(cities.id, [a.originCityId, a.destCityId]));
  const country = (id: number) => ends.find((c) => c.id === id)!.country;
  const missing = missingFor({ cargoType: a.cargoType, originCountry: country(a.originCityId), destCountry: country(a.destCityId), routeCountries: route?.countries ?? [] }, await heldLicences(db, userId));
  if (missing.length) return 'Нямаш нужните лицензи за този маршрут.';
  return null;
}

/** A bid: the lowest price the player will haul the load for. A bid in the last minute adds a minute. */
export async function bidAuction(db: Database, userId: string, auctionId: string, amountCents: number, now = new Date()) {
  const company = await companyForUser(db, userId);
  const [pre] = await db.select().from(specialAuctions).where(eq(specialAuctions.id, auctionId));
  if (!pre || pre.status !== 'open' || pre.endsAt <= now) fail('auction_closed', 'Търгът е приключил.', 409);
  const why = await canHaul(db, userId, company.id, pre!);
  if (why) fail('cannot_haul', why);
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(specialAuctions).where(eq(specialAuctions.id, auctionId)).for('update');
    if (!a || a.status !== 'open' || a.endsAt <= now) fail('auction_closed', 'Търгът е приключил.', 409);
    const [lowest] = await tx.select({ amount: auctionBids.amountCents }).from(auctionBids).where(eq(auctionBids.auctionId, a!.id)).orderBy(asc(auctionBids.amountCents)).limit(1);
    const max = maxBidCents(a!.startPriceCents, lowest?.amount ?? null);
    const floor = floorBidCents(a!.startPriceCents);
    const amount = Math.round(amountCents / 100) * 100;
    if (amount > max) fail('bid_too_high', `Офертата трябва да е най-много ${(max / 100).toLocaleString('bg-BG')} лв..`);
    if (amount < floor) fail('bid_too_low', `Най-ниската допустима оферта е ${(floor / 100).toLocaleString('bg-BG')} лв..`);
    await tx
      .insert(auctionBids)
      .values({ auctionId: a!.id, companyId: company.id, userId, amountCents: amount, updatedAt: now })
      .onConflictDoUpdate({ target: [auctionBids.auctionId, auctionBids.companyId], set: { amountCents: amount, updatedAt: now } });
    if (a!.endsAt.getTime() - now.getTime() < AUCTION_RULES.extendMs && a!.extensions < AUCTION_RULES.maxExtensions) {
      await tx.update(specialAuctions).set({ endsAt: new Date(a!.endsAt.getTime() + AUCTION_RULES.extendMs), extensions: a!.extensions + 1 }).where(eq(specialAuctions.id, a!.id));
    }
    await broadcast(tx, 'market');
    return { amountCents: amount };
  });
}

/** Worker: closes finished auctions (the lowest bid gets a private job) and forfeits jobs nobody sent in time. */
export async function settleAuctions(db: Database, now = new Date()): Promise<number> {
  let n = 0;
  const due = await db.select().from(specialAuctions).where(and(eq(specialAuctions.status, 'open'), lte(specialAuctions.endsAt, now))).limit(20);
  for (const a of due) {
    n += await db.transaction(async (tx) => {
      const [row] = await tx.select().from(specialAuctions).where(and(eq(specialAuctions.id, a.id), eq(specialAuctions.status, 'open'))).for('update');
      if (!row) return 0;
      const bids = await tx.select().from(auctionBids).where(eq(auctionBids.auctionId, row.id)).orderBy(asc(auctionBids.amountCents), asc(auctionBids.updatedAt));
      const win = bids[0];
      if (!win) {
        await tx.update(specialAuctions).set({ status: 'no_bids' }).where(eq(specialAuctions.id, row.id));
        return 1;
      }
      const [c] = await tx
        .insert(contracts)
        .values({
          shipper: 'Търг за специален товар',
          goods: row.goods,
          cargoType: row.cargoType,
          weightTons: row.weightTons,
          originCityId: row.originCityId,
          destCityId: row.destCityId,
          routeId: row.routeId,
          distanceKm: row.distanceKm,
          rewardCents: win.amountCents,
          windowMinutes: contractWindowMinutes(row.distanceKm),
          minLevel: CARGO[row.cargoType as CargoType].minLevel,
          status: 'trade',
          tradeCompanyId: win.companyId,
          auctionId: row.id,
          expiresAt: new Date(now.getTime() + AUCTION_RULES.sendHours * 3_600_000),
        })
        .returning({ id: contracts.id });
      await tx.update(specialAuctions).set({ status: 'awarded', winnerCompanyId: win.companyId, winningBidCents: win.amountCents, contractId: c!.id }).where(eq(specialAuctions.id, row.id));
      const eur = (x: number) => `${Math.round(x / 100).toLocaleString('bg-BG')} лв.`;
      await notify(tx, win.userId, 'achievement', `Спечели търга: ${row.title}`, `${eur(win.amountCents)} + ${row.coins} TC при доставка. Изпрати камион до ${AUCTION_RULES.sendHours} часа (Поръчки → Търгове).`, '/game/auctions');
      for (const b of bids.slice(1)) await notify(tx, b.userId, 'info', `Търгът „${row.title}“ приключи`, `Спечели оферта от ${eur(win.amountCents)}. Твоята беше ${eur(b.amountCents)}.`, '/game/auctions');
      return 1;
    });
  }
  // Won but never sent: the job is lost and the client remembers it.
  const lapsed = await db
    .select({ a: specialAuctions, c: { id: contracts.id, status: contracts.status, expiresAt: contracts.expiresAt } })
    .from(specialAuctions)
    .innerJoin(contracts, eq(contracts.id, specialAuctions.contractId))
    .where(and(eq(specialAuctions.status, 'awarded'), eq(contracts.status, 'trade'), lte(contracts.expiresAt, now)))
    .limit(20);
  for (const { a } of lapsed) {
    await db.transaction(async (tx) => {
      const rows = await tx.update(contracts).set({ status: 'expired' }).where(and(eq(contracts.id, a.contractId!), eq(contracts.status, 'trade'))).returning({ id: contracts.id });
      if (!rows.length) return;
      await tx.update(specialAuctions).set({ status: 'forfeited' }).where(eq(specialAuctions.id, a.id));
      const [acct] = await tx.update(companies).set({ reputation: sql`greatest(0, ${companies.reputation} - ${AUCTION_RULES.forfeitReputation})` }).where(eq(companies.id, a.winnerCompanyId!)).returning({ ownerId: companies.ownerId });
      if (acct) await notify(tx, acct.ownerId, 'warning', `Изпусна специалния товар „${a.title}“`, `Не изпрати камион навреме. −${AUCTION_RULES.forfeitReputation} репутация.`, '/game/auctions');
      n++;
    });
  }
  return n;
}

/** The special load arrived (called from the settlement): its ТрансКоин. */
export async function deliverAuctionLoad(tx: Tx, auctionId: string, ownerId: string) {
  const [a] = await tx.update(specialAuctions).set({ status: 'delivered' }).where(and(eq(specialAuctions.id, auctionId), eq(specialAuctions.status, 'awarded'))).returning();
  if (!a) return;
  await postCoins(tx, ownerId, { amount: a.coins, reason: 'auction_reward', description: `Специален товар: ${a.title}`, idempotencyKey: `auction:${a.id}:coins` });
}

/** What the auctions page shows: running auctions with the lowest bid, the player's won jobs, recent results. */
export async function auctionsBoard(db: DbOrTx, companyId: string, now: Date) {
  const open = await db.select().from(specialAuctions).where(and(eq(specialAuctions.status, 'open'), gt(specialAuctions.endsAt, now))).orderBy(asc(specialAuctions.endsAt));
  const won = await db
    .select({ a: specialAuctions, c: { id: contracts.id, status: contracts.status, expiresAt: contracts.expiresAt } })
    .from(specialAuctions)
    .innerJoin(contracts, eq(contracts.id, specialAuctions.contractId))
    .where(and(eq(specialAuctions.winnerCompanyId, companyId), eq(specialAuctions.status, 'awarded'), eq(contracts.status, 'trade'), gt(contracts.expiresAt, now)));
  const recent = await db.select().from(specialAuctions).where(inArray(specialAuctions.status, ['awarded', 'delivered', 'forfeited', 'no_bids'])).orderBy(desc(specialAuctions.endsAt)).limit(8);
  const ids = [...open, ...recent].map((a) => a.id);
  const bids = ids.length
    ? await db.select({ auctionId: auctionBids.auctionId, companyId: auctionBids.companyId, amount: auctionBids.amountCents, username: users.username }).from(auctionBids).innerJoin(users, eq(users.id, auctionBids.userId)).where(inArray(auctionBids.auctionId, ids)).orderBy(asc(auctionBids.amountCents))
    : [];
  const cityIds = [...new Set([...open, ...recent, ...won.map((w) => w.a)].flatMap((a) => [a.originCityId, a.destCityId]))];
  const cityRows = cityIds.length ? await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, cityIds)) : [];
  const city = (id: number) => cityRows.find((c) => c.id === id)?.nameBg ?? '—';
  const view = (a: Auction) => {
    const mine = bids.filter((b) => b.auctionId === a.id);
    return { ...a, from: city(a.originCityId), to: city(a.destCityId), bids: mine.length, lowest: mine[0] ?? null, myBid: mine.find((b) => b.companyId === companyId)?.amount ?? null };
  };
  return { open: open.map(view), won: won.map((w) => ({ ...view(w.a), contract: w.c })), recent: recent.map(view) };
}
