import { plainGoodsFor } from '@/lib/game/goods';
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { CROSSING_LINES, type CrossingLine } from '@/lib/game/crossings';
import { featureLive } from '@/lib/game/features';
import { INTERMODAL } from '@/lib/game/living';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, intermodalShipments } from '@/server/db/schema';
import type { RoutingProvider } from '@/server/geo/routing';
import { featureFor } from '@/server/features';
import { insertLoad, loadHubs, type Hub } from './contracts';
import { post } from './finance';
import { notify } from './notify';
import { pick, rand } from './random';
import { t as tr } from '@/i18n/t';

/** The lines a container can ride: trains, and the sea lines between two mainland ports. */
const LINES = CROSSING_LINES.filter((l) => l.kind === 'rail' || l.optional);

/** A city near a terminal (not the terminal itself) that ships or takes the cargo. */
function near(hubs: Hub[], terminal: { lat: number; lon: number; id: number }, cargo: CargoType | null, role: 'produces' | 'consumes') {
  const options = hubs.filter((h) => h.id !== terminal.id && haversineKm([h.lat, h.lon], [terminal.lat, terminal.lon]) <= INTERMODAL.nearKm && (cargo ? (role === 'produces' ? h.produces.has(cargo) : h.consumes.has(cargo)) : h.produces.size > 0));
  return options.length ? pick(options) : null;
}

/**
 * Worker: keeps a few intermodal containers on the board. Each starts as a
 * truck load to a terminal of a real rail or sea line; the line carries it
 * on, and the last leg appears at the other terminal when it arrives.
 */
export async function ensureIntermodal(db: Database, now = new Date(), provider?: RoutingProvider) {
  if (!featureLive('intermodal', now)) return 0;
  // A leg nobody took (the load expired) ends the shipment.
  await db.execute(sql`update intermodal_shipments s set status = 'failed' from contracts c
    where s.status in ('leg1', 'leg2') and c.id = (case when s.status = 'leg1' then s.leg1_contract_id else s.leg2_contract_id end) and c.status = 'expired'`);
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(intermodalShipments).where(eq(intermodalShipments.status, 'leg1'));
  if (n >= INTERMODAL.open) return 0;
  const hubs = await loadHubs(db, { now });
  const terminals = await db.select({ id: cities.id, lat: cities.lat, lon: cities.lon }).from(cities).where(inArray(cities.id, LINES.flatMap((l) => [l.a, l.b])));
  let created = 0;
  for (let attempt = 0; attempt < 6 && n + created < INTERMODAL.open; attempt++) {
    const line = pick(LINES);
    const reversed = rand() < 0.5;
    const [fromId, toId] = reversed ? [line.b, line.a] : [line.a, line.b];
    const start = terminals.find((t) => t.id === fromId);
    const end = terminals.find((t) => t.id === toId);
    const terminalHub = hubs.find((h) => h.id === fromId);
    // Both terminals must be freight hubs, or the last leg could never start.
    if (!start || !end || !terminalHub || !hubs.some((h) => h.id === toId)) continue;
    const origin = near(hubs, start, null, 'produces');
    if (!origin) continue;
    const cargos = [...origin.produces].filter((c) => c !== 'vehicles' && c !== 'special');
    if (!cargos.length) continue;
    const cargo = pick(cargos);
    const dest = near(hubs, end, cargo, 'consumes');
    if (!dest) continue;
    const [minT, maxT] = CARGO[cargo].tons;
    const tons = Math.round((Math.max(minT, 8) + rand() * (Math.max(maxT, 9) - Math.max(minT, 8))) * 10) / 10;
    const goods = pick(plainGoodsFor(cargo, featureLive('more_goods', now)));
    const leg1 = await insertLoad(db, origin, terminalHub, cargo, tons, now, INTERMODAL.ttlHours * 3_600_000, provider, INTERMODAL.multiplier, { goods });
    if (!leg1) continue;
    await db.insert(intermodalShipments).values({ lineId: line.id, reversed, originCityId: origin.id, destCityId: dest.id, cargoType: cargo, goods, tons, leg1ContractId: leg1, createdAt: now });
    created++;
  }
  return created;
}

/** The line of a shipment. */
export const lineOf = (id: string): CrossingLine | undefined => CROSSING_LINES.find((l) => l.id === id);

/**
 * A leg of an intermodal container arrived. The first leg puts it on the
 * line (it reaches the other terminal after the line's real time); the last
 * leg closes it. Each leg on time pays a bonus; one driver for both, more.
 */
export async function intermodalDelivered(tx: Tx, userId: string, d: { id: string; companyId: string }, contractId: string, late: boolean, rewardCents: number, now: Date) {
  const [s] = await tx.select().from(intermodalShipments).where(or(eq(intermodalShipments.leg1ContractId, contractId), eq(intermodalShipments.leg2ContractId, contractId))).for('update');
  if (!s) return 0;
  const first = s.leg1ContractId === contractId;
  const line = lineOf(s.lineId);
  if (first) {
    await tx.update(intermodalShipments).set({ status: late ? 'failed' : 'on_line', firstUserId: userId, readyAt: new Date(now.getTime() + (line?.hours ?? 12) * 3_600_000) }).where(eq(intermodalShipments.id, s.id));
  } else {
    await tx.update(intermodalShipments).set({ status: late ? 'failed' : 'done' }).where(eq(intermodalShipments.id, s.id));
  }
  if (late || !(await featureFor(tx, userId, 'intermodal', now))) return 0;
  const share = !first && s.firstUserId === userId ? INTERMODAL.sameDriverShare : INTERMODAL.bonusShare;
  const bonus = Math.round(rewardCents * share);
  if (bonus > 0) await post(tx, d.companyId, [{ category: 'intermodal_bonus', amountCents: bonus, description: first ? tr('Контейнер до терминала: {0}', s.goods) : tr('Контейнер до получателя: {0}', s.goods), idempotencyKey: `delivery:${d.id}:intermodal`, refType: 'delivery', refId: d.id }]);
  return bonus;
}

/** Worker: containers whose line has arrived get their last leg (first for the driver of the first one). */
export async function releaseIntermodal(db: Database, now = new Date(), provider?: RoutingProvider) {
  const due = await db.select().from(intermodalShipments).where(and(eq(intermodalShipments.status, 'on_line'), lte(intermodalShipments.readyAt, now))).orderBy(asc(intermodalShipments.readyAt)).limit(10);
  if (!due.length) return 0;
  const hubs = await loadHubs(db, { europe: true, openWorld: true, now });
  let released = 0;
  for (const s of due) {
    const line = lineOf(s.lineId);
    const terminal = line ? hubs.find((h) => h.id === (s.reversed ? line.a : line.b)) : undefined;
    const dest = hubs.find((h) => h.id === s.destCityId);
    if (!terminal || !dest) {
      await db.update(intermodalShipments).set({ status: 'failed' }).where(eq(intermodalShipments.id, s.id));
      continue;
    }
    const leg2 = await insertLoad(db, terminal, dest, s.cargoType as CargoType, s.tons, now, INTERMODAL.ttlHours * 3_600_000, provider, INTERMODAL.multiplier, { goods: s.goods });
    if (!leg2) {
      // No route for the last leg: try again on the next ticks, but a container that never gets one must not hold up the queue.
      if (now.getTime() - s.readyAt!.getTime() > INTERMODAL.giveUpHours * 3_600_000) await db.update(intermodalShipments).set({ status: 'failed' }).where(eq(intermodalShipments.id, s.id));
      continue;
    }
    const [owner] = s.firstUserId ? await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, s.firstUserId)) : [];
    if (owner) await db.update(contracts).set({ reservedByCompanyId: owner.id, reservedUntil: new Date(now.getTime() + INTERMODAL.holdHours * 3_600_000) }).where(eq(contracts.id, leg2));
    await db.update(intermodalShipments).set({ status: 'leg2', leg2ContractId: leg2 }).where(eq(intermodalShipments.id, s.id));
    if (s.firstUserId) await notify(db, s.firstUserId, 'info', () => tr('Контейнерът пристигна на терминала'), () => tr('{0} е на терминала — последният курс е твой за {1} ч, после за всички.', s.goods, INTERMODAL.holdHours), `/game/contracts?from=${terminal.id}`);
    released++;
  }
  return released;
}

/** The containers on the way and on the board (for the logistics page). */
export async function intermodalBoard(db: DbOrTx, limit = 30) {
  const rows = await db.select().from(intermodalShipments).where(inArray(intermodalShipments.status, ['leg1', 'on_line', 'leg2'])).orderBy(asc(intermodalShipments.createdAt)).limit(limit);
  const ids = [...new Set(rows.flatMap((r) => [r.originCityId, r.destCityId]))];
  const names = ids.length ? await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, ids)) : [];
  const name = (id: number) => names.find((c) => c.id === id)?.nameBg ?? '';
  return rows.map((r) => ({ ...r, from: name(r.originCityId), to: name(r.destCityId), line: lineOf(r.lineId) }));
}
