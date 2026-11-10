/**
 * 1.3 „Автобусна компания“ on the server. Each line lives in job_state under
 * `bus-line:<id>` (a BusLine). The distance comes from the routing service when the
 * line opens. Takings are settled when the player collects the till (and before any
 * change to the line), through the ledger with a key per settlement.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, like } from 'drizzle-orm';
import { BUS_MODELS, BUSES, lineDay, samePair, tillFor, type BusLine, type BusModelId } from '@/lib/game/buses';
import { crowKm } from '@/lib/game/daily-route';
import { featureLive } from '@/lib/game/features';
import { playableCountries } from '@/lib/geo/scope';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, depots, jobState, users } from '@/server/db/schema';
import { configuredProvider, routeOpen } from '@/server/geo/routing';
import { fail } from './errors';
import { post } from './finance';
import { t } from '@/i18n/t';

const key = (id: string) => `bus-line:${id}`;

export async function allLines(db: DbOrTx): Promise<BusLine[]> {
  return (await db.select({ value: jobState.value }).from(jobState).where(like(jobState.key, 'bus-line:%'))).map((r) => r.value as BusLine);
}

async function account(db: DbOrTx, userId: string) {
  const [a] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  if (!a) fail('company_not_found', t('Компанията не е намерена.'), 404);
  return a!;
}

async function lockLine(tx: Tx, userId: string, lineId: string): Promise<BusLine> {
  const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(lineId))).for('update');
  const line = row?.value as BusLine | undefined;
  if (!line || line.ownerId !== userId) fail('no_line', t('Линията не е намерена.'), 404);
  return line!;
}

/** Settles the till up to now (the ledger and the line's totals); returns the line as settled. */
async function settle(tx: Tx, line: BusLine, now: Date): Promise<{ line: BusLine; cents: number; passengers: number }> {
  const rivals = (await allLines(tx)).filter((l) => l.id !== line.id && samePair(l, line));
  const till = tillFor(lineDay(line, rivals), (now.getTime() - new Date(line.collectedAt).getTime()) / 3_600_000);
  const next = { ...line, collectedAt: now.toISOString(), totalPassengers: line.totalPassengers + till.passengers, totalCents: line.totalCents + till.cents };
  if (till.cents !== 0) {
    const acc = await account(tx, line.ownerId);
    await post(tx, acc.id, [{ category: till.cents > 0 ? 'freight' : 'fuel', amountCents: till.cents, description: t('Автобусна линия {0} – {1} ({2} пътници)', line.from.name, line.to.name, till.passengers), idempotencyKey: `bus-till:${line.id}:${line.collectedAt}` }]);
  }
  await tx.update(jobState).set({ value: next, updatedAt: now }).where(eq(jobState.key, key(line.id)));
  return { line: next, cents: till.cents, passengers: till.passengers };
}

export interface NewLine { fromId: number; toId: number; model: BusModelId; departures: number; priceCents: number }

export async function buyBusLine(db: Database, userId: string, n: NewLine, now: Date) {
  if (!(n.model in BUS_MODELS)) fail('bad_model', t('Няма такъв автобус.'));
  if (!(BUSES.departures as readonly number[]).includes(n.departures)) fail('bad_departures', t('Курсовете са от 1 до 4 на ден.'));
  if (n.priceCents < BUSES.price.min || n.priceCents > BUSES.price.max) fail('bad_price', t('Билетът е от {0} до {1} лв. на 100 км.', BUSES.price.min / 100, BUSES.price.max / 100));
  const [u] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  if ((u?.level ?? 0) < BUSES.minLevel) fail('level', t('Автобусни линии — от ниво {0}.', BUSES.minLevel));
  const acc = await account(db, userId);
  const [depot] = await db.select({ id: depots.id }).from(depots).where(and(eq(depots.companyId, acc.id), eq(depots.cityId, n.fromId)));
  if (!depot) fail('no_depot', t('Линията тръгва от град, където имаш депо.'));
  const [from] = await db.select({ id: cities.id, name: cities.nameBg, country: cities.countryCode, population: cities.population, lat: cities.lat, lon: cities.lon }).from(cities).where(eq(cities.id, n.fromId));
  const [to] = await db.select({ id: cities.id, name: cities.nameBg, country: cities.countryCode, population: cities.population, lat: cities.lat, lon: cities.lon }).from(cities).where(eq(cities.id, n.toId));
  if (!from || !to || from.id === to.id) fail('city_not_found', t('Градът не е намерен.'), 404);
  if (!playableCountries(featureLive('europe', now), featureLive('open_world', now)).includes(to!.country)) fail('closed_country', t('Тази държава още не е отворена.'));
  const route = await routeOpen(configuredProvider(), { lat: from!.lat, lon: from!.lon, country: from!.country }, { lat: to!.lat, lon: to!.lon, country: to!.country }, 'van');
  const km = Math.round(route.distanceKm);
  if (km < BUSES.km[0] || km > BUSES.km[1]) fail('bad_distance', t('Линията трябва да е между {0} и {1} км (тази е {2} км).', BUSES.km[0], BUSES.km[1], km));
  return db.transaction(async (tx) => {
    const mine = (await allLines(tx)).filter((l) => l.ownerId === userId);
    if (mine.length >= BUSES.maxLines) fail('max_lines', t('Най-много {0} линии на играч.', BUSES.maxLines));
    if (mine.some((l) => samePair(l, { from: from!, to: to! }))) fail('same_line', t('Вече имаш линия между тези градове.'));
    const id = randomUUID();
    await post(tx, acc.id, [{ category: 'vehicle_purchase', amountCents: -BUS_MODELS[n.model].priceCents, description: t('Автобус {0} за линия {1} – {2}', BUS_MODELS[n.model].name, from!.name, to!.name), idempotencyKey: `bus-buy:${id}` }], { requireFunds: true });
    const line: BusLine = {
      id,
      ownerId: userId,
      model: n.model,
      from: { id: from!.id, name: from!.name, country: from!.country, population: from!.population },
      to: { id: to!.id, name: to!.name, country: to!.country, population: to!.population },
      km,
      departures: n.departures,
      priceCents: n.priceCents,
      comfort: 0,
      boughtAt: now.toISOString(),
      collectedAt: now.toISOString(),
      totalPassengers: 0,
      totalCents: 0,
    };
    await tx.insert(jobState).values({ key: key(id), value: line, updatedAt: now });
    return line;
  });
}

export async function collectBusLine(db: Database, userId: string, lineId: string, now: Date) {
  return db.transaction(async (tx) => {
    const s = await settle(tx, await lockLine(tx, userId, lineId), now);
    return { cents: s.cents, passengers: s.passengers };
  });
}

/** Changes the timetable or the ticket (the till is settled first, at the old terms). */
export async function setBusLine(db: Database, userId: string, lineId: string, change: { departures?: number; priceCents?: number }, now: Date) {
  if (change.departures !== undefined && !(BUSES.departures as readonly number[]).includes(change.departures)) fail('bad_departures', t('Курсовете са от 1 до 4 на ден.'));
  if (change.priceCents !== undefined && (change.priceCents < BUSES.price.min || change.priceCents > BUSES.price.max)) fail('bad_price', t('Билетът е от {0} до {1} лв. на 100 км.', BUSES.price.min / 100, BUSES.price.max / 100));
  return db.transaction(async (tx) => {
    const { line } = await settle(tx, await lockLine(tx, userId, lineId), now);
    await tx.update(jobState).set({ value: { ...line, ...change }, updatedAt: now }).where(eq(jobState.key, key(lineId)));
  });
}

export async function upgradeBusComfort(db: Database, userId: string, lineId: string, now: Date) {
  return db.transaction(async (tx) => {
    const { line } = await settle(tx, await lockLine(tx, userId, lineId), now);
    if (line.comfort >= BUSES.comfort.maxLevel) fail('max_comfort', t('Автобусът е с най-високия комфорт.'));
    const cost = BUSES.comfort.costCents[line.comfort] ?? 0;
    const acc = await account(tx, userId);
    if (cost) await post(tx, acc.id, [{ category: 'upgrades', amountCents: -cost, description: t('Комфорт {0} за линия {1} – {2}', line.comfort + 1, line.from.name, line.to.name), idempotencyKey: `bus-comfort:${line.id}:${line.comfort + 1}` }], { requireFunds: true });
    await tx.update(jobState).set({ value: { ...line, comfort: line.comfort + 1 }, updatedAt: now }).where(eq(jobState.key, key(lineId)));
    return line.comfort + 1;
  });
}

export async function sellBusLine(db: Database, userId: string, lineId: string, now: Date) {
  return db.transaction(async (tx) => {
    const { line } = await settle(tx, await lockLine(tx, userId, lineId), now);
    const back = Math.round(BUS_MODELS[line.model].priceCents * BUSES.sellBack);
    const acc = await account(tx, userId);
    await post(tx, acc.id, [{ category: 'vehicle_sale', amountCents: back, description: t('Продаден автобус от линия {0} – {1}', line.from.name, line.to.name), idempotencyKey: `bus-sell:${line.id}` }]);
    await tx.delete(jobState).where(eq(jobState.key, key(lineId)));
    return back;
  });
}

/** The page: my lines (today's estimate and the till), and the routes I can open from my depot cities. */
export async function busesView(db: DbOrTx, userId: string, now: Date) {
  const all = await allLines(db);
  const lines = all
    .filter((l) => l.ownerId === userId)
    .map((l) => {
      const rivals = all.filter((r) => r.id !== l.id && samePair(r, l));
      const day = lineDay(l, rivals);
      return { ...l, day, rivals: rivals.length, till: tillFor(day, (now.getTime() - new Date(l.collectedAt).getTime()) / 3_600_000) };
    });
  const acc = await account(db, userId);
  const homes = await db.select({ id: cities.id, name: cities.nameBg, lat: cities.lat, lon: cities.lon }).from(depots).innerJoin(cities, eq(cities.id, depots.cityId)).where(eq(depots.companyId, acc.id));
  const lands = playableCountries(featureLive('europe', now), featureLive('open_world', now));
  const big = homes.length ? await db.select({ id: cities.id, name: cities.nameBg, country: cities.countryCode, population: cities.population, lat: cities.lat, lon: cities.lon }).from(cities).where(and(gte(cities.population, 100_000), inArray(cities.countryCode, [...lands]))).orderBy(desc(cities.population)).limit(600) : [];
  // Road distance is ~1.25× the straight line; the exact one comes when the line opens.
  const routes = homes.flatMap((h) =>
    big
      .filter((c) => c.id !== h.id && /[а-яА-Я]/.test(c.name))
      .map((c) => ({ from: h, to: c, approxKm: Math.round(crowKm(h, c) * 1.25) }))
      .filter((r) => r.approxKm >= BUSES.km[0] && r.approxKm <= BUSES.km[1])
      .slice(0, 10),
  );
  return { lines, routes };
}
