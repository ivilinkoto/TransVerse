import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { CARGO, CARGO_TYPES, type CargoType } from '@/lib/game/cargo';
import { combinationCapability, powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { CLIENT_RULES, clientBonusCents, clientFailReputation, clientTerms } from '@/lib/game/clients';
import { contractCountries, missingLicences, requiredLicences } from '@/lib/game/licences';
import { contractWindowMinutes } from '@/lib/game/schedule';
import { isVip } from '@/lib/game/vip';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, clientContracts, companies, contracts, deliveries, trailers, users, vehicles } from '@/server/db/schema';
import { getRoute } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { companyForUser } from './company';
import { loadHubs, type Hub } from './contracts';
import { acceptContract } from './deliveries';
import { fail } from './errors';
import { post } from './finance';
import { heldLicences } from './licences';
import { shipperName } from './names';
import { logActivity, notify } from './notify';
import { pick, pickWeighted, rand, randInt } from './random';
import { t as tr, intlLocale } from '@/i18n/t';

type ClientContract = typeof clientContracts.$inferSelect;

/** What the player's fleet can carry: body types and the biggest load per body, and where it stands. */
async function fleetReach(db: DbOrTx, companyId: string) {
  const vs = await db.select({ id: vehicles.id, modelId: vehicles.modelId, cityId: vehicles.cityId }).from(vehicles).where(and(eq(vehicles.companyId, companyId), isNull(vehicles.soldAt)));
  const ts = vs.length ? await db.select({ vehicleId: trailers.vehicleId, modelId: trailers.modelId }).from(trailers).where(inArray(trailers.vehicleId, vs.map((v) => v.id))) : [];
  const payload = new Map<CargoType, number>();
  for (const v of vs) {
    const t = ts.find((x) => x.vehicleId === v.id);
    const cap = combinationCapability({ unit: powerUnitModel(v.modelId), trailer: t ? trailerModel(t.modelId) : null });
    for (const c of CARGO_TYPES) {
      if (CARGO[c].bodies.some((b) => cap.bodies.includes(b))) payload.set(c, Math.max(payload.get(c) ?? 0, cap.payloadTons));
    }
  }
  return { payload, cities: [...new Set(vs.map((v) => v.cityId))] };
}

/** Current offers (and declined ones until they would have expired); renewed once they are gone. */
export async function clientOffers(db: Database, userId: string, now = new Date(), provider?: RoutingProvider) {
  const company = await companyForUser(db, userId);
  const live = await db
    .select()
    .from(clientContracts)
    .where(and(eq(clientContracts.companyId, company.id), inArray(clientContracts.status, ['offer', 'declined']), gt(clientContracts.offerExpiresAt, now)));
  if (live.length >= CLIENT_RULES.offers) return live.filter((o) => o.status === 'offer');
  // New offers only when the last batch has gone (accepted ones count as gone): no re-rolling by declining.
  if (live.length) return live.filter((o) => o.status === 'offer');
  const [user] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  const reach = await fleetReach(db, company.id);
  const licences = await heldLicences(db, userId);
  const hubs = await loadHubs(db);
  const [hq] = await db.select({ id: cities.id, lat: cities.lat, lon: cities.lon }).from(cities).where(eq(cities.id, company.hqCityId));
  const anchors = await db.select({ id: cities.id, lat: cities.lat, lon: cities.lon }).from(cities).where(inArray(cities.id, [...new Set([...reach.cities, company.hqCityId])]));
  const near = (h: Hub) => anchors.some((a) => haversineKm([a.lat, a.lon], [h.lat, h.lon]) <= CLIENT_RULES.originRadiusKm);
  const domesticOnly = !licences.has('international') || !licences.has('customs');
  const cargoOk = (c: CargoType) => CARGO[c].minLevel <= (user?.level ?? 1) && (reach.payload.get(c) ?? 0) >= 1 && missingLicences(requiredLicences(c, []), licences).length === 0;
  const offerExpiresAt = new Date(now.getTime() + CLIENT_RULES.offerHours * 3_600_000);
  const made: ClientContract[] = [];
  for (let attempt = 0; attempt < 12 && made.length < CLIENT_RULES.offers; attempt++) {
    const origin = pickWeighted(hubs.filter((h) => near(h) && [...h.produces].some(cargoOk)), (h) => Math.sqrt(h.population)) ?? (hq ? hubs.find((h) => h.id === hq.id) : undefined);
    if (!origin) break;
    const cargos = [...origin.produces].filter(cargoOk);
    const cargo = cargos.length ? pick(cargos) : cargoOk('pallets') ? 'pallets' : null;
    if (!cargo) break;
    const destination = pickWeighted(
      hubs.filter((h) => h.id !== origin.id && h.consumes.has(cargo) && (!domesticOnly || h.countryCode === origin.countryCode)),
      (h) => {
        const km = haversineKm([origin.lat, origin.lon], [h.lat, h.lon]) * 1.25;
        if (km < CLIENT_RULES.km[0] || km > CLIENT_RULES.km[1]) return 0;
        return Math.sqrt(h.population) / (1 + km / 600);
      },
    );
    if (!destination) continue;
    if (made.some((m) => m.originCityId === origin.id && m.destCityId === destination.id)) continue;
    const route = await getRoute(db, origin.id, destination.id, 'truck', provider);
    if (missingLicences(requiredLicences(cargo, contractCountries(origin.countryCode, destination.countryCode, route.countries)), licences).length) continue;
    const [minT, maxT] = CARGO[cargo].tons;
    const hi = Math.min(maxT, reach.payload.get(cargo) ?? maxT);
    const lo = Math.min(hi, minT);
    const tons = Math.round((lo + rand() * (hi - lo)) * 10) / 10;
    const loads = randInt(CLIENT_RULES.loads[0], CLIENT_RULES.loads[1]);
    const terms = clientTerms(cargo, tons, route.distanceKm, loads);
    const [row] = await db
      .insert(clientContracts)
      .values({
        companyId: company.id,
        client: shipperName(),
        cargoType: cargo,
        goods: pick(CARGO[cargo].goods),
        originCityId: origin.id,
        destCityId: destination.id,
        routeId: route.id,
        distanceKm: route.distanceKm,
        tonsPerLoad: tons,
        loadsTotal: loads,
        rewardPerLoadCents: terms.rewardPerLoadCents,
        bonusCents: terms.bonusCents,
        minReputation: terms.minReputation,
        durationHours: terms.durationHours,
        offerExpiresAt,
      })
      .returning();
    made.push(row!);
  }
  return made;
}

async function maxActive(db: DbOrTx, userId: string, now: Date) {
  const [u] = await db.select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, userId));
  return CLIENT_RULES.maxActive + (isVip(u?.vipUntil, now) ? CLIENT_RULES.vipExtraActive : 0);
}

export async function acceptClientContract(db: Database, userId: string, id: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [cc] = await tx.select().from(clientContracts).where(and(eq(clientContracts.id, id), eq(clientContracts.companyId, company.id))).for('update');
    if (!cc || cc.status !== 'offer' || cc.offerExpiresAt <= now) fail('offer_unavailable', tr('Офертата вече не е налична.'), 409);
    const [acct] = await tx.select({ reputation: companies.reputation }).from(companies).where(eq(companies.id, company.id)).for('update');
    if ((acct?.reputation ?? 0) < cc!.minReputation) fail('reputation_required', tr('Клиентът работи само с превозвачи с репутация поне {0} (твоята е {1}).', cc!.minReputation, Math.floor(acct?.reputation ?? 0)));
    const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(clientContracts).where(and(eq(clientContracts.companyId, company.id), eq(clientContracts.status, 'active')));
    const limit = await maxActive(tx, userId, now);
    if (n >= limit) fail('too_many_clients', tr('Можеш да имаш до {0} активни договора с клиенти едновременно.', limit));
    await tx.update(clientContracts).set({ status: 'active', acceptedAt: now, dueAt: new Date(now.getTime() + cc!.durationHours * 3_600_000) }).where(eq(clientContracts.id, cc!.id));
    await logActivity(tx, userId, 'client_contract_accepted', { clientContractId: cc!.id });
  });
}

export async function declineClientContract(db: Database, userId: string, id: string) {
  const company = await companyForUser(db, userId);
  const rows = await db.update(clientContracts).set({ status: 'declined' }).where(and(eq(clientContracts.id, id), eq(clientContracts.companyId, company.id), eq(clientContracts.status, 'offer'))).returning({ id: clientContracts.id });
  if (!rows.length) fail('offer_unavailable', tr('Офертата вече не е налична.'), 409);
}

/** Loads of a client contract that are on the road right now. */
async function loadsOnTheRoad(db: DbOrTx, clientContractId: string): Promise<number> {
  const [{ n = 0 } = {}] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .where(and(eq(contracts.clientContractId, clientContractId), eq(deliveries.status, 'in_progress')));
  return n;
}

/** Sends the next load of an active client contract with one of the player's vehicles. */
export async function sendClientLoad(db: Database, userId: string, id: string, vehicleId: string, now = new Date()) {
  const company = await companyForUser(db, userId);
  const contractId = await db.transaction(async (tx) => {
    const [cc] = await tx.select().from(clientContracts).where(and(eq(clientContracts.id, id), eq(clientContracts.companyId, company.id))).for('update');
    if (!cc || cc.status !== 'active') fail('client_contract_inactive', tr('Договорът не е активен.'), 409);
    if (cc!.dueAt && cc!.dueAt <= now) fail('client_contract_due', tr('Срокът на договора изтече.'), 409);
    if (cc!.loadsDone + (await loadsOnTheRoad(tx, cc!.id)) >= cc!.loadsTotal) fail('all_loads_sent', tr('Всички товари по договора вече са изпратени.'), 409);
    const [row] = await tx
      .insert(contracts)
      .values({
        shipper: cc!.client,
        goods: cc!.goods,
        cargoType: cc!.cargoType,
        weightTons: cc!.tonsPerLoad,
        originCityId: cc!.originCityId,
        destCityId: cc!.destCityId,
        routeId: cc!.routeId,
        distanceKm: cc!.distanceKm,
        rewardCents: cc!.rewardPerLoadCents,
        windowMinutes: contractWindowMinutes(cc!.distanceKm),
        minLevel: CARGO[cc!.cargoType as CargoType].minLevel,
        status: 'trade',
        tradeCompanyId: company.id,
        clientContractId: cc!.id,
        expiresAt: new Date(now.getTime() + 3_600_000),
      })
      .returning({ id: contracts.id });
    return row!.id;
  });
  try {
    return await acceptContract(db, userId, contractId, vehicleId, now);
  } catch (error) {
    // The truck could not go: the load stays with the client.
    await db.delete(contracts).where(and(eq(contracts.id, contractId), eq(contracts.status, 'trade')));
    throw error;
  }
}

/** A load of a client contract arrived (called from the delivery settlement). */
export async function recordClientLoad(tx: Tx, clientContractId: string, late: boolean, ownerId: string, at: Date) {
  const [cc] = await tx.select().from(clientContracts).where(eq(clientContracts.id, clientContractId)).for('update');
  if (!cc || cc.status !== 'active') return;
  const done = cc.loadsDone + 1;
  const lateLoads = cc.loadsLate + (late ? 1 : 0);
  if (done < cc.loadsTotal) {
    await tx.update(clientContracts).set({ loadsDone: done, loadsLate: lateLoads }).where(eq(clientContracts.id, cc.id));
    return;
  }
  await tx.update(clientContracts).set({ loadsDone: done, loadsLate: lateLoads, status: 'completed', finishedAt: at }).where(eq(clientContracts.id, cc.id));
  const bonus = clientBonusCents(cc.bonusCents, cc.loadsTotal, lateLoads);
  if (bonus > 0) await post(tx, cc.companyId, [{ category: 'client_bonus', amountCents: bonus, description: tr('Бонус от „{0}“ за изпълнен договор', cc.client), idempotencyKey: `client:${cc.id}:bonus`, refType: 'client_contract', refId: cc.id }]);
  await tx.update(companies).set({ reputation: sql`least(100, ${companies.reputation} + ${CLIENT_RULES.successReputation})` }).where(eq(companies.id, cc.companyId));
  await notify(tx, ownerId, 'success', () => tr('Договорът с „{0}“ е изпълнен', cc.client), () => tr('{0} товара{1}. Бонус {2} лв. и +{3} репутация.', cc.loadsTotal, lateLoads ? tr(' ({0} със закъснение)', lateLoads) : '', (bonus / 100).toLocaleString(intlLocale()), CLIENT_RULES.successReputation), '/game/clients');
}

/** Worker: old offers expire; active contracts past their deadline fail once no load is still on the road. */
export async function settleClientContracts(db: Database, now = new Date()): Promise<number> {
  await db.update(clientContracts).set({ status: 'expired' }).where(and(eq(clientContracts.status, 'offer'), lte(clientContracts.offerExpiresAt, now)));
  const due = await db.select().from(clientContracts).where(and(eq(clientContracts.status, 'active'), lte(clientContracts.dueAt, now))).limit(100);
  let failed = 0;
  for (const cc of due) {
    if ((await loadsOnTheRoad(db, cc.id)) > 0) continue;
    failed += await db.transaction(async (tx) => {
      const rows = await tx.update(clientContracts).set({ status: 'failed', finishedAt: now }).where(and(eq(clientContracts.id, cc.id), eq(clientContracts.status, 'active'))).returning({ id: clientContracts.id });
      if (!rows.length) return 0;
      const loss = clientFailReputation(cc.loadsTotal, cc.loadsDone);
      const [acct] = await tx.update(companies).set({ reputation: sql`greatest(0, ${companies.reputation} - ${loss})` }).where(eq(companies.id, cc.companyId)).returning({ ownerId: companies.ownerId });
      if (acct) await notify(tx, acct.ownerId, 'warning', () => tr('Договорът с „{0}“ не е изпълнен', cc.client), () => tr('Срокът изтече с {0} от {1} товара. −{2} репутация.', cc.loadsDone, cc.loadsTotal, loss), '/game/clients');
      return 1;
    });
  }
  return failed;
}

/** The player's client contracts for the page: active ones, recent finished ones. */
export async function clientContractsOf(db: DbOrTx, companyId: string) {
  const active = await db.select().from(clientContracts).where(and(eq(clientContracts.companyId, companyId), eq(clientContracts.status, 'active'))).orderBy(asc(clientContracts.dueAt));
  const history = await db
    .select()
    .from(clientContracts)
    .where(and(eq(clientContracts.companyId, companyId), or(eq(clientContracts.status, 'completed'), eq(clientContracts.status, 'failed'))))
    .orderBy(desc(clientContracts.finishedAt))
    .limit(10);
  const onRoad = new Map<string, number>();
  for (const cc of active) onRoad.set(cc.id, await loadsOnTheRoad(db, cc.id));
  return { active, history, onRoad };
}
