import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import { rewardCents } from '@/lib/game/economy';
import { featureDate, featureLive, type FeatureId } from '@/lib/game/features';
import { contractWindowMinutes } from '@/lib/game/schedule';
import {
  BUILD_BADGES,
  BUILDER_LOADS,
  BUILDING_TYPES,
  BUILDINGS,
  DECOR,
  decorError,
  DEFAULT_SPOTS,
  EXPANSIONS,
  isBoom,
  isComplete,
  levelFromUpgrade,
  levelSpec,
  MATERIAL_IDS,
  MATERIALS,
  materialCostCents,
  missing,
  PLOT,
  MAX_DECOR,
  placementError,
  plotWidth,
  splitLoads,
  upgradesFromBuildings,
  type BuildingType,
  type DecorKind,
  type MaterialId,
  type Materials,
} from '@/lib/game/plot';
import { haversineKm } from '@/lib/geo/geometry';
import type { UpgradeLevels } from '@/lib/game/company';
import { isStaff } from '@/server/auth/roles';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, companyBuildings, companyBuilds, companyDecor, companyMembers, contracts, deliveries, organizations, plotLikes, userBadges, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { getRoute } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { loadHubs } from './contracts';
import { postCoins } from './coins';
import { fail } from './errors';
import { addFeed } from './feed';
import { postTreasury } from './finance';
import { notifyMembers, requirePermission } from './membership';
import { shipperName } from './names';
import { broadcast, logActivity, notify } from './notify';

type Organization = typeof organizations.$inferSelect;
export type CompanyBuilding = typeof companyBuildings.$inferSelect;
export type CompanyBuild = typeof companyBuilds.$inferSelect;

/**
 * Gives a company its plot as it stands: companies founded before the plot
 * came get their upgrades as finished buildings (the office at least), and
 * an upgrade bought in "Развитие" before the release raises its building.
 * Companies founded later start with an empty plot. Safe to call often.
 */
export async function ensurePlot(tx: DbOrTx, org: Pick<Organization, 'id' | 'createdAt' | 'upgrades'>) {
  const release = featureDate('company_plot');
  const existing = await tx.select().from(companyBuildings).where(eq(companyBuildings.organizationId, org.id));
  const upgrades = org.upgrades as UpgradeLevels;
  // Companies founded with the plot start empty: they build everything themselves.
  if (release && org.createdAt >= release) return;
  const placed = existing.map((b) => ({ type: b.type as BuildingType, x: b.x, y: b.y }));
  for (const type of BUILDING_TYPES) {
    const level = type === 'office' ? Math.max(1, levelFromUpgrade(type, upgrades)) : levelFromUpgrade(type, upgrades);
    if (level <= 0) continue;
    const have = existing.find((b) => b.type === type);
    if (have) {
      if (have.level < level) await tx.update(companyBuildings).set({ level }).where(eq(companyBuildings.id, have.id));
      continue;
    }
    const spot = DEFAULT_SPOTS[type];
    if (placementError(type, spot.x, spot.y, placed)) continue;
    await tx.insert(companyBuildings).values({ organizationId: org.id, type, x: spot.x, y: spot.y, level }).onConflictDoNothing();
    placed.push({ type, ...spot });
  }
}

/** Tonnes of each material on the way for a construction (open loads and loads being driven). */
async function onTheWay(db: DbOrTx, buildId: string, now: Date): Promise<Materials> {
  const rows = await db
    .select({ material: contracts.material, tons: sql<number>`sum(${contracts.weightTons})::float` })
    .from(contracts)
    .leftJoin(deliveries, eq(deliveries.contractId, contracts.id))
    .where(and(eq(contracts.constructionId, buildId), or(and(eq(contracts.status, 'open'), gt(contracts.expiresAt, now)), eq(deliveries.status, 'in_progress'))))
    .groupBy(contracts.material);
  return Object.fromEntries(rows.filter((r) => r.material).map((r) => [r.material, r.tons])) as Materials;
}

/** Nearest city (at least 30 km away) that produces the material's cargo — where it is bought. */
async function supplierFor(db: DbOrTx, hqCityId: number, material: MaterialId) {
  const hubs = await loadHubs(db);
  const hq = hubs.find((h) => h.id === hqCityId) ?? (await db.select().from(cities).where(eq(cities.id, hqCityId)))[0];
  if (!hq) return null;
  const far = (h: { lat: number; lon: number }) => haversineKm([hq.lat, hq.lon], [h.lat, h.lon]);
  const cargo = MATERIALS[material].cargo;
  const candidates = hubs.filter((h) => h.id !== hqCityId && far(h) >= 30).sort((a, b) => far(a) - far(b));
  return candidates.find((h) => h.produces.has(cargo)) ?? candidates[0] ?? null;
}

/** Is the "Строителен бум" on for this player (materials cheaper, more experience for hauling them)? */
export async function boomFor(db: DbOrTx, userId: string, now: Date) {
  return isBoom(now) && (await featureFor(db, userId, 'build_boom', now));
}

async function decorOf(db: DbOrTx, organizationId: string) {
  const rows = await db.select().from(companyDecor).where(eq(companyDecor.organizationId, organizationId)).orderBy(asc(companyDecor.createdAt));
  return rows.map((d) => ({ id: d.id, kind: d.kind as DecorKind, x: d.x, y: d.y }));
}

/** Everything the plot page needs: buildings, the running construction and what it still misses. */
export async function plotView(db: DbOrTx, organizationId: string, now = new Date(), opts: { boom?: boolean } = {}) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  if (!org) return null;
  await ensurePlot(db, org);
  const buildings = await db.select().from(companyBuildings).where(eq(companyBuildings.organizationId, organizationId)).orderBy(asc(companyBuildings.createdAt));
  const [build] = await db.select().from(companyBuilds).where(and(eq(companyBuilds.organizationId, organizationId), inArray(companyBuilds.status, ['materials', 'building'])));
  const [hq] = await db.select({ id: cities.id, nameBg: cities.nameBg, countryCode: cities.countryCode }).from(cities).where(eq(cities.id, org.hqCityId));
  let construction = null;
  if (build) {
    const way = await onTheWay(db, build.id, now);
    const left = missing(build.needs, build.delivered, way);
    const target = buildings.find((b) => b.id === build.buildingId)!;
    construction = { ...build, type: target.type as BuildingType, onTheWay: way, missing: left, deliveredCostCents: materialCostCents(left, true, opts.boom), orderCostCents: materialCostCents(left, false, opts.boom), complete: isComplete(build.needs, build.delivered) };
  }
  return {
    org: { id: org.id, name: org.name, tag: org.tag, level: org.companyLevel, treasuryCents: org.treasuryCents, liveryColor: org.liveryColor },
    hq: hq ?? null,
    buildings: buildings.map((b) => ({ id: b.id, type: b.type as BuildingType, x: b.x, y: b.y, level: b.level })),
    construction,
    decor: await decorOf(db, organizationId),
    expansions: org.plotExpansions,
    plotW: plotWidth(org.plotExpansions),
    boom: !!opts.boom,
  };
}

async function activeBuild(tx: DbOrTx, organizationId: string) {
  const [b] = await tx.select().from(companyBuilds).where(and(eq(companyBuilds.organizationId, organizationId), inArray(companyBuilds.status, ['materials', 'building']))).for('update');
  return b ?? null;
}

async function newConstruction(tx: Tx, orgId: string, buildingId: string, type: BuildingType, level: number, actorId: string, now: Date) {
  const spec = levelSpec(type, level);
  const [row] = await tx.insert(companyBuilds).values({ organizationId: orgId, buildingId, targetLevel: level, needs: spec.materials, minutes: spec.minutes, createdBy: actorId, createdAt: now }).returning();
  await notifyMembers(tx, orgId, null, `Нов строеж: ${BUILDINGS[type].label}${level > 1 ? ` (ниво ${level})` : ''}`, `Нужни са ${Object.entries(spec.materials).map(([m, t]) => `${t} т ${MATERIALS[m as MaterialId].label.toLowerCase()}`).join(', ')}. Поръчките за материали ще се появят на борсата.`, '/game/company/plot');
  return row!;
}

/** Places a new building on the plot and opens its first construction (office first). */
export async function placeBuilding(db: Database, actorId: string, type: BuildingType, x: number, y: number, now = new Date()) {
  if (!BUILDINGS[type]) fail('unknown_building', 'Непозната сграда.');
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'build');
    await ensurePlot(tx, actor.company);
    const buildings = await tx.select().from(companyBuildings).where(eq(companyBuildings.organizationId, actor.company.id));
    if (buildings.some((b) => b.type === type)) fail('already_placed', 'Тази сграда вече е на участъка.');
    if (type !== 'office' && !buildings.some((b) => b.type === 'office' && b.level >= 1)) fail('office_first', 'Първо се строи офисът.');
    if (await activeBuild(tx, actor.company.id)) fail('busy', 'Компанията вече строи — завършете текущия строеж.', 409);
    const spec = levelSpec(type, 1);
    if (actor.company.companyLevel < spec.minCompanyLevel) fail('company_level', `Нужно е ниво ${spec.minCompanyLevel} на компанията.`);
    const error = placementError(type, x, y, buildings.map((b) => ({ type: b.type as BuildingType, x: b.x, y: b.y })), { plotW: plotWidth(actor.company.plotExpansions), decor: await decorOf(tx, actor.company.id) });
    if (error) fail('bad_place', error);
    const [building] = await tx.insert(companyBuildings).values({ organizationId: actor.company.id, type, x, y, level: 0, createdAt: now }).returning();
    const build = await newConstruction(tx, actor.company.id, building!.id, type, 1, actorId, now);
    await logActivity(tx, actorId, 'plot_place', { type, x, y });
    return build;
  });
}

/** Opens the construction of a building's next level. */
export async function upgradeBuilding(db: Database, actorId: string, type: BuildingType, now = new Date()) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'build');
    await ensurePlot(tx, actor.company);
    const [building] = await tx.select().from(companyBuildings).where(and(eq(companyBuildings.organizationId, actor.company.id), eq(companyBuildings.type, type)));
    if (!building || building.level < 1) fail('not_built', 'Сградата още не е построена.');
    const def = BUILDINGS[type];
    if (building!.level >= def.maxLevel) fail('max_level', 'Сградата е на най-високото ниво.');
    if (await activeBuild(tx, actor.company.id)) fail('busy', 'Компанията вече строи — завършете текущия строеж.', 409);
    const spec = levelSpec(type, building!.level + 1);
    if (actor.company.companyLevel < spec.minCompanyLevel) fail('company_level', `Нужно е ниво ${spec.minCompanyLevel} на компанията.`);
    return newConstruction(tx, actor.company.id, building!.id, type, building!.level + 1, actorId, now);
  });
}

/** Moves a building to another free spot (not while it is being built). */
export async function moveBuilding(db: Database, actorId: string, type: BuildingType, x: number, y: number) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'build');
    const buildings = await tx.select().from(companyBuildings).where(eq(companyBuildings.organizationId, actor.company.id));
    const building = buildings.find((b) => b.type === type);
    if (!building) fail('not_built', 'Сградата не е на участъка.');
    const active = await activeBuild(tx, actor.company.id);
    if (active?.buildingId === building!.id && active.status === 'building') fail('building', 'Сграда в строеж не може да се мести.');
    const error = placementError(type, x, y, buildings.map((b) => ({ type: b.type as BuildingType, x: b.x, y: b.y })), { plotW: plotWidth(actor.company.plotExpansions), decor: await decorOf(tx, actor.company.id) });
    if (error) fail('bad_place', error);
    await tx.update(companyBuildings).set({ x, y }).where(eq(companyBuildings.id, building!.id));
  });
}

/** Cancels a construction no material has been bought for yet (a new building leaves the plot). */
export async function cancelBuild(db: Database, actorId: string, buildId: string) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'build');
    const build = await activeBuild(tx, actor.company.id);
    if (!build || build.id !== buildId) fail('not_found', 'Няма такъв строеж.', 404);
    const [load] = await tx.select({ id: contracts.id }).from(contracts).where(eq(contracts.constructionId, buildId)).limit(1);
    if (build!.status !== 'materials' || load || Object.keys(build!.delivered).length) fail('started', 'Материалите вече са поръчани — строежът не може да се откаже.');
    await tx.update(companyBuilds).set({ status: 'cancelled' }).where(eq(companyBuilds.id, buildId));
    await tx.delete(companyBuildings).where(and(eq(companyBuildings.id, build!.buildingId), eq(companyBuildings.level, 0)));
  });
}

/**
 * Buys the missing materials from the treasury and puts them on the members'
 * board as loads from the nearest supplier city to the base. Loads that
 * expired unhauled are put back first, without paying again.
 */
export async function orderMaterials(db: Database, actorId: string, buildId: string, now = new Date(), provider?: RoutingProvider) {
  // Routes first (they may need the network), then everything in one transaction.
  const pre = await db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'build');
    const build = await activeBuild(tx, actor.company.id);
    if (!build || build.id !== buildId || build.status !== 'materials') fail('not_found', 'Няма строеж, който чака материали.', 404);
    return { org: actor.company };
  });
  const plans: { material: MaterialId; supplierId: number; routeId: number; km: number }[] = [];
  for (const material of MATERIAL_IDS) {
    const supplier = await supplierFor(db, pre.org.hqCityId, material);
    if (!supplier) continue;
    const route = await getRoute(db, supplier.id, pre.org.hqCityId, 'truck', provider);
    plans.push({ material, supplierId: supplier.id, routeId: route.id, km: route.distanceKm });
  }
  const result = await db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'build');
    const build = await activeBuild(tx, actor.company.id);
    if (!build || build.id !== buildId || build.status !== 'materials') fail('not_found', 'Няма строеж, който чака материали.', 404);
    // Expired loads come back to the board for free.
    const reopened = await tx
      .update(contracts)
      .set({ status: 'open', expiresAt: new Date(now.getTime() + PLOT.loadHours * 3_600_000) })
      .where(and(eq(contracts.constructionId, buildId), or(eq(contracts.status, 'expired'), and(eq(contracts.status, 'open'), lte(contracts.expiresAt, now)))))
      .returning({ id: contracts.id });
    const left = missing(build!.needs, build!.delivered, await onTheWay(tx, buildId, now));
    const cost = materialCostCents(left, false, await boomFor(tx, actorId, now));
    if (cost > 0) await postTreasury(tx, actor.company.id, [{ category: 'company_build', amountCents: -cost, description: `Материали за ${BUILDINGS[(await buildingType(tx, build!.buildingId))].label}`, idempotencyKey: `build:${buildId}:order:${randomUUID()}`, actorUserId: actorId, refType: 'company_build', refId: buildId }], { requireFunds: true });
    let loads = 0;
    for (const [material, tons] of Object.entries(left) as [MaterialId, number][]) {
      const plan = plans.find((p) => p.material === material);
      if (!plan) continue;
      const def = MATERIALS[material];
      for (const t of splitLoads(material, tons)) {
        await tx.insert(contracts).values({
          shipper: shipperName(),
          goods: def.goods,
          cargoType: def.cargo,
          weightTons: t,
          originCityId: plan.supplierId,
          destCityId: actor.company.hqCityId,
          routeId: plan.routeId,
          distanceKm: plan.km,
          rewardCents: rewardCents(def.cargo, t, plan.km, 1),
          windowMinutes: contractWindowMinutes(plan.km),
          minLevel: 1,
          constructionId: buildId,
          material,
          createdBy: actorId,
          createdAt: now,
          expiresAt: new Date(now.getTime() + PLOT.loadHours * 3_600_000),
        });
        loads++;
      }
    }
    if (loads || reopened.length) {
      await notifyMembers(tx, actor.company.id, null, 'Материали за строежа', `${loads + reopened.length} ${loads + reopened.length === 1 ? 'товар чака' : 'товара чакат'} на борсата — само за членовете. Всеки курс приближава строежа.`, '/game/contracts');
      await broadcast(tx, 'market');
    }
    return { loads: loads + reopened.length, costCents: cost };
  });
  return result;
}

async function buildingType(tx: DbOrTx, buildingId: string): Promise<BuildingType> {
  const [b] = await tx.select({ type: companyBuildings.type }).from(companyBuildings).where(eq(companyBuildings.id, buildingId));
  return (b?.type ?? 'office') as BuildingType;
}

/** Buys what is still missing (not on the way) delivered at once, with the markup. */
export async function buyDelivered(db: Database, actorId: string, buildId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'build');
    const build = await activeBuild(tx, actor.company.id);
    if (!build || build.id !== buildId || build.status !== 'materials') fail('not_found', 'Няма строеж, който чака материали.', 404);
    const left = missing(build!.needs, build!.delivered, await onTheWay(tx, buildId, now));
    const cost = materialCostCents(left, true, await boomFor(tx, actorId, now));
    if (cost <= 0) fail('nothing_missing', 'Всичко липсващо вече пътува към участъка.');
    await postTreasury(tx, actor.company.id, [{ category: 'company_build', amountCents: -cost, description: `Материали с доставка за ${BUILDINGS[await buildingType(tx, build!.buildingId)].label}`, idempotencyKey: `build:${buildId}:delivered:${randomUUID()}`, actorUserId: actorId, refType: 'company_build', refId: buildId }], { requireFunds: true });
    const delivered = { ...build!.delivered };
    for (const [m, t] of Object.entries(left) as [MaterialId, number][]) delivered[m] = Math.round(((delivered[m] ?? 0) + t) * 10) / 10;
    await tx.update(companyBuilds).set({ delivered }).where(eq(companyBuilds.id, buildId));
    if (isComplete(build!.needs, delivered)) await notifyMembers(tx, actor.company.id, 'build', 'Материалите са на участъка', 'Всичко е доставено — строежът може да започне.', '/game/company/plot');
    return { costCents: cost };
  });
}

/** A member's material load arrived at the base: it counts for the construction (never past what is needed). */
export async function recordMaterialDelivery(tx: Tx, contract: { constructionId: string | null; material: string | null; weightTons: number }, userId?: string, now = new Date()) {
  if (!contract.constructionId || !contract.material) return;
  if (userId) await builderBadge(tx, userId, now);
  const [build] = await tx.select().from(companyBuilds).where(eq(companyBuilds.id, contract.constructionId)).for('update');
  if (!build || build.status !== 'materials') return;
  const m = contract.material as MaterialId;
  const need = build.needs[m] ?? 0;
  const delivered = { ...build.delivered, [m]: Math.min(need, Math.round(((build.delivered[m] ?? 0) + contract.weightTons) * 10) / 10) };
  await tx.update(companyBuilds).set({ delivered }).where(eq(companyBuilds.id, build.id));
  if (userId) await markLastLoad(tx, build.id, userId, now);
  if (isComplete(build.needs, delivered) && !isComplete(build.needs, build.delivered)) {
    await notifyMembers(tx, build.organizationId, 'build', 'Материалите са на участъка', 'Всичко е доставено — строежът може да започне.', '/game/company/plot');
  }
}

/**
 * "Последен товар": when a construction waits only for one load still on the
 * board (nothing else open or on the way), that load pays more.
 */
async function markLastLoad(tx: Tx, buildId: string, userId: string, now: Date) {
  if (!(await featureFor(tx, userId, 'build_last_load', now))) return;
  const open = await tx.select({ id: contracts.id, lastLoad: contracts.lastLoad }).from(contracts).where(and(eq(contracts.constructionId, buildId), eq(contracts.status, 'open'), gt(contracts.expiresAt, now)));
  if (open.length !== 1 || open[0]!.lastLoad) return;
  const [driving] = await tx.select({ id: deliveries.id }).from(deliveries).innerJoin(contracts, eq(contracts.id, deliveries.contractId)).where(and(eq(contracts.constructionId, buildId), eq(deliveries.status, 'in_progress'))).limit(1);
  if (driving) return;
  await tx.update(contracts).set({ lastLoad: true, rewardCents: sql`round(${contracts.rewardCents} * ${PLOT.lastLoadFactor}::numeric)::bigint` }).where(and(eq(contracts.id, open[0]!.id), eq(contracts.lastLoad, false)));
  await broadcast(tx, 'market');
}

/** Gives a badge (once) with a notification; before the release only to the staff, who test it. */
async function giveBadge(tx: Tx, userId: string, role: string, badge: string, title: string, now: Date) {
  if (!featureLive('build_badges' satisfies FeatureId, now, isStaff(role))) return;
  const added = await tx.insert(userBadges).values({ userId, badge, awardedAt: now }).onConflictDoNothing().returning({ badge: userBadges.badge });
  if (added.length) await notify(tx, userId, 'info', `Нова значка: ${title}`, 'Виж я в профила си.', '/game/profile');
}

/** "Строител": the player hauled enough material loads (this one included). */
async function builderBadge(tx: Tx, userId: string, now: Date) {
  const [u] = await tx.select({ role: users.role }).from(users).where(eq(users.id, userId));
  if (!u) return;
  const [{ n = 0 } = {}] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed'), sql`${contracts.constructionId} is not null`));
  // The current load is being settled: it counts too.
  if (n + 1 >= BUILDER_LOADS) await giveBadge(tx, userId, u.role, BUILD_BADGES.builder, 'Строител', now);
}

/** The building badges for everyone in the company at the moment a building is finished. */
async function buildingBadges(tx: Tx, organizationId: string, all: { type: string; level: number }[], finished: { type: BuildingType; level: number }, now: Date) {
  const badges: { badge: string; title: string }[] = [];
  if (all.filter((b) => b.level > 0).length === 1 && finished.level === 1) badges.push({ badge: BUILD_BADGES.firstBrick, title: 'Първа тухла' });
  if (BUILDING_TYPES.every((t) => all.some((b) => b.type === t && b.level > 0))) badges.push({ badge: BUILD_BADGES.architect, title: 'Архитект' });
  if (finished.type === 'office' && finished.level >= BUILDINGS.office.maxLevel) badges.push({ badge: BUILD_BADGES.skyscraper, title: 'Небостъргач' });
  if (!badges.length) return;
  const members = await tx.select({ userId: companyMembers.userId, role: users.role }).from(companyMembers).innerJoin(users, eq(users.id, companyMembers.userId)).where(eq(companyMembers.companyId, organizationId));
  for (const m of members) for (const b of badges) await giveBadge(tx, m.userId, m.role, b.badge, b.title, now);
}

/** Starts building once every material is on the plot; the timer runs in real time. */
export async function startConstruction(db: Database, actorId: string, buildId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'build');
    const build = await activeBuild(tx, actor.company.id);
    if (!build || build.id !== buildId || build.status !== 'materials') fail('not_found', 'Няма строеж, който чака старт.', 404);
    if (!isComplete(build!.needs, build!.delivered)) fail('materials_missing', 'Още не са доставени всички материали.');
    const endsAt = new Date(now.getTime() + build!.minutes * 60_000);
    await tx.update(companyBuilds).set({ status: 'building', startedAt: now, endsAt }).where(eq(companyBuilds.id, buildId));
    const type = await buildingType(tx, build!.buildingId);
    await notifyMembers(tx, actor.company.id, null, `Строежът започна: ${BUILDINGS[type].label}`, `Готово около ${endsAt.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`, '/game/company/plot');
    return endsAt;
  });
}

/** Worker: finishes the constructions whose time is up — the building's level and its effect. */
export async function finishConstructions(db: Database, now = new Date()) {
  const due = await db.select({ id: companyBuilds.id }).from(companyBuilds).where(and(eq(companyBuilds.status, 'building'), lte(companyBuilds.endsAt, now))).limit(100);
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [build] = await tx.select().from(companyBuilds).where(and(eq(companyBuilds.id, id), eq(companyBuilds.status, 'building'))).for('update');
      if (!build) return;
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, build.organizationId)).for('update');
      await tx.update(companyBuildings).set({ level: build.targetLevel }).where(eq(companyBuildings.id, build.buildingId));
      await tx.update(companyBuilds).set({ status: 'done', doneAt: now }).where(eq(companyBuilds.id, build.id));
      const all = await tx.select().from(companyBuildings).where(eq(companyBuildings.organizationId, build.organizationId));
      await tx.update(organizations).set({ upgrades: upgradesFromBuildings(all.map((b) => ({ type: b.type as BuildingType, level: b.level })), org!.upgrades as UpgradeLevels) }).where(eq(organizations.id, build.organizationId));
      const type = all.find((b) => b.id === build.buildingId)!.type as BuildingType;
      const def = BUILDINGS[type];
      await buildingBadges(tx, build.organizationId, all, { type, level: build.targetLevel }, now);
      await notifyMembers(tx, build.organizationId, null, `${def.label} е ${build.targetLevel > 1 ? `на ниво ${build.targetLevel}` : 'построен'}!`, `${def.effect(build.targetLevel)}.`, '/game/company/plot');
      await addFeed(tx, { organizationId: build.organizationId, kind: 'build', text: `компанията ${build.targetLevel > 1 ? `вдигна „${def.label}“ на ниво ${build.targetLevel}` : `построи „${def.label}“`}` }, now);
    });
  }
  return due.length;
}

// ── Decorations and land ─────────────────────────────────────────────────

/** Puts a decoration on the plot: лв. from the treasury, or the buyer's own ТрансКоин. */
export async function placeDecor(db: Database, actorId: string, kind: DecorKind, x: number, y: number, now = new Date()) {
  const def = DECOR[kind];
  if (!def) fail('unknown_decor', 'Непозната украса.');
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'build');
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, actor.company.id)).for('update');
    const buildings = await tx.select().from(companyBuildings).where(eq(companyBuildings.organizationId, org!.id));
    const decor = await decorOf(tx, org!.id);
    if (decor.length >= MAX_DECOR) fail('decor_full', `На участъка има място за най-много ${MAX_DECOR} украси.`);
    const error = decorError(kind, x, y, buildings.map((b) => ({ type: b.type as BuildingType, x: b.x, y: b.y })), decor, plotWidth(org!.plotExpansions));
    if (error) fail('bad_place', error);
    const [row] = await tx.insert(companyDecor).values({ organizationId: org!.id, kind, x, y, createdAt: now }).returning();
    if (def.priceCents) {
      await postTreasury(tx, org!.id, [{ category: 'company_decor', amountCents: -def.priceCents, description: `Украса: ${def.label}`, idempotencyKey: `decor:${row!.id}`, actorUserId: actorId, refType: 'company_decor', refId: row!.id }], { requireFunds: true });
    } else if (def.coins) {
      await postCoins(tx, actorId, { amount: -def.coins, reason: 'shop', description: `Украса за базата: ${def.label}`, idempotencyKey: `decor:${row!.id}` }, { requireFunds: true });
    }
    await logActivity(tx, actorId, 'plot_decor', { kind, x, y });
    return row!;
  });
}

/** Takes a decoration off the plot (nothing is paid back). */
export async function removeDecor(db: Database, actorId: string, decorId: string) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'build');
    const removed = await tx.delete(companyDecor).where(and(eq(companyDecor.id, decorId), eq(companyDecor.organizationId, actor.company.id))).returning({ id: companyDecor.id });
    if (!removed.length) fail('not_found', 'Няма такава украса.', 404);
  });
}

/** Buys the next strip of land next to the plot from the treasury. */
export async function expandPlot(db: Database, actorId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'build');
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, actor.company.id)).for('update');
    const step = EXPANSIONS[org!.plotExpansions];
    if (!step) fail('max_size', 'Участъкът е с най-големия възможен размер.');
    if (org!.companyLevel < step!.minCompanyLevel) fail('company_level', `Нужно е ниво ${step!.minCompanyLevel} на компанията.`);
    const next = org!.plotExpansions + 1;
    await postTreasury(tx, org!.id, [{ category: 'company_land', amountCents: -step!.costCents, description: `Земя до участъка (${next})`, idempotencyKey: `land:${org!.id}:${next}`, actorUserId: actorId, refType: 'organization', refId: org!.id }], { requireFunds: true });
    await tx.update(organizations).set({ plotExpansions: next }).where(eq(organizations.id, org!.id));
    await notifyMembers(tx, org!.id, null, 'Участъкът стана по-голям', `Компанията купи земя до базата — участъкът вече е ${plotWidth(next)} на ${PLOT.h} квадрата.`, '/game/company/plot');
    await addFeed(tx, { organizationId: org!.id, kind: 'build', text: 'компанията купи още земя за базата си' }, now);
    return { expansions: next };
  });
}

// ── Guests ───────────────────────────────────────────────────────────────

/** "Браво" for another company's base (once per player and company; again takes it back). Not for your own. */
export async function likePlot(db: Database, userId: string, organizationId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [org] = await tx.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId));
    if (!org) fail('company_not_found', 'Компанията не е намерена.', 404);
    const [mine] = await tx.select({ id: companyMembers.userId }).from(companyMembers).where(and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, organizationId)));
    if (mine) fail('own_base', 'Своята база не се харесва — покажи я на другите.');
    const removed = await tx.delete(plotLikes).where(and(eq(plotLikes.userId, userId), eq(plotLikes.organizationId, organizationId))).returning({ id: plotLikes.userId });
    if (removed.length) return { liked: false };
    await tx.insert(plotLikes).values({ userId, organizationId, createdAt: now });
    return { liked: true };
  });
}

/** A company's base for visitors: the buildings, likes and whether the viewer liked it. */
export async function publicPlot(db: DbOrTx, organizationId: string, viewerId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  if (!org) return null;
  await ensurePlot(db, org);
  const buildings = await db.select().from(companyBuildings).where(eq(companyBuildings.organizationId, organizationId));
  const [build] = await db.select().from(companyBuilds).where(and(eq(companyBuilds.organizationId, organizationId), inArray(companyBuilds.status, ['materials', 'building'])));
  const [{ likes = 0 } = {}] = await db.select({ likes: sql<number>`count(*)::int` }).from(plotLikes).where(eq(plotLikes.organizationId, organizationId));
  const [mine] = await db.select({ id: plotLikes.userId }).from(plotLikes).where(and(eq(plotLikes.organizationId, organizationId), eq(plotLikes.userId, viewerId)));
  const target = build ? buildings.find((b) => b.id === build.buildingId) : null;
  return {
    buildings: buildings.map((b) => ({ type: b.type as BuildingType, x: b.x, y: b.y, level: b.level })),
    construction: build && target ? { type: target.type as BuildingType, status: build.status as 'materials' | 'building', startedAt: build.startedAt, endsAt: build.endsAt, delivered: build.delivered } : null,
    liveryColor: org.liveryColor,
    decor: await decorOf(db, organizationId),
    plotW: plotWidth(org.plotExpansions),
    likes,
    liked: !!mine,
  };
}

/** The most liked bases (likes of the last 30 days, then the sum of building levels). */
export async function topBases(db: DbOrTx, now = new Date(), limit = 25) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      tag: organizations.tag,
      level: organizations.companyLevel,
      likes: sql<number>`(select count(*) from plot_likes l where l.organization_id = ${organizations}.id and l.created_at >= ${since})::int`,
      buildings: sql<number>`(select coalesce(sum(b.level), 0) from company_buildings b where b.organization_id = ${organizations}.id)::int`,
    })
    .from(organizations)
    .where(sql`exists (select 1 from company_buildings b where b.organization_id = ${organizations}.id and b.level > 0)`)
    .orderBy(sql`5 desc`, sql`6 desc`)
    .limit(limit);
}
