import { and, eq, gte, sql } from 'drizzle-orm';
import { combinationCapability } from '@/lib/game/catalog';
import { crewEffects } from '@/lib/game/crew';
import { rentalFeeCents, tripCosts } from '@/lib/game/economy';
import { fuelPriceCents, legFuelPriceCents } from '@/lib/game/fuel';
import { estimateGameMinutes } from '@/lib/game/schedule';
import { isVip, VIP_PERKS } from '@/lib/game/vip';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, deliveries, users, vehicles } from '@/server/db/schema';
import { companyForUser } from './company';
import { openContracts } from './contracts';
import { acceptContract, compatibilityError } from './deliveries';
import { fail } from './errors';
import { heldLicences, missingFor } from './licences';
import { membershipOf } from './membership';
import { notify } from './notify';
import { fleetView } from './queries';

/** VIP auto-dispatch: at most this many automatic trips per player and day. */
export const AUTO_DISPATCH_PER_DAY = 20;

export interface DispatchProposal {
  vehicleId: string;
  plate: string;
  contractId: string;
  goods: string;
  from: string;
  to: string;
  rewardCents: number;
  profitCents: number;
  minutes: number;
}

/**
 * The dispatcher's plan: for every free, crewed vehicle the most profitable
 * open job it can take and deliver on time (estimated profit per minute of the
 * trip), each job for one vehicle only. Only ordinary market jobs — no urgent
 * shipments, tenders or risks (overload, skipped rest). Estimates; the server
 * checks everything again when the trucks are sent.
 */
export async function planDispatch(db: DbOrTx, userId: string, now = new Date(), onlyVehicleId?: string): Promise<DispatchProposal[]> {
  const company = await companyForUser(db, userId);
  const [fleet, licences, membership, [user]] = await Promise.all([fleetView(db, company.id), heldLicences(db, userId), membershipOf(db, userId), db.select({ level: users.level, vipUntil: users.vipUntil }).from(users).where(eq(users.id, userId))]);
  const free = fleet.vehicles.filter((v) => !v.delivery && v.status === 'idle' && v.driver && (!onlyVehicleId || v.id === onlyVehicleId));
  if (!free.length) return [];
  const vip = isVip(user?.vipUntil, now);
  const cities = [...new Set(free.map((v) => v.cityId))];
  const lists = await Promise.all([openContracts(db, { limit: 250, memberOfCompanyId: membership?.company.id }, now), ...cities.map((cityId) => openContracts(db, { originCityId: cityId, limit: 60, memberOfCompanyId: membership?.company.id }, now))]);
  const seen = new Set<string>();
  const jobs = lists.flat().filter((c) => !c.urgent && !c.tenderId && !(c.reservedUntil && c.reservedUntil > now && c.reservedByCompanyId !== company.id) && company.reputation >= c.minReputation && (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const pairs: (DispatchProposal & { score: number })[] = [];
  for (const v of free) {
    const crew = crewEffects(v.driver!, v.coDriver, now);
    const cap = combinationCapability({ unit: v.model, trailer: v.trailer?.model ?? null });
    for (const c of jobs) {
      const error = compatibilityError({ modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, condition: v.condition, hasDriver: true, status: v.status, trailerCondition: v.trailer?.condition ?? null }, c, user?.level ?? 1);
      if (error) continue;
      if (missingFor({ cargoType: c.cargoType, originCountry: c.origin.countryCode, destCountry: c.destination.countryCode, routeCountries: c.route.countries }, licences).length) continue;
      const emptyKm = v.cityId === c.originCityId ? 0 : haversineKm([v.city.lat, v.city.lon], [c.origin.lat, c.origin.lon]) * 1.25;
      // Far empty runs are rarely worth it; the market has jobs closer by.
      if (emptyKm > 600) continue;
      const minutes = estimateGameMinutes(emptyKm, c.distanceKm, crew);
      if (minutes > c.windowMinutes) continue;
      const rented = v.ownership === 'rented';
      const cost = rented
        ? rentalFeeCents(c.rewardCents, emptyKm + c.distanceKm, vip ? VIP_PERKS.rentalShareReduction : 0)
        : tripCosts({ unit: v.model, trailer: v.trailer?.model ?? null, upgrades: v.upgrades, condition: v.condition, driverSkill: Math.max(v.driver!.skill, v.coDriver?.skill ?? 0), crewFuel: crew.fuel, crewWear: crew.wear, emptyKm, loadedKm: c.distanceKm, tons: c.weightTons, payloadTons: cap.payloadTons || 1, tolledRoute: { empty: true, loaded: c.route.hasToll }, fuelPrice: { empty: fuelPriceCents(v.city.countryCode, now), loaded: legFuelPriceCents(c.origin.countryCode, c.distanceKm, c.route.borders, now) } }).totalCents;
      const profit = c.rewardCents - cost;
      if (profit <= 0) continue;
      pairs.push({ vehicleId: v.id, plate: v.plate, contractId: c.id, goods: c.goods, from: c.origin.nameBg, to: c.destination.nameBg, rewardCents: c.rewardCents, profitCents: Math.round(profit), minutes: Math.round(minutes), score: profit / Math.max(10, minutes) });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedVehicles = new Set<string>();
  const usedJobs = new Set<string>();
  const plan: DispatchProposal[] = [];
  for (const p of pairs) {
    if (usedVehicles.has(p.vehicleId) || usedJobs.has(p.contractId)) continue;
    usedVehicles.add(p.vehicleId);
    usedJobs.add(p.contractId);
    const { score: _score, ...proposal } = p;
    void _score;
    plan.push(proposal);
  }
  return plan;
}

/** Sends the trucks of a plan (each acceptance is checked again; a taken job is skipped). */
export async function runDispatch(db: Database, userId: string, plan: { vehicleId: string; contractId: string }[], now = new Date(), auto = false) {
  if (plan.length > 50) fail('too_many', 'Твърде много курсове наведнъж.');
  const sent: string[] = [];
  const failed: { vehicleId: string; reason: string }[] = [];
  for (const p of plan) {
    try {
      const d = await acceptContract(db, userId, p.contractId, p.vehicleId, now);
      if (auto) await db.update(deliveries).set({ autoDispatched: true }).where(eq(deliveries.id, d.id));
      sent.push(d.id);
    } catch (e) {
      failed.push({ vehicleId: p.vehicleId, reason: (e as Error).message });
    }
  }
  return { sent: sent.length, failed };
}

export async function setAutoDispatch(db: Database, userId: string, vehicleId: string, on: boolean, now = new Date()) {
  const company = await companyForUser(db, userId);
  const [u] = await db.select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, userId));
  if (on && !isVip(u?.vipUntil, now)) fail('vip_only', 'Автоматичният диспечер е за VIP играчите.', 403);
  const rows = await db.update(vehicles).set({ autoDispatch: on }).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, company.id))).returning({ id: vehicles.id });
  if (!rows.length) fail('vehicle_not_found', 'Превозното средство не е намерено.', 404);
}

/** Worker: VIP players' trucks with auto-dispatch on take the dispatcher's next job when they are free. */
export async function autoDispatchTick(db: Database, now = new Date()): Promise<number> {
  const rows = await db
    .select({ vehicleId: vehicles.id, userId: companies.ownerId, vipUntil: users.vipUntil })
    .from(vehicles)
    .innerJoin(companies, eq(companies.id, vehicles.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(vehicles.autoDispatch, true), eq(vehicles.status, 'idle'), sql`${vehicles.soldAt} is null`))
    .limit(100);
  const dayStart = new Date(now.getTime() - 86_400_000);
  let sent = 0;
  for (const r of rows) {
    if (!isVip(r.vipUntil, now)) {
      await db.update(vehicles).set({ autoDispatch: false }).where(eq(vehicles.id, r.vehicleId));
      continue;
    }
    const [{ n = 0 } = {}] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(deliveries)
      .innerJoin(companies, eq(companies.id, deliveries.companyId))
      .where(and(eq(companies.ownerId, r.userId), eq(deliveries.autoDispatched, true), gte(deliveries.startedAt, dayStart)));
    if (n >= AUTO_DISPATCH_PER_DAY) continue;
    const [p] = await planDispatch(db, r.userId, now, r.vehicleId);
    if (!p) continue;
    const res = await runDispatch(db, r.userId, [p], now, true);
    if (res.sent) {
      sent++;
      if (n + 1 === AUTO_DISPATCH_PER_DAY) await notify(db, r.userId, 'info', 'Автоматичният диспечер почива', `Днес изпрати ${AUTO_DISPATCH_PER_DAY} курса — лимитът за 24 часа е достигнат.`, '/game/contracts');
    }
  }
  return sent;
}
