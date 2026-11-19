/**
 * 1.3.3 „Жп линия“ on the server. Each train lives in job_state under
 * `train:<id>` (a Train); a taken order under `train-order:<order id>` (the
 * unique key keeps an order to one train). Money moves through the ledger: the
 * purchase, the track and the energy at the departure, the pay on arrival
 * (`settleTrains`, from the worker and before any view or change).
 */
import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import {
  cannotTake, grossFor, LOCOS, ordersAt, pathsFrom, payFor, pullOver, RAIL_LINES, RAIL_TERMINALS, runCost, runLegs, terminal, trainLimits, TRAINS, WAGONS, wagonCount, wagonsFor, wagonsValue,
  type LocoId, type RailPath, type Train, type TrainOrder, type TrainRun, type WagonType,
} from '@/lib/game/trains';
import { countryOpen } from '@/lib/geo/scope';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, jobState, users } from '@/server/db/schema';
import { fail } from './errors';
import { post } from './finance';
import { membershipOf } from './membership';
import { notify } from './notify';
import { t, tx as place } from '@/i18n/t';

const key = (id: string) => `train:${id}`;
const orderKey = (id: string) => `train-order:${id}`;

const openAt = (now: Date) => (c: string) => countryOpen(c, featureLive('europe', now), featureLive('open_world', now));

export async function allTrains(db: DbOrTx): Promise<Train[]> {
  return (await db.select({ value: jobState.value }).from(jobState).where(like(jobState.key, 'train:%'))).map((r) => r.value as Train);
}

async function account(db: DbOrTx, userId: string) {
  const [a] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  if (!a) fail('company_not_found', t('Компанията не е намерена.'), 404);
  return a!;
}

const inCompany = async (db: DbOrTx, userId: string) => !!(await membershipOf(db, userId));

async function lockTrain(tx: Tx, userId: string, trainId: string): Promise<Train> {
  const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(trainId))).for('update');
  const train = row?.value as Train | undefined;
  if (!train || train.ownerId !== userId) fail('no_train', t('Влакът не е намерен.'), 404);
  return train!;
}

const save = (tx: Tx, train: Train, now: Date) => tx.update(jobState).set({ value: train, updatedAt: now }).where(eq(jobState.key, key(train.id)));

/** Pays a finished run and puts the train at its destination (inside a transaction, the train locked). */
async function finishRun(tx: Tx, train: Train, now: Date): Promise<Train> {
  const run = train.run;
  if (!run || new Date(run.arriveAt) > now) return train;
  if (run.payCents > 0) {
    const acc = await account(tx, train.ownerId);
    await post(tx, acc.id, [{ category: 'freight', amountCents: run.payCents, description: t('Влак {0} → {1}: {2} т {3}', place(terminal(run.from)?.name ?? ''), place(terminal(run.to)?.name ?? ''), run.tons, place(run.goods ?? '')), idempotencyKey: `train-run:${train.id}:${run.departAt}` }]);
  }
  const next: Train = { ...train, at: run.to, run: null, runs: train.runs + (run.orderId ? 1 : 0), tons: train.tons + run.tons, earnedCents: train.earnedCents + run.payCents };
  await save(tx, next, now);
  const to = terminal(run.to)?.name ?? '';
  await notify(tx, train.ownerId, 'success', () => t('🚆 Влакът пристигна в {0}', place(to)), () => (run.payCents ? t('{0} т {1} са разтоварени. Получи {2} лв.', run.tons, place(run.goods ?? ''), Math.round(run.payCents / 100)) : t('Влакът чака нов товар на гарата.')), '/game/contracts/trains');
  return next;
}

/** Settles every train that arrived by now (the worker; also before a player's view). */
export async function settleTrains(db: Database, now = new Date(), ownerId?: string) {
  const due = (await allTrains(db)).filter((tr) => tr.run && new Date(tr.run.arriveAt) <= now && (!ownerId || tr.ownerId === ownerId));
  for (const d of due) {
    await db.transaction(async (tx) => finishRun(tx, await lockTrain(tx, d.ownerId, d.id), now));
  }
  return due.length;
}

export async function buyTrain(db: Database, userId: string, n: { loco: LocoId; wagonType: WagonType; wagons: number; terminalId: number }, now: Date) {
  if (!(n.loco in LOCOS)) fail('bad_loco', t('Няма такъв локомотив.'));
  if (!(n.wagonType in WAGONS)) fail('bad_wagon', t('Няма такъв вагон.'));
  const loco = LOCOS[n.loco];
  if (!Number.isInteger(n.wagons) || n.wagons < TRAINS.minWagons || n.wagons > loco.maxWagons) fail('bad_wagons', t('Вагоните са от {0} до {1} за този локомотив.', TRAINS.minWagons, loco.maxWagons));
  const term = terminal(n.terminalId);
  if (!term || !openAt(now)(term.country)) fail('bad_terminal', t('Няма такава товарна гара.'));
  const company = await inCompany(db, userId);
  const lim = trainLimits(company);
  const [u] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  if ((u?.level ?? 0) < lim.minLevel) fail('level', t('Влаковете са от ниво {0}.', lim.minLevel));
  const acc = await account(db, userId);
  return db.transaction(async (tx) => {
    // One purchase at a time per player (the count below must not race).
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, acc.id)).for('update');
    const mine = (await allTrains(tx)).filter((tr) => tr.ownerId === userId);
    if (mine.length >= lim.maxTrains) fail('max_trains', t('Най-много {0} влака на играч.', lim.maxTrains));
    const id = randomUUID();
    const wagons = { [n.wagonType]: n.wagons };
    const price = loco.priceCents + wagonsValue(wagons);
    await post(tx, acc.id, [{ category: 'vehicle_purchase', amountCents: -price, description: t('Влак: {0} и {1} × {2}', loco.name, n.wagons, place(WAGONS[n.wagonType].name)), idempotencyKey: `train-buy:${id}` }], { requireFunds: true });
    const train: Train = { id, ownerId: userId, loco: n.loco, wagons, at: term!.id, run: null, boughtAt: now.toISOString(), runs: 0, tons: 0, earnedCents: 0 };
    await tx.insert(jobState).values({ key: key(id), value: train, updatedAt: now });
    return train;
  });
}

export async function addWagons(db: Database, userId: string, trainId: string, type: WagonType, count: number, now: Date) {
  if (!(type in WAGONS)) fail('bad_wagon', t('Няма такъв вагон.'));
  if (!Number.isInteger(count) || count < 1) fail('bad_wagons', t('Поне един вагон.'));
  return db.transaction(async (tx) => {
    const train = await finishRun(tx, await lockTrain(tx, userId, trainId), now);
    if (train.run) fail('busy', t('Влакът е на път. Вагоните се закачат на гарата.'));
    const max = LOCOS[train.loco].maxWagons;
    if (wagonCount(train.wagons) + count > max) fail('bad_wagons', t('Локомотивът тегли най-много {0} вагона.', max));
    const acc = await account(tx, userId);
    await post(tx, acc.id, [{ category: 'vehicle_purchase', amountCents: -count * WAGONS[type].priceCents, description: t('{0} × {1} за влака', count, place(WAGONS[type].name)), idempotencyKey: `train-wagons:${train.id}:${now.getTime()}` }], { requireFunds: true });
    const next = { ...train, wagons: { ...train.wagons, [type]: (train.wagons[type] ?? 0) + count } };
    await save(tx, next, now);
    return next;
  });
}

export async function sellWagons(db: Database, userId: string, trainId: string, type: WagonType, count: number, now: Date) {
  if (!(type in WAGONS)) fail('bad_wagon', t('Няма такъв вагон.'));
  return db.transaction(async (tx) => {
    const train = await finishRun(tx, await lockTrain(tx, userId, trainId), now);
    if (train.run) fail('busy', t('Влакът е на път. Вагоните се откачат на гарата.'));
    const have = train.wagons[type] ?? 0;
    if (!Number.isInteger(count) || count < 1 || count > have) fail('bad_wagons', t('Влакът няма толкова такива вагони.'));
    if (wagonCount(train.wagons) - count < 1) fail('bad_wagons', t('Влакът трябва да има поне един вагон. Продай целия влак.'));
    const back = Math.round(count * WAGONS[type].priceCents * TRAINS.sellBack);
    const acc = await account(tx, userId);
    await post(tx, acc.id, [{ category: 'vehicle_sale', amountCents: back, description: t('Продадени {0} × {1}', count, place(WAGONS[type].name)), idempotencyKey: `train-wagons-sell:${train.id}:${now.getTime()}` }]);
    const wagons = { ...train.wagons, [type]: have - count };
    if (!wagons[type]) delete wagons[type];
    await save(tx, { ...train, wagons }, now);
    return back;
  });
}

export async function sellTrain(db: Database, userId: string, trainId: string, now: Date) {
  return db.transaction(async (tx) => {
    const train = await finishRun(tx, await lockTrain(tx, userId, trainId), now);
    if (train.run) fail('busy', t('Влакът е на път. Продава се, когато е на гара.'));
    const back = Math.round((LOCOS[train.loco].priceCents + wagonsValue(train.wagons)) * TRAINS.sellBack);
    const acc = await account(tx, userId);
    await post(tx, acc.id, [{ category: 'vehicle_sale', amountCents: back, description: t('Продаден влак {0}', LOCOS[train.loco].name), idempotencyKey: `train-sell:${train.id}` }]);
    await tx.delete(jobState).where(eq(jobState.key, key(train.id)));
    return back;
  });
}

const REASONS: Record<string, () => string> = {
  busy: () => t('Влакът е на път.'),
  elsewhere: () => t('Влакът не е на тази гара.'),
  diesel_only: () => t('По пътя има линия без ток — трябва дизелов локомотив.'),
  wagons: () => t('Влакът няма достатъчно вагони от този вид.'),
  too_heavy: () => t('Влакът е твърде тежък за локомотива по тези линии. Махни вагони или вземи по-силен локомотив.'),
};
export const reasonText = (code: string) => REASONS[code]?.() ?? code;

/** Takes an order from the board at the train's terminal and sends the train. */
export async function sendTrain(db: Database, userId: string, trainId: string, orderId: string, now: Date) {
  const company = await inCompany(db, userId);
  return db.transaction(async (tx) => {
    const train = await finishRun(tx, await lockTrain(tx, userId, trainId), now);
    const order = ordersAt(train.at, now.getTime(), openAt(now)).find((o) => o.id === orderId);
    if (!order) fail('no_order', t('Поръчката вече не е на борсата.'), 404);
    const why = cannotTake(train, order!);
    if (why) fail(why, reasonText(why));
    const taken = await tx.insert(jobState).values({ key: orderKey(order!.id), value: { trainId: train.id, userId, at: now.toISOString() }, updatedAt: now }).onConflictDoNothing().returning({ key: jobState.key });
    if (!taken.length) fail('order_taken', t('Друг влак вече взе тази поръчка.'));
    return depart(tx, train, order!, order!, company, now);
  });
}

/** Where a train can go empty from its terminal (the quickest way through the open countries, by its locomotive). */
export const emptyRoutes = (train: Pick<Train, 'at' | 'loco'>, now: Date) => [...pathsFrom(train.at, openAt(now), LOCOS[train.loco].electric).values()].sort((a, b) => a.km - b.km);

/** Sends the train empty to another terminal (to find loads there). */
export async function moveTrain(db: Database, userId: string, trainId: string, to: number, now: Date) {
  const company = await inCompany(db, userId);
  return db.transaction(async (tx) => {
    const train = await finishRun(tx, await lockTrain(tx, userId, trainId), now);
    if (train.run) fail('busy', reasonText('busy'));
    const path = emptyRoutes(train, now).find((p) => p.to === to);
    if (!path) fail('no_route', LOCOS[train.loco].electric && pathsFrom(train.at, openAt(now)).has(to) ? reasonText('diesel_only') : t('Няма жп път дотам.'));
    if (grossFor(train, 0) > pullOver(train.loco, path!)) fail('too_heavy', reasonText('too_heavy'));
    return depart(tx, train, path!, null, company, now);
  });
}

/** What a run would cost and take for this train (the order's load, or empty). */
export function planRun(train: Pick<Train, 'loco' | 'wagons'>, path: RailPath, cargoTons: number, company: boolean, start: number) {
  const gross = grossFor(train, cargoTons);
  const legs = runLegs(path, train.loco, gross, start);
  const cost = runCost(train.loco, path, gross, company);
  return { gross, legs, cost, hours: ((legs[legs.length - 1]?.end ?? start) - start) / 3_600_000, limit: pullOver(train.loco, path) };
}

async function depart(tx: Tx, train: Train, path: RailPath, order: TrainOrder | null, company: boolean, now: Date) {
  const plan = planRun(train, path, order?.tons ?? 0, company, now.getTime());
  const acc = await account(tx, train.ownerId);
  const from = tx_(terminal(path.from)?.name), to = tx_(terminal(path.to)?.name);
  await post(tx, acc.id, [
    { category: 'tolls', amountCents: -plan.cost.track, description: t('Такса за жп линия {0} → {1}', from, to), idempotencyKey: `train-track:${train.id}:${now.getTime()}` },
    { category: 'fuel', amountCents: -plan.cost.energy, description: t('Енергия за влака {0} → {1}', from, to), idempotencyKey: `train-energy:${train.id}:${now.getTime()}` },
  ], { requireFunds: true });
  const run: TrainRun = {
    lines: path.lines,
    stops: path.stops,
    from: path.from,
    to: path.to,
    departAt: now.toISOString(),
    arriveAt: new Date(plan.legs[plan.legs.length - 1]!.end).toISOString(),
    legs: plan.legs,
    orderId: order?.id ?? null,
    wagonType: order?.wagonType ?? null,
    goods: order?.goods ?? null,
    tons: order?.tons ?? 0,
    grossTons: plan.gross,
    payCents: order ? payFor(order, company) : 0,
    costCents: plan.cost.total,
  };
  const next: Train = { ...train, run };
  await save(tx, next, now);
  return next;
}
const tx_ = (name: string | undefined) => place(name ?? '');

/** The page: my trains (with the board at each one's terminal) and what I may buy. */
export type TrainsView = Awaited<ReturnType<typeof trainsView>>;

export async function trainsView(db: Database, userId: string, now: Date) {
  await settleTrains(db, now, userId);
  const company = await inCompany(db, userId);
  const lim = trainLimits(company);
  const open = openAt(now);
  const mine = (await allTrains(db)).filter((tr) => tr.ownerId === userId).sort((a, b) => a.boughtAt.localeCompare(b.boughtAt));
  const ids = [...new Set(mine.filter((tr) => !tr.run).flatMap((tr) => ordersAt(tr.at, now.getTime(), open).map((o) => orderKey(o.id))))];
  const taken = new Set(ids.length ? (await db.select({ key: jobState.key }).from(jobState).where(inArray(jobState.key, ids))).map((r) => r.key.slice('train-order:'.length)) : []);
  const trains = mine.map((tr) => ({
    ...tr,
    empty: tr.run ? [] : emptyRoutes(tr, now).filter((p) => p.stops.length <= 4).map((p) => ({ ...p, ...planRun(tr, p, 0, company, now.getTime()) })),
    orders: tr.run ? [] : ordersAt(tr.at, now.getTime(), open).map((o) => {
      const why = taken.has(o.id) ? 'order_taken' : cannotTake(tr, o);
      const plan = planRun(tr, o, o.tons, company, now.getTime());
      return { ...o, pay: payFor(o, company), cost: plan.cost.total, hours: plan.hours, gross: plan.gross, limit: plan.limit, need: wagonsFor(o.wagonType, o.tons), why };
    }).sort((a, b) => Number(!!a.why) - Number(!!b.why) || b.pay - b.cost - (a.pay - a.cost)),
  }));
  return { trains, company, limits: lim, terminals: RAIL_TERMINALS.filter((x) => open(x.country)) };
}

export interface RailMap {
  lines: { id: string; electric: boolean; coords: [number, number][] }[];
  terminals: { id: number; name: string; position: [number, number] }[];
  trains: { id: string; label: string; at: number; run: TrainRun | null }[];
}

/** 1.3.3: the rail layer of the live map — the lines through their real towns, the terminals and my trains. */
export async function railMap(db: DbOrTx, userId: string, now: Date): Promise<RailMap> {
  const open = openAt(now);
  const ids = [...new Set([...RAIL_TERMINALS.map((x) => x.id), ...RAIL_LINES.flatMap((l) => l.via)])];
  const rows = await db.select({ id: cities.id, lat: cities.lat, lon: cities.lon }).from(cities).where(inArray(cities.id, ids));
  const at = new Map(rows.map((r) => [r.id, [r.lat, r.lon] as [number, number]]));
  const lines = RAIL_LINES.filter((l) => open(terminal(l.a)!.country) && open(terminal(l.b)!.country)).map((l) => ({ id: l.id, electric: l.electric, coords: [l.a, ...l.via, l.b].flatMap((id) => (at.has(id) ? [at.get(id)!] : [])) }));
  const terminals = RAIL_TERMINALS.filter((x) => open(x.country) && at.has(x.id)).map((x) => ({ id: x.id, name: x.name, position: at.get(x.id)! }));
  const trains = (await allTrains(db)).filter((tr) => tr.ownerId === userId).map((tr) => ({ id: tr.id, label: LOCOS[tr.loco].name, at: tr.at, run: tr.run }));
  return { lines, terminals, trains };
}
