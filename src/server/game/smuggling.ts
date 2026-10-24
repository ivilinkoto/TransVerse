import { and, desc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm';
import { CARGO } from '@/lib/game/cargo';
import { combinationCapability, powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { repairCostCents, rewardCents } from '@/lib/game/economy';
import { featureLive } from '@/lib/game/features';
import { contractWindowMinutes } from '@/lib/game/schedule';
import {
  borderCheckChance, clampHeat, companyShade, contactLevel, fineCents, isEvening, runCatchChance, SHADY_GOODS, SMUGGLING, tierMultiplier, undergroundTier,
} from '@/lib/game/smuggling';
import { sofiaDate, sofiaHourOf } from '@/lib/game/together';
import { haversineKm } from '@/lib/geo/geometry';
import { money } from '@/lib/format';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, companyMembers, contracts, roadReports, routes, smugglingChecks, smugglingContacts, smugglingProfiles, trailers, users, vehicles } from '@/server/db/schema';
import { announce } from '@/server/discord/outbox';
import { appUrl } from '@/server/discord/config';
import { featureFor } from '@/server/features';
import { getRoute } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { companyForUser } from './company';
import { loadHubs } from './contracts';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';

const HOUR = 3_600_000;
const SHIPPERS = ['Един познат', 'Приятел на приятел', 'Човек от пазара', 'Братовчед на някого', 'Тихият от бензиностанцията', 'Господинът с шапката'];
const pickOne = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!;

export async function smugglingProfile(db: DbOrTx, userId: string) {
  const [p] = await db.select().from(smugglingProfiles).where(eq(smugglingProfiles.userId, userId));
  return p ?? { userId, optIn: false, heat: 0, underground: 0, runs: 0, caught: 0, reports: 0, reportsToday: null, heatDecayedAt: null, updatedAt: new Date(0) };
}

async function ensureProfile(db: DbOrTx, userId: string) {
  await db.insert(smugglingProfiles).values({ userId }).onConflictDoNothing();
}

async function requireSmuggler(db: DbOrTx, userId: string, now: Date) {
  if (!(await featureFor(db, userId, 'smuggling', now))) fail('not_released', 'Сенчестите товари идват с обновление 1.9.', 403);
  const [u] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  if ((u?.level ?? 1) < SMUGGLING.minLevel) fail('level_required', `Сенчестите товари се отключват от ниво ${SMUGGLING.minLevel}.`, 403);
  const p = await smugglingProfile(db, userId);
  if (!p.optIn) fail('not_opted_in', 'Включи „Сенчести товари“ в Настройки, ако искаш да ги виждаш.', 403);
  return p;
}

/** The player's own choice (settings): on from level 10; off at any time. */
export async function setSmugglingOptIn(db: Database, userId: string, on: boolean, now = new Date()) {
  if (on) {
    if (!(await featureFor(db, userId, 'smuggling', now))) fail('not_released', 'Сенчестите товари идват с обновление 1.9.', 403);
    const [u] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
    if ((u?.level ?? 1) < SMUGGLING.minLevel) fail('level_required', `Сенчестите товари се отключват от ниво ${SMUGGLING.minLevel}.`, 403);
  }
  await ensureProfile(db, userId);
  await db.update(smugglingProfiles).set({ optIn: on, updatedAt: now }).where(eq(smugglingProfiles.userId, userId));
  if (!on) {
    // The open offers go away with the choice.
    await db.update(contracts).set({ status: 'expired' }).where(and(eq(contracts.shady, true), eq(contracts.createdBy, userId), eq(contracts.status, 'open')));
  }
  return { optIn: on };
}

/**
 * The evening offers of one player: personal, across a border, ×2–3.
 * Made when the player looks (and only in the evening, Sofia time).
 */
export async function smugglingOffers(db: Database, userId: string, now = new Date(), provider?: RoutingProvider) {
  const p = await smugglingProfile(db, userId);
  const open = () => db.select().from(contracts).where(and(eq(contracts.shady, true), eq(contracts.createdBy, userId), eq(contracts.status, 'open'), gt(contracts.expiresAt, now))).orderBy(desc(contracts.rewardCents));
  let list = await open();
  if (!p.optIn || !isEvening(sofiaHourOf(now)) || !(await featureFor(db, userId, 'smuggling', now))) return list;
  const [u] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  if ((u?.level ?? 1) < SMUGGLING.minLevel) return list;
  const { tier } = undergroundTier(p.underground);
  const want = SMUGGLING.offers + (tier >= 3 ? 1 : 0);
  if (list.length >= want) return list;
  const account = await companyForUser(db, userId);
  const trucks = await db.select({ cityId: vehicles.cityId }).from(vehicles).where(and(eq(vehicles.companyId, account.id), eq(vehicles.ownership, 'owned')));
  const hubs = await loadHubs(db, { now });
  const starts = [...new Set(trucks.map((t) => t.cityId))].map((id) => hubs.find((h) => h.id === id)).filter((h): h is NonNullable<typeof h> => !!h);
  if (!starts.length) return list;
  const contacts = await db.select().from(smugglingContacts).where(eq(smugglingContacts.userId, userId));
  for (let i = list.length, tries = 0; i < want && tries < want * 4; tries++) {
    // A city with a contact comes first.
    const origin = starts.find((s) => contacts.some((c) => c.cityId === s.id) && Math.random() < 0.6) ?? pickOne(starts);
    const foreign = hubs.filter((h) => h.countryCode !== origin.countryCode && h.population >= 50_000);
    const near = foreign.filter((h) => {
      const km = haversineKm([origin.lat, origin.lon], [h.lat, h.lon]);
      return km >= 150 && km <= 800;
    });
    const dest = near.length ? pickOne(near) : null;
    if (!dest) continue;
    const route = await getRoute(db, origin.id, dest.id, 'truck', provider);
    const tons = Math.round((SMUGGLING.tons.min + Math.random() * (SMUGGLING.tons.max - SMUGGLING.tons.min)) * 10) / 10;
    const top = tierMultiplier(tier);
    const contact = contacts.find((c) => c.cityId === origin.id);
    const mult = (SMUGGLING.multiplier.min + Math.random() * (top - SMUGGLING.multiplier.min)) * (1 + (contact ? contactLevel(contact.runs) * SMUGGLING.contactPay : 0));
    await db.insert(contracts).values({
      shipper: pickOne(SHIPPERS),
      goods: pickOne(SHADY_GOODS),
      cargoType: 'pallets',
      weightTons: tons,
      originCityId: origin.id,
      destCityId: dest.id,
      routeId: route.id,
      distanceKm: route.distanceKm,
      rewardCents: rewardCents('pallets', tons, route.distanceKm, mult),
      windowMinutes: contractWindowMinutes(route.distanceKm),
      minLevel: Math.max(CARGO.pallets.minLevel, 1),
      shady: true,
      createdBy: userId,
      expiresAt: new Date(now.getTime() + SMUGGLING.offerTtlHours * HOUR),
    });
    i++;
  }
  list = await open();
  return list;
}

/** acceptContract calls this for a shady load: only its own player, opted in, with an own truck. */
export async function checkShadyLoad(tx: Tx, userId: string, contract: { shady: boolean; createdBy: string | null }, vehicle: { ownership: string }, now: Date) {
  if (!contract.shady) return;
  if (contract.createdBy !== userId) fail('not_yours', 'Тази пратка не е за теб.', 403);
  await requireSmuggler(tx, userId, now);
  if (vehicle.ownership !== 'owned') fail('rented_truck', 'Сенчеста пратка не се кара с нает или фирмен камион — само със свой.');
}

/** A hidden compartment takes payload (any load). */
export function compartmentError(vehicle: { hiddenCompartment: boolean; modelId: string }, trailerModelId: string | null, tons: number) {
  if (!vehicle.hiddenCompartment) return null;
  const cap = combinationCapability({ unit: powerUnitModel(vehicle.modelId), trailer: trailerModelId ? trailerModel(trailerModelId) : null }).payloadTons;
  return tons > cap - SMUGGLING.compartmentPayloadTons ? `Тайното отделение заема ${SMUGGLING.compartmentPayloadTons} т — за този товар няма място.` : null;
}

/** Police reports on the way (a box around the lane) raise the chance of a check. */
async function policeOnTheWay(tx: DbOrTx, a: { lat: number; lon: number }, b: { lat: number; lon: number }, at: Date) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(roadReports)
    .where(and(eq(roadReports.kind, 'police'), gt(roadReports.expiresAt, at), lte(roadReports.createdAt, at), sql`${roadReports.lat} between ${Math.min(a.lat, b.lat) - 0.3} and ${Math.max(a.lat, b.lat) + 0.3}`, sql`${roadReports.lon} between ${Math.min(a.lon, b.lon) - 0.3} and ${Math.max(a.lon, b.lon) + 0.3}`));
  return row?.n ?? 0;
}

/**
 * Customs on arrival of a shady load (once per delivery). Caught: the load
 * is confiscated (settle pays no freight) and a fine is taken afterwards.
 */
export async function customsCheck(tx: Tx, userId: string, d: { id: string; vehicleId: string }, contract: { routeId: number; originCityId: number; destCityId: number }, at: Date, random = Math.random) {
  const [done] = await tx.select().from(smugglingChecks).where(eq(smugglingChecks.deliveryId, d.id));
  if (done) return { caught: done.caught, borders: done.borders };
  const p = await smugglingProfile(tx, userId);
  const [route] = await tx.select({ borders: routes.borders }).from(routes).where(eq(routes.id, contract.routeId));
  const [vehicle] = await tx.select({ hiddenCompartment: vehicles.hiddenCompartment }).from(vehicles).where(eq(vehicles.id, d.vehicleId));
  const ends = await tx.select({ id: cities.id, lat: cities.lat, lon: cities.lon }).from(cities).where(inArray(cities.id, [contract.originCityId, contract.destCityId]));
  const a = ends.find((c) => c.id === contract.originCityId)!;
  const b = ends.find((c) => c.id === contract.destCityId) ?? a;
  const police = await policeOnTheWay(tx, a, b, at);
  const [contact] = await tx.select().from(smugglingContacts).where(and(eq(smugglingContacts.userId, userId), eq(smugglingContacts.cityId, contract.originCityId)));
  const borders = route?.borders.length ?? 0;
  const chance = runCatchChance(borders, borderCheckChance({ heat: p.heat, policeReports: police, compartment: !!vehicle?.hiddenCompartment, contactLevel: contact ? contactLevel(contact.runs) : 0 }));
  const caught = random() < chance;
  return { caught, borders };
}

/** After the settle postings: the record, the fine (never below 0), heat, the two reputations and the contact. */
export async function afterCustoms(tx: Tx, userId: string, d: { id: string; companyId: string }, contract: { rewardCents: number; originCityId: number; goods: string }, outcome: { caught: boolean; borders: number }, at: Date) {
  const [balance] = await tx.select({ cents: companies.balanceCents }).from(companies).where(eq(companies.id, d.companyId));
  const fine = outcome.caught ? fineCents(contract.rewardCents, balance?.cents ?? 0) : 0;
  const [row] = await tx.insert(smugglingChecks).values({ deliveryId: d.id, userId, borders: outcome.borders, caught: outcome.caught, fineCents: fine, at }).onConflictDoNothing().returning();
  if (!row) return { fine: 0 };
  if (fine) await post(tx, d.companyId, [{ category: 'smuggling_fine', amountCents: -fine, description: `Митницата: ${contract.goods} (конфискувано)`, idempotencyKey: `delivery:${d.id}:smuggling-fine`, refType: 'delivery', refId: d.id }]);
  await ensureProfile(tx, userId);
  await tx
    .update(smugglingProfiles)
    .set({
      runs: sql`${smugglingProfiles.runs} + 1`,
      caught: outcome.caught ? sql`${smugglingProfiles.caught} + 1` : smugglingProfiles.caught,
      heat: sql`least(${SMUGGLING.heatMax}, ${smugglingProfiles.heat} + ${outcome.caught ? SMUGGLING.heatCaught : SMUGGLING.heatPerRun})`,
      underground: sql`greatest(0, ${smugglingProfiles.underground} + ${outcome.caught ? SMUGGLING.undergroundCaught : SMUGGLING.undergroundRun})`,
      updatedAt: at,
    })
    .where(eq(smugglingProfiles.userId, userId));
  if (!outcome.caught) {
    await tx.insert(smugglingContacts).values({ userId, cityId: contract.originCityId, runs: 1 }).onConflictDoUpdate({ target: [smugglingContacts.userId, smugglingContacts.cityId], set: { runs: sql`${smugglingContacts.runs} + 1` } });
  }
  await notify(
    tx,
    userId,
    outcome.caught ? 'warning' : 'success',
    outcome.caught ? 'Митницата намери пратката 🚨' : 'Пратката мина 🌙',
    outcome.caught ? `„${contract.goods}“ е конфискувано${fine ? `, глоба ${money(fine)}` : ''}. Вниманието към теб расте.` : `„${contract.goods}“ стигна. +${SMUGGLING.undergroundRun} подземна репутация.`,
    '/game/underground',
  );
  return { fine };
}

/** An honest delivery cools the heat a little. */
export async function honestDelivery(tx: Tx, userId: string) {
  await tx.update(smugglingProfiles).set({ heat: sql`greatest(0, ${smugglingProfiles.heat} - ${SMUGGLING.heatHonestDrop})` }).where(and(eq(smugglingProfiles.userId, userId), gt(smugglingProfiles.heat, 0)));
}

/** Worker, once a day: the heat falls by itself. */
export async function coolHeat(db: Database, now = new Date()) {
  if (!featureLive('smuggling', now)) return 0;
  const since = new Date(now.getTime() - 20 * HOUR);
  const rows = await db
    .update(smugglingProfiles)
    .set({ heat: sql`greatest(0, ${smugglingProfiles.heat} - ${SMUGGLING.heatDailyDrop})`, heatDecayedAt: now })
    .where(and(gt(smugglingProfiles.heat, 0), sql`(${smugglingProfiles.heatDecayedAt} is null or ${smugglingProfiles.heatDecayedAt} < ${since})`))
    .returning({ userId: smugglingProfiles.userId });
  return rows.length;
}

/** Turning down an offer by reporting it to customs: honest reputation, less heat, the underground remembers. */
export async function reportShadyOffer(db: Database, userId: string, contractId: string, now = new Date()) {
  await requireSmuggler(db, userId, now);
  return db.transaction(async (tx) => {
    const [c] = await tx.update(contracts).set({ status: 'expired' }).where(and(eq(contracts.id, contractId), eq(contracts.shady, true), eq(contracts.createdBy, userId), eq(contracts.status, 'open'))).returning();
    if (!c) fail('not_found', 'Няма такава оферта.', 404);
    const p = await smugglingProfile(tx, userId);
    const today = sofiaDate(now);
    const [day, n] = (p.reportsToday ?? '').split(':');
    const count = day === today ? Number(n) || 0 : 0;
    const rewarded = count < SMUGGLING.reportsPerDay;
    await tx
      .update(smugglingProfiles)
      .set({ reports: sql`${smugglingProfiles.reports} + 1`, reportsToday: `${today}:${count + 1}`, heat: clampHeat(p.heat - SMUGGLING.heatReportDrop), underground: Math.max(0, p.underground + SMUGGLING.undergroundReport), updatedAt: now })
      .where(eq(smugglingProfiles.userId, userId));
    const account = await companyForUser(tx, userId);
    if (rewarded) await tx.update(companies).set({ reputation: sql`least(100, ${companies.reputation} + ${SMUGGLING.reportReputation})` }).where(eq(companies.id, account.id));
    return { reported: true, reputation: rewarded ? SMUGGLING.reportReputation : 0 };
  });
}

/** Black market: the hidden compartment (from „Познат“). */
export async function buyCompartment(db: Database, userId: string, vehicleId: string, now = new Date()) {
  const p = await requireSmuggler(db, userId, now);
  if (undergroundTier(p.underground).tier < 1) fail('tier_required', 'Черният пазар ти продава тайно отделение, когато те знаят като „Познат“.', 403);
  return db.transaction(async (tx) => {
    const account = await companyForUser(tx, userId);
    const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, account.id))).for('update');
    if (!v) fail('not_found', 'Няма такъв камион.', 404);
    if (v!.ownership !== 'owned') fail('rented_truck', 'Само в свой камион.');
    if (v!.status !== 'idle') fail('vehicle_busy', 'Само между курсовете.');
    if (v!.hiddenCompartment) fail('already_installed', 'Вече има тайно отделение.');
    await post(tx, account.id, [{ category: 'black_market', amountCents: -SMUGGLING.compartmentPriceCents, description: `Тайно отделение — ${v!.plate}`, idempotencyKey: `compartment:${v!.id}` }], { requireFunds: true });
    await tx.update(vehicles).set({ hiddenCompartment: true }).where(eq(vehicles.id, v!.id));
    return { installed: true };
  });
}

/** Black market: a cheap repair (from „Доверен“) — it is noticed (+heat). */
export async function blackMarketRepair(db: Database, userId: string, vehicleId: string, now = new Date()) {
  const p = await requireSmuggler(db, userId, now);
  if (undergroundTier(p.underground).tier < 2) fail('tier_required', 'Евтиният ремонт е за „Доверен“ и нагоре.', 403);
  return db.transaction(async (tx) => {
    const account = await companyForUser(tx, userId);
    const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, account.id))).for('update');
    if (!v) fail('not_found', 'Няма такъв камион.', 404);
    if (v!.ownership !== 'owned') fail('rented_truck', 'Само свой камион.');
    if (v!.status !== 'idle') fail('vehicle_busy', 'Само между курсовете.');
    const [trailer] = await tx.select().from(trailers).where(eq(trailers.vehicleId, v!.id));
    const full = repairCostCents(powerUnitModel(v!.modelId).priceCents, v!.condition) + (trailer ? repairCostCents(trailerModel(trailer.modelId).priceCents, trailer.condition) : 0);
    if (full <= 0) fail('nothing_to_repair', 'Няма нужда от ремонт.');
    const cost = Math.round(full * SMUGGLING.blackRepairShare);
    await post(tx, account.id, [{ category: 'black_market', amountCents: -cost, description: `Ремонт „на тъмно“ — ${v!.plate}`, idempotencyKey: `black-repair:${v!.id}:${v!.odometerKm.toFixed(1)}:${v!.condition.toFixed(3)}` }], { requireFunds: true });
    await tx.update(vehicles).set({ condition: 100 }).where(eq(vehicles.id, v!.id));
    if (trailer) await tx.update(trailers).set({ condition: 100 }).where(eq(trailers.id, trailer.id));
    await tx.update(smugglingProfiles).set({ heat: sql`least(${SMUGGLING.heatMax}, ${smugglingProfiles.heat} + ${SMUGGLING.blackRepairHeat})` }).where(eq(smugglingProfiles.userId, userId));
    return { cost };
  });
}

/** The page: the profile, the two reputations, contacts and the last checks. */
export async function smugglingView(db: DbOrTx, userId: string) {
  const p = await smugglingProfile(db, userId);
  const contacts = await db.select({ cityId: smugglingContacts.cityId, city: cities.nameBg, runs: smugglingContacts.runs }).from(smugglingContacts).innerJoin(cities, eq(cities.id, smugglingContacts.cityId)).where(eq(smugglingContacts.userId, userId)).orderBy(desc(smugglingContacts.runs));
  const last = await db.select().from(smugglingChecks).where(eq(smugglingChecks.userId, userId)).orderBy(desc(smugglingChecks.at)).limit(8);
  return { profile: p, tier: undergroundTier(p.underground), contacts: contacts.map((c) => ({ ...c, level: contactLevel(c.runs) })), last };
}

/** Clean or grey: shown on the company's public profile. */
export async function companyShadeOf(db: DbOrTx, orgId: string) {
  const rows = await db.select({ underground: smugglingProfiles.underground }).from(companyMembers).innerJoin(smugglingProfiles, eq(smugglingProfiles.userId, companyMembers.userId)).where(eq(companyMembers.companyId, orgId));
  return companyShade(rows);
}

/** Monday: an anonymous customs summary in Discord (no names). */
export async function customsWeekly(db: Database, now = new Date()) {
  if (!featureLive('smuggling', now) || !featureLive('discord_bot', now)) return false;
  const week = sofiaDate(now);
  return db.transaction(async (tx) => {
    const since = new Date(now.getTime() - 7 * 24 * HOUR);
    const [s] = await tx.select({ total: sql<number>`count(*)::int`, caught: sql<number>`count(*) filter (where ${smugglingChecks.caught})::int`, fines: sql<number>`coalesce(sum(${smugglingChecks.fineCents}), 0)::bigint` }).from(smugglingChecks).where(gte(smugglingChecks.at, since));
    if (!s?.total) return false;
    await announce(tx, `customs-weekly:${week}`, 'news', {
      embeds: [{ title: '🛃 Митническа сводка за седмицата', url: `${appUrl()}/game/underground`, color: 0x7c3aed, description: `Проверени сенчести пратки: **${s.total}**\nХванати: **${s.caught}** · Минали: **${s.total - s.caught}**\nГлоби общо: **${money(Number(s.fines))}**`, footer: { text: 'TransVerse · игрови данни, без имена' } }],
    }, now);
    return true;
  });
}
