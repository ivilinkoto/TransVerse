import { and, count, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { money } from '@/lib/format';
import { CARGO } from '@/lib/game/cargo';
import { islandOf } from '@/lib/game/crossings';
import { CONTAINER_PORTS, PORT_LOADS, SHIP_CALL, SHIP_NAMES } from '@/lib/game/ports';
import { sofiaHourOf } from '@/lib/game/together';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, companyMembers, contracts, deliveries, organizations, shipCalls } from '@/server/db/schema';
import type { RoutingProvider } from '@/server/geo/routing';
import { addLoad, loadHubs, type Hub } from './contracts';
import { postTreasury } from './finance';
import { notifyMembers } from './membership';
import { broadcast } from './notify';
import { pick, pickWeighted, rand, randInt } from './random';

const portName = (cityId: number) => CONTAINER_PORTS.find((p) => p.cityId === cityId)?.name ?? '';

/** Inland destinations for containers from a port: real cities 80–900 km away (not islands). */
function inland(hubs: Hub[], port: Hub, count_: number) {
  const fits = hubs.filter((h) => {
    if (h.id === port.id || islandOf(h)) return false;
    const km = haversineKm([port.lat, port.lon], [h.lat, h.lon]) * 1.25;
    return km >= PORT_LOADS.minKm && km <= PORT_LOADS.maxKm;
  });
  const out: Hub[] = [];
  for (let i = 0; i < count_ && fits.length; i++) {
    const h = pickWeighted(fits, (x) => Math.sqrt(x.population) * (x.consumes.has('container') ? 2 : 1));
    if (h) out.push(h);
  }
  return out;
}

const containerTons = () => {
  const [lo, hi] = CARGO.container.tons;
  return Math.round((Math.max(lo, 10) + rand() * (Math.min(hi, 26) - Math.max(lo, 10))) * 10) / 10;
};

/** Worker: keeps a few container loads at every big port (v1.4). */
export async function ensurePortLoads(db: Database, now = new Date(), provider?: RoutingProvider) {
  const open = await db
    .select({ cityId: contracts.originCityId, n: count() })
    .from(contracts)
    .where(and(eq(contracts.port, true), isNull(contracts.portCallId), eq(contracts.status, 'open'), gt(contracts.expiresAt, now)))
    .groupBy(contracts.originCityId);
  const hubs = await loadHubs(db);
  let created = 0;
  for (const p of CONTAINER_PORTS) {
    const missing = PORT_LOADS.perPort - (open.find((o) => o.cityId === p.cityId)?.n ?? 0);
    const port = hubs.find((h) => h.id === p.cityId);
    if (missing <= 0 || !port) continue;
    for (const dest of inland(hubs, port, missing)) {
      if (await addLoad(db, port.id, dest.id, 'container', containerTons(), now, PORT_LOADS.ttlHours * 3_600_000, PORT_LOADS.multiplier, { port: true }, provider, hubs)) created++;
    }
  }
  if (created) await broadcast(db, 'market');
  return created;
}

/**
 * Worker: "Кораб пристига" — in the day, some time after the last ship, a
 * ship brings containers to a big port for two days. A few destinations, so
 * the routes are few.
 */
export async function startShipCall(db: Database, now = new Date(), provider?: RoutingProvider) {
  const hour = sofiaHourOf(now);
  if (hour < SHIP_CALL.fromHour || hour >= SHIP_CALL.toHour) return null;
  const [last] = await db.select().from(shipCalls).orderBy(desc(shipCalls.startsAt)).limit(1);
  if (last && (last.status === 'active' || last.endsAt.getTime() + SHIP_CALL.pauseHours * 3_600_000 > now.getTime())) return null;
  const hubs = await loadHubs(db);
  const p = pick([...CONTAINER_PORTS]);
  const port = hubs.find((h) => h.id === p.cityId);
  if (!port) return null;
  const containers = randInt(SHIP_CALL.containers[0], SHIP_CALL.containers[1]);
  const endsAt = new Date(now.getTime() + SHIP_CALL.hours * 3_600_000);
  const [call] = await db.insert(shipCalls).values({ portCityId: port.id, ship: pick(SHIP_NAMES), containers, startsAt: now, endsAt, createdAt: now }).returning();
  const destinations = inland(hubs, port, 6);
  let made = 0;
  for (let i = 0; i < containers && destinations.length; i++) {
    if (await addLoad(db, port.id, destinations[i % destinations.length]!.id, 'container', containerTons(), now, SHIP_CALL.hours * 3_600_000, SHIP_CALL.multiplier, { port: true, portCallId: call!.id }, provider, hubs)) made++;
  }
  // Fewer loads than planned (no way to some destination): the ship brought that many.
  if (made !== containers) await db.update(shipCalls).set({ containers: made }).where(eq(shipCalls.id, call!.id));
  await broadcast(db, 'market');
  return { ...call!, containers: made, portName: portName(port.id) };
}

/** A container of a ship call arrived. */
export async function recordShipContainer(tx: Tx, portCallId: string) {
  await tx.update(shipCalls).set({ delivered: sql`${shipCalls.delivered} + 1` }).where(eq(shipCalls.id, portCallId));
}

/** Containers hauled per company (by the members' trips) for a ship call. */
export async function shipCallScores(db: DbOrTx, callId: string) {
  return db
    .select({ organizationId: organizations.id, name: organizations.name, tag: organizations.tag, containers: count() })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(companyMembers, eq(companyMembers.userId, companies.ownerId))
    .innerJoin(organizations, eq(organizations.id, companyMembers.companyId))
    .where(and(eq(contracts.portCallId, callId), eq(deliveries.status, 'completed')))
    .groupBy(organizations.id, organizations.name, organizations.tag)
    .orderBy(desc(count()))
    .limit(10);
}

/** Worker: ends a ship call when its time is up or every container arrived; the company that hauled the most wins. */
export async function settleShipCalls(db: Database, now = new Date()) {
  const due = await db.select().from(shipCalls).where(and(eq(shipCalls.status, 'active'), or(lte(shipCalls.endsAt, now), sql`${shipCalls.delivered} >= ${shipCalls.containers}`)));
  const done: string[] = [];
  for (const call of due) {
    // Containers still on the road finish first (they count).
    const [onRoad] = await db.select({ n: count() }).from(deliveries).innerJoin(contracts, eq(contracts.id, deliveries.contractId)).where(and(eq(contracts.portCallId, call.id), eq(deliveries.status, 'in_progress')));
    if ((onRoad?.n ?? 0) > 0 && call.endsAt.getTime() + 6 * 3_600_000 > now.getTime()) continue;
    const scores = await shipCallScores(db, call.id);
    const top = scores[0] && scores[0].containers >= SHIP_CALL.minContainers && (scores[1]?.containers ?? 0) < scores[0].containers ? scores[0] : null;
    await db.transaction(async (tx) => {
      const [mine] = await tx.update(shipCalls).set({ status: 'done', winnerOrganizationId: top?.organizationId ?? null }).where(and(eq(shipCalls.id, call.id), eq(shipCalls.status, 'active'))).returning();
      if (!mine) return;
      await tx.update(contracts).set({ status: 'expired' }).where(and(eq(contracts.portCallId, call.id), eq(contracts.status, 'open')));
      if (top) {
        await postTreasury(tx, top.organizationId, [{ category: 'ship_call', amountCents: SHIP_CALL.prizeCents, description: `${call.ship} в ${portName(call.portCityId)}: най-много контейнери`, idempotencyKey: `ship:${call.id}`, refType: 'ship_call', refId: call.id }]);
        await notifyMembers(tx, top.organizationId, null, `Първи при ${call.ship}! 🚢`, `Компанията разкара най-много контейнери (${top.containers}) — ${money(SHIP_CALL.prizeCents)} влязоха в касата.`, '/game/company');
      }
      done.push(call.id);
    });
  }
  return done.length;
}

/** The running ship call (for the board and the dashboard). */
export async function activeShipCall(db: DbOrTx) {
  const [call] = await db.select().from(shipCalls).where(eq(shipCalls.status, 'active')).orderBy(desc(shipCalls.startsAt)).limit(1);
  return call ? { ...call, portName: portName(call.portCityId) } : null;
}
