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
  cannotTake, LOCOS, ordersAt, payFor, RAIL_TERMINALS, railLine, runCost, terminal, trainLimits, TRAINS, WAGONS, wagonCount, wagonsFor, wagonsValue,
  type LocoId, type Train, type TrainOrder, type WagonType,
} from '@/lib/game/trains';
import { countryOpen } from '@/lib/geo/scope';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, jobState, users } from '@/server/db/schema';
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
  await notify(tx, train.ownerId, 'success', () => t('🚆 Влакът пристигна в {0}', place(to)), () => (run.payCents ? t('{0} т {1} са разтоварени. Получи {2} лв.', run.tons, place(run.goods ?? ''), Math.round(run.payCents / 100)) : t('Влакът чака нов товар на гарата.')), '/game/trains');
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
  diesel_only: () => t('Линията не е електрифицирана — трябва дизелов локомотив.'),
  wagons: () => t('Влакът няма достатъчно вагони от този вид.'),
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
    return depart(tx, train, order!, company, now);
  });
}

/** Sends the train empty to the other end of a line (to find loads there). */
export async function moveTrain(db: Database, userId: string, trainId: string, lineId: string, now: Date) {
  const company = await inCompany(db, userId);
  return db.transaction(async (tx) => {
    const train = await finishRun(tx, await lockTrain(tx, userId, trainId), now);
    if (train.run) fail('busy', reasonText('busy'));
    const line = railLine(lineId);
    if (!line || (line.a !== train.at && line.b !== train.at)) fail('no_line', t('Няма такава линия от тази гара.'));
    const to = line!.a === train.at ? line!.b : line!.a;
    if (!openAt(now)(terminal(to)!.country)) fail('closed_country', t('Тази държава още не е отворена.'));
    if (LOCOS[train.loco].electric && !line!.electric) fail('diesel_only', reasonText('diesel_only'));
    return depart(tx, train, null, company, now, { lineId: line!.id, to, km: line!.km, hours: line!.hours });
  });
}

async function depart(tx: Tx, train: Train, order: TrainOrder | null, company: boolean, now: Date, empty?: { lineId: string; to: number; km: number; hours: number }) {
  const km = order?.km ?? empty!.km;
  const hours = order?.hours ?? empty!.hours;
  const cost = runCost(train.loco, km, !!order, company);
  const acc = await account(tx, train.ownerId);
  const from = tx_(terminal(train.at)?.name), to = tx_(terminal(order?.to ?? empty!.to)?.name);
  await post(tx, acc.id, [
    { category: 'tolls', amountCents: -cost.track, description: t('Такса за жп линия {0} → {1}', from, to), idempotencyKey: `train-track:${train.id}:${now.getTime()}` },
    { category: 'fuel', amountCents: -cost.energy, description: t('Енергия за влака {0} → {1}', from, to), idempotencyKey: `train-energy:${train.id}:${now.getTime()}` },
  ], { requireFunds: true });
  const run = {
    lineId: order?.lineId ?? empty!.lineId,
    from: train.at,
    to: order?.to ?? empty!.to,
    departAt: now.toISOString(),
    arriveAt: new Date(now.getTime() + hours * 3_600_000).toISOString(),
    orderId: order?.id ?? null,
    wagonType: order?.wagonType ?? null,
    goods: order?.goods ?? null,
    tons: order?.tons ?? 0,
    payCents: order ? payFor(order, company) : 0,
    costCents: cost.total,
  };
  const next: Train = { ...train, run };
  await save(tx, next, now);
  return next;
}
const tx_ = (name: string | undefined) => place(name ?? '');

/** The page: my trains (with the board at each one's terminal) and what I may buy. */
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
    orders: tr.run ? [] : ordersAt(tr.at, now.getTime(), open).map((o) => {
      const why = taken.has(o.id) ? 'order_taken' : cannotTake(tr, o);
      const cost = runCost(tr.loco, o.km, true, company);
      return { ...o, pay: payFor(o, company), cost: cost.total, need: wagonsFor(o.wagonType, o.tons), why };
    }).sort((a, b) => Number(!!a.why) - Number(!!b.why) || b.pay - b.cost - (a.pay - a.cost)),
  }));
  return { trains, company, limits: lim, terminals: RAIL_TERMINALS.filter((x) => open(x.country)) };
}
