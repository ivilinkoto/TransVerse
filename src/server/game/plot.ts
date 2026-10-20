import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, lte, or, sql } from 'drizzle-orm';
import { rewardCents } from '@/lib/game/economy';
import { featureDate } from '@/lib/game/features';
import { contractWindowMinutes } from '@/lib/game/schedule';
import {
  BUILDING_TYPES,
  BUILDINGS,
  DEFAULT_SPOTS,
  isComplete,
  levelFromUpgrade,
  levelSpec,
  MATERIAL_IDS,
  MATERIALS,
  materialCostCents,
  missing,
  PLOT,
  placementError,
  splitLoads,
  upgradesFromBuildings,
  type BuildingType,
  type MaterialId,
  type Materials,
} from '@/lib/game/plot';
import { haversineKm } from '@/lib/geo/geometry';
import type { UpgradeLevels } from '@/lib/game/company';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companyBuildings, companyBuilds, contracts, deliveries, organizations } from '@/server/db/schema';
import { getRoute } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { loadHubs } from './contracts';
import { fail } from './errors';
import { addFeed } from './feed';
import { postTreasury } from './finance';
import { notifyMembers, requirePermission } from './membership';
import { shipperName } from './names';
import { broadcast, logActivity } from './notify';

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

/** Everything the plot page needs: buildings, the running construction and what it still misses. */
export async function plotView(db: DbOrTx, organizationId: string, now = new Date()) {
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
    construction = { ...build, type: target.type as BuildingType, onTheWay: way, missing: left, deliveredCostCents: materialCostCents(missing(build.needs, build.delivered, way), true), orderCostCents: materialCostCents(left), complete: isComplete(build.needs, build.delivered) };
  }
  return { org: { id: org.id, name: org.name, level: org.companyLevel, treasuryCents: org.treasuryCents }, hq: hq ?? null, buildings: buildings.map((b) => ({ id: b.id, type: b.type as BuildingType, x: b.x, y: b.y, level: b.level })), construction };
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
    const error = placementError(type, x, y, buildings.map((b) => ({ type: b.type as BuildingType, x: b.x, y: b.y })));
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
    const error = placementError(type, x, y, buildings.map((b) => ({ type: b.type as BuildingType, x: b.x, y: b.y })));
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
    const cost = materialCostCents(left);
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
    const cost = materialCostCents(left, true);
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
export async function recordMaterialDelivery(tx: Tx, contract: { constructionId: string | null; material: string | null; weightTons: number }) {
  if (!contract.constructionId || !contract.material) return;
  const [build] = await tx.select().from(companyBuilds).where(eq(companyBuilds.id, contract.constructionId)).for('update');
  if (!build || build.status !== 'materials') return;
  const m = contract.material as MaterialId;
  const need = build.needs[m] ?? 0;
  const delivered = { ...build.delivered, [m]: Math.min(need, Math.round(((build.delivered[m] ?? 0) + contract.weightTons) * 10) / 10) };
  await tx.update(companyBuilds).set({ delivered }).where(eq(companyBuilds.id, build.id));
  if (isComplete(build.needs, delivered) && !isComplete(build.needs, build.delivered)) {
    await notifyMembers(tx, build.organizationId, 'build', 'Материалите са на участъка', 'Всичко е доставено — строежът може да започне.', '/game/company/plot');
  }
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
      await notifyMembers(tx, build.organizationId, null, `${def.label} е ${build.targetLevel > 1 ? `на ниво ${build.targetLevel}` : 'построен'}!`, `${def.effect(build.targetLevel)}.`, '/game/company/plot');
      await addFeed(tx, { organizationId: build.organizationId, kind: 'build', text: `компанията ${build.targetLevel > 1 ? `вдигна „${def.label}“ на ниво ${build.targetLevel}` : `построи „${def.label}“`}` }, now);
    });
  }
  return due.length;
}

