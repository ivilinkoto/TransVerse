/**
 * Company tenders. A company gets a few offers; a member with the "tenders"
 * right accepts one, paying a deposit from the treasury. The order turns into
 * N loads on the freight board that only members see and take. Each load pays
 * its driver; when all arrive in time the treasury gets the bonus and the
 * deposit back, otherwise the deposit is lost.
 */
import { featureLive } from '@/lib/game/features';
import { plainGoodsFor } from '@/lib/game/goods';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { rewardCents } from '@/lib/game/economy';
import { isFreightHub } from '@/lib/game/markets';
import { contractWindowMinutes, gameDurationMinutes } from '@/lib/game/schedule';
import { MAX_ACTIVE_TENDERS, OFFER_HOURS, TENDER_KINDS, TENDER_OFFERS, tenderHours, tenderLoads, tenderMoney } from '@/lib/game/tenders';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companyMembers, companyTenders, contracts, deliveries, organizations, users } from '@/server/db/schema';
import { getRoute } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { fail } from './errors';
import { postTreasury } from './finance';
import { addCompanyXp, notifyMembers, requirePermission } from './membership';
import { broadcast, logActivity } from './notify';
import { pick, pickWeighted, rand } from './random';
import { t as tr, intlLocale } from '@/i18n/t';

type Tender = typeof companyTenders.$inferSelect;

// ── Offers ────────────────────────────────────────────────────────────────

async function makeOffer(db: Database, org: { id: string; hqCityId: number; companyLevel: number }, members: number, domestic: boolean, now: Date, provider?: RoutingProvider) {
  const hubs = (await db.select({ id: cities.id, nameBg: cities.nameBg, country: cities.countryCode, population: cities.population, lat: cities.lat, lon: cities.lon }).from(cities)).filter((c) => isFreightHub(c));
  const hq = hubs.find((c) => c.id === org.hqCityId) ?? (await db.select({ id: cities.id, nameBg: cities.nameBg, country: cities.countryCode, population: cities.population, lat: cities.lat, lon: cities.lon }).from(cities).where(eq(cities.id, org.hqCityId)))[0]!;
  // Start near the headquarters; go 150–800 km (inside the country for most offers).
  // Domestic offers start in the headquarters' country (a nearby city across the border may have no domestic destinations).
  const near = hubs.filter((c) => haversineKm([hq.lat, hq.lon], [c.lat, c.lon]) <= 200 && (!domestic || c.country === hq.country));
  const destsFrom = (from: typeof hq) =>
    hubs.filter((c) => c.id !== from.id && (!domestic || c.country === from.country)).filter((c) => {
      const d = haversineKm([from.lat, from.lon], [c.lat, c.lon]);
      return d >= 150 && d <= 800;
    });
  let origin = rand() < 0.5 ? hq : (pickWeighted(near, (c) => Math.sqrt(c.population)) ?? hq);
  let dests = destsFrom(origin);
  if (!dests.length && origin.id !== hq.id) dests = destsFrom((origin = hq));
  const dest = pickWeighted(dests, (c) => Math.sqrt(c.population));
  if (!dest) return null;
  const kind = pick(TENDER_KINDS);
  const cargo = kind.cargo as CargoType;
  const route = await getRoute(db, origin.id, dest.id, 'truck', provider);
  const loads = tenderLoads(members, org.companyLevel, rand());
  const perLoad = Math.round(rewardCents(cargo, kind.loadTons, route.distanceKm, 1.05) / 100) * 100;
  const money = tenderMoney(loads, perLoad);
  const [row] = await db
    .insert(companyTenders)
    .values({
      companyId: org.id,
      title: `${kind.label}: ${origin.nameBg} → ${dest.nameBg}`,
      goods: pick(plainGoodsFor(cargo, featureLive('more_goods', now))),
      cargoType: cargo,
      originCityId: origin.id,
      destCityId: dest.id,
      routeId: route.id,
      distanceKm: route.distanceKm,
      loads,
      loadTons: kind.loadTons,
      rewardPerLoadCents: perLoad,
      ...money,
      durationHours: tenderHours(loads, gameDurationMinutes(route.distanceKm), members),
      offerExpiresAt: new Date(now.getTime() + OFFER_HOURS * 3_600_000),
    })
    .returning();
  return row!;
}

/** Tops up the company's board to a few offers (old offers expire). Called when the tenders page is opened. */
export async function ensureTenderOffers(db: Database, companyId: string, now = new Date(), provider?: RoutingProvider) {
  await db.update(companyTenders).set({ status: 'expired' }).where(and(eq(companyTenders.companyId, companyId), eq(companyTenders.status, 'offer'), lte(companyTenders.offerExpiresAt, now)));
  const [org] = await db.select({ id: organizations.id, hqCityId: organizations.hqCityId, companyLevel: organizations.companyLevel }).from(organizations).where(eq(organizations.id, companyId));
  if (!org) return;
  const open = await db.select({ id: companyTenders.id }).from(companyTenders).where(and(eq(companyTenders.companyId, companyId), eq(companyTenders.status, 'offer')));
  const [{ members = 1 } = {}] = await db.select({ members: sql<number>`count(*)::int` }).from(companyMembers).where(eq(companyMembers.companyId, companyId));
  for (let i = open.length; i < TENDER_OFFERS; i++) {
    try {
      await makeOffer(db, org, members, i < 2, now, provider);
    } catch (error) {
      console.warn('[tenders] could not create an offer', error);
    }
  }
}

// ── Accepting ─────────────────────────────────────────────────────────────

/** A member with the "tenders" right accepts an offer: deposit from the treasury, loads on the board. */
export async function acceptTender(db: Database, actorId: string, tenderId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_tenders');
    const [t] = await tx.select().from(companyTenders).where(and(eq(companyTenders.id, tenderId), eq(companyTenders.companyId, actor.company.id))).for('update');
    if (!t) fail('tender_not_found', tr('Търгът не е намерен.'), 404);
    if (t!.status !== 'offer' || t!.offerExpiresAt <= now) fail('tender_unavailable', tr('Офертата вече не е налична.'), 409);
    const [{ active = 0 } = {}] = await tx.select({ active: sql<number>`count(*)::int` }).from(companyTenders).where(and(eq(companyTenders.companyId, actor.company.id), eq(companyTenders.status, 'active')));
    if (active >= MAX_ACTIVE_TENDERS) fail('too_many_tenders', tr('Компанията може да изпълнява до {0} търга едновременно.', MAX_ACTIVE_TENDERS));
    await postTreasury(tx, actor.company.id, [{ category: 'tender_deposit', amountCents: -t!.depositCents, description: tr('Депозит за търг: {0}', t!.title), idempotencyKey: `tender-deposit:${t!.id}`, actorUserId: actorId, refType: 'tender', refId: t!.id }], { requireFunds: true });
    const deadline = new Date(now.getTime() + t!.durationHours * 3_600_000);
    await tx.update(companyTenders).set({ status: 'active', acceptedBy: actorId, acceptedAt: now, deadlineAt: deadline }).where(eq(companyTenders.id, t!.id));
    await tx.insert(contracts).values(
      Array.from({ length: t!.loads }, (_, i) => ({
        shipper: tr('Търг на „{0}“ · курс {1}/{2}', actor.company.name, i + 1, t!.loads),
        goods: t!.goods,
        cargoType: t!.cargoType,
        weightTons: t!.loadTons,
        originCityId: t!.originCityId,
        destCityId: t!.destCityId,
        routeId: t!.routeId,
        distanceKm: t!.distanceKm,
        rewardCents: t!.rewardPerLoadCents,
        windowMinutes: contractWindowMinutes(t!.distanceKm),
        minLevel: CARGO[t!.cargoType as CargoType].minLevel,
        tenderId: t!.id,
        expiresAt: deadline,
      })),
    );
    await logActivity(tx, actorId, 'tender_accepted', { tenderId: t!.id });
    await notifyMembers(tx, actor.company.id, null, () => tr('Нов търг: {0}', t!.title), () => tr('{0} курса по {1} т до {2}. Курсовете са на борсата само за членовете — всеки плаща на шофьора, а при успех касата получава бонус.', t!.loads, t!.loadTons, deadline.toLocaleString(intlLocale(), { timeZone: 'Europe/Sofia', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), '/game/company/tenders');
    await broadcast(tx, 'market');
    return t!.id;
  });
}

// ── Progress, success and failure ────────────────────────────────────────

/** A tender load arrived (inside the settlement transaction). Counts if it arrived before the deadline. */
export async function recordTenderLoad(tx: Tx, tenderId: string, driverUserId: string, arrivedAt: Date) {
  const [t] = await tx.select().from(companyTenders).where(eq(companyTenders.id, tenderId)).for('update');
  if (!t || t.status !== 'active' || !t.deadlineAt || arrivedAt > t.deadlineAt) return;
  const drivers = { ...t.drivers, [driverUserId]: (t.drivers[driverUserId] ?? 0) + 1 };
  const delivered = t.deliveredLoads + 1;
  await tx.update(companyTenders).set({ deliveredLoads: delivered, drivers }).where(eq(companyTenders.id, t.id));
  if (delivered < t.loads) return;
  // Every load arrived in time: bonus and the deposit back to the treasury, XP for the company.
  await postTreasury(tx, t.companyId, [
    { category: 'tender_bonus', amountCents: t.bonusCents, description: tr('Изпълнен търг: {0}', t.title), idempotencyKey: `tender-bonus:${t.id}`, refType: 'tender', refId: t.id },
    { category: 'tender_deposit', amountCents: t.depositCents, description: tr('Върнат депозит: {0}', t.title), idempotencyKey: `tender-deposit-back:${t.id}`, refType: 'tender', refId: t.id },
  ]);
  await addCompanyXp(tx, t.companyId, t.xp);
  await tx.update(companyTenders).set({ status: 'completed', finishedAt: arrivedAt }).where(eq(companyTenders.id, t.id));
  await notifyMembers(tx, t.companyId, null, () => tr('Търгът е изпълнен: {0}', t.title), () => tr('+{0} лв. бонус в касата, депозитът е върнат, +{1} опит за компанията.', (t.bonusCents / 100).toLocaleString(intlLocale()), t.xp), '/game/company/tenders');
}

/**
 * Worker: tenders past their deadline fail (the deposit is lost and the loads
 * still on the board are withdrawn) — once no truck that arrived before the
 * deadline is still waiting to be settled.
 */
export async function settleTenders(db: Database, now = new Date()) {
  const due = await db.select().from(companyTenders).where(and(eq(companyTenders.status, 'active'), lte(companyTenders.deadlineAt, now)));
  let failed = 0;
  for (const t of due) {
    const [pending] = await db
      .select({ id: deliveries.id })
      .from(deliveries)
      .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .where(and(eq(contracts.tenderId, t.id), eq(deliveries.status, 'in_progress'), lte(deliveries.etaAt, t.deadlineAt!)))
      .limit(1);
    if (pending) continue;
    const changed = await db.transaction(async (tx) => {
      const [row] = await tx.update(companyTenders).set({ status: 'failed', finishedAt: now }).where(and(eq(companyTenders.id, t.id), eq(companyTenders.status, 'active'))).returning({ id: companyTenders.id });
      if (!row) return false;
      await tx.update(contracts).set({ status: 'expired' }).where(and(eq(contracts.tenderId, t.id), eq(contracts.status, 'open')));
      await notifyMembers(tx, t.companyId, null, () => tr('Търгът не е изпълнен: {0}', t.title), () => tr('Доставени {0} от {1} курса навреме. Депозитът от {2} лв. е загубен.', t.deliveredLoads, t.loads, (t.depositCents / 100).toLocaleString(intlLocale())), '/game/company/tenders');
      return true;
    });
    if (changed) failed++;
  }
  return failed;
}

// ── Checks and views ─────────────────────────────────────────────────────

/** Fails unless the player may take this tender load (member of that company, tender still running). */
export async function checkTenderLoad(tx: Tx, tenderId: string, userId: string, now: Date) {
  const [t] = await tx.select({ companyId: companyTenders.companyId, status: companyTenders.status, deadlineAt: companyTenders.deadlineAt }).from(companyTenders).where(eq(companyTenders.id, tenderId));
  const [m] = await tx.select({ companyId: companyMembers.companyId }).from(companyMembers).where(eq(companyMembers.userId, userId));
  if (!t || !m || m.companyId !== t.companyId) fail('tender_members_only', tr('Този курс е част от търг на друга компания.'), 403);
  if (t!.status !== 'active' || !t!.deadlineAt || t!.deadlineAt <= now) fail('contract_unavailable', tr('Търгът вече не е активен.'), 409);
}

/** Everything the company's tenders page shows. */
export async function tenderBoard(db: DbOrTx, companyId: string, now = new Date()) {
  const rows = await db
    .select()
    .from(companyTenders)
    .where(and(eq(companyTenders.companyId, companyId), inArray(companyTenders.status, ['offer', 'active', 'completed', 'failed'])))
    .orderBy(desc(companyTenders.createdAt))
    .limit(40);
  const offers = rows.filter((r) => r.status === 'offer' && r.offerExpiresAt > now).sort((a, b) => a.offerExpiresAt.getTime() - b.offerExpiresAt.getTime());
  const active = rows.filter((r) => r.status === 'active');
  const history = rows.filter((r) => r.status === 'completed' || r.status === 'failed').slice(0, 10);
  const cityIds = [...new Set(rows.flatMap((r) => [r.originCityId, r.destCityId]))];
  const names = cityIds.length ? new Map((await db.select({ id: cities.id, nameBg: cities.nameBg, country: cities.countryCode }).from(cities).where(inArray(cities.id, cityIds))).map((c) => [c.id, c])) : new Map();
  const driverIds = [...new Set(active.flatMap((t) => Object.keys(t.drivers)))];
  const people = driverIds.length ? new Map((await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, driverIds))).map((u) => [u.id, u.username])) : new Map<string, string>();
  // Loads on the road right now, per active tender.
  const onRoad = active.length
    ? await db
        .select({ tenderId: contracts.tenderId, n: sql<number>`count(*)::int` })
        .from(deliveries)
        .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
        .where(and(inArray(contracts.tenderId, active.map((t) => t.id)), eq(deliveries.status, 'in_progress')))
        .groupBy(contracts.tenderId)
    : [];
  const withNames = (t: Tender) => ({
    ...t,
    origin: names.get(t.originCityId) as { nameBg: string; country: string } | undefined,
    destination: names.get(t.destCityId) as { nameBg: string; country: string } | undefined,
    onRoad: onRoad.find((r) => r.tenderId === t.id)?.n ?? 0,
    driverNames: Object.entries(t.drivers).map(([id, n]) => ({ username: people.get(id) ?? '—', loads: n })).sort((a, b) => b.loads - a.loads),
  });
  return { offers: offers.map(withNames), active: active.map(withNames), history: history.map(withNames) };
}

