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
  cannotTake, grossFor, hireFee, lineFits, LOCOS, rentalFor, ordersAt, pathsFrom, payFor, pullOver, RAIL_LINES, RAIL_TERMINALS, runCost, runLegs, terminal, trainLimits, TRAINS, WAGONS, wagonCount, wagonsFor, wagonsValue,
  type LocoId, type RailPath, type Train, type TrainLine, type TrainOrder, type TrainRun, type WagonType,
} from '@/lib/game/trains';
import { countryOpen } from '@/lib/geo/scope';
import { LICENCES, missingLicences, railLicences, type LicenceId } from '@/lib/game/licences';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, jobState, users } from '@/server/db/schema';
import { fail } from './errors';
import { post } from './finance';
import { membershipOf } from './membership';
import { notify } from './notify';
import { heldLicences } from './licences';
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

/** The countries a run passes (its terminals), for the licences it needs. */
const pathCountries = (stops: readonly number[]) => [...new Set(stops.map((id) => terminal(id)?.country).filter((c): c is string => !!c))];
const licenceNames = (ids: readonly LicenceId[]) => ids.map((id) => place(LICENCES[id].label)).join(', ');
function needLicences(held: ReadonlySet<string>, stops: readonly number[]) {
  const missing = missingLicences(railLicences(pathCountries(stops)), held);
  if (missing.length) fail('licence', t('Нужен е лиценз: {0} (Автопарк → Лицензи).', licenceNames(missing)));
}

const inCompany = async (db: DbOrTx, userId: string) => !!(await membershipOf(db, userId));
const vipOf = async (db: DbOrTx, userId: string) => (await db.select({ v: users.vipLevel }).from(users).where(eq(users.id, userId)))[0]?.v ?? 0;

async function lockAny(tx: Tx, trainId: string): Promise<Train | undefined> {
  const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(trainId))).for('update');
  return row?.value as Train | undefined;
}

async function lockTrain(tx: Tx, userId: string, trainId: string): Promise<Train> {
  const train = await lockAny(tx, trainId);
  if (!train || train.ownerId !== userId || train.rental) fail('no_train', t('Влакът не е намерен.'), 404);
  return train!;
}

const save = (tx: Tx, train: Train, now: Date) => tx.update(jobState).set({ value: train, updatedAt: now }).where(eq(jobState.key, key(train.id)));

/** Pays a finished run and puts the train at its destination (inside a transaction, the train locked). */
async function finishRun(tx: Tx, train: Train, now: Date): Promise<Train> {
  const run = train.run;
  if (!run || new Date(run.arriveAt) > now) return train;
  // A hired run pays the player who hired the train; the owner already has the fee.
  const payee = run.hirerId ?? train.ownerId;
  if (run.payCents > 0) {
    const acc = await account(tx, payee);
    await post(tx, acc.id, [{ category: 'freight', amountCents: run.payCents, description: t('Влак {0} → {1}: {2} т {3}', place(terminal(run.from)?.name ?? ''), place(terminal(run.to)?.name ?? ''), run.tons, place(run.goods ?? '')), idempotencyKey: `train-run:${train.id}:${run.departAt}` }]);
  }
  const next: Train = { ...train, at: run.to, run: null, runs: train.runs + (run.orderId ? 1 : 0), tons: train.tons + run.tons, earnedCents: train.earnedCents + (run.hirerId ? (run.hireFeeCents ?? 0) : run.payCents), idleSince: run.arriveAt };
  if (train.rental) await tx.delete(jobState).where(eq(jobState.key, key(train.id)));
  else await save(tx, next, now);
  const to = terminal(run.to)?.name ?? '';
  // 1.3.3: the owner's notification opens the train and offers „Пусни пак“ (the regular line goes on by itself).
  const own = !run.hirerId && !train.rental;
  const line = own && train.line?.on;
  await notify(tx, payee, 'success', () => t('🚆 Влакът пристигна в {0}', place(to)), () => `${run.payCents ? t('{0} т {1} са разтоварени. Получи {2} лв.', run.tons, place(run.goods ?? ''), Math.round(run.payCents / 100)) : t('Влакът чака нов товар на гарата.')}${line ? ` ${t('Редовната линия го пуска отново.')}` : ''}`, own ? `/game/trains?train=${train.id}${line ? '' : `&trainAgain=${train.id}`}` : '/game/contracts/trains');
  if (run.hirerId) await notify(tx, train.ownerId, 'info', () => t('🚆 Наетият ти влак пристигна в {0}', place(to)), () => t('Влакът е свободен на гарата.'), '/game/trains');
  return next;
}

/** Settles every train that arrived by now (the worker; also before a player's view). */
export async function settleTrains(db: Database, now = new Date(), ownerId?: string) {
  const due = (await allTrains(db)).filter((tr) => tr.run && new Date(tr.run.arriveAt) <= now && (!ownerId || tr.ownerId === ownerId || tr.run.hirerId === ownerId));
  for (const d of due) {
    await db.transaction(async (tx) => {
      const train = await lockAny(tx, d.id);
      if (train) await finishRun(tx, train, now);
    });
  }
  return due.length;
}

/** 1.3.3: buys a locomotive alone (no wagons); the wagons are bought for it one kind at a time (`addWagons`). */
export async function buyTrain(db: Database, userId: string, n: { loco: LocoId; terminalId: number }, now: Date) {
  if (!(n.loco in LOCOS)) fail('bad_loco', t('Няма такъв локомотив.'));
  const loco = LOCOS[n.loco];
  const term = terminal(n.terminalId);
  if (!term || !openAt(now)(term.country)) fail('bad_terminal', t('Няма такава товарна гара.'));
  const company = await inCompany(db, userId);
  const [u] = await db.select({ level: users.level, vip: users.vipLevel }).from(users).where(eq(users.id, userId));
  const lim = trainLimits(company, u?.vip ?? 0);
  if (!lim.vip) fail('vip_level', t('Собствен влак е от VIP{0}. Дотогава наемай влак за поръчката (Курсове → Влакове).', TRAINS.vipLevel));
  if ((u?.level ?? 0) < lim.minLevel) fail('level', t('Влаковете са от ниво {0}.', lim.minLevel));
  if (!(await heldLicences(db, userId)).has('rail')) fail('licence', t('Нужен е лиценз: {0} (Автопарк → Лицензи).', place(LICENCES.rail.label)));
  const acc = await account(db, userId);
  return db.transaction(async (tx) => {
    // One purchase at a time per player (the count below must not race).
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, acc.id)).for('update');
    const mine = (await allTrains(tx)).filter((tr) => tr.ownerId === userId && !tr.rental);
    if (mine.length >= lim.maxTrains) fail('max_trains', t('Най-много {0} влака на играч.', lim.maxTrains));
    const id = randomUUID();
    await post(tx, acc.id, [{ category: 'vehicle_purchase', amountCents: -loco.priceCents, description: t('Локомотив {0}', loco.name), idempotencyKey: `train-buy:${id}` }], { requireFunds: true });
    const train: Train = { id, ownerId: userId, loco: n.loco, wagons: {}, at: term!.id, run: null, boughtAt: now.toISOString(), runs: 0, tons: 0, earnedCents: 0 };
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
  const held = await heldLicences(db, userId);
  return db.transaction(async (tx) => {
    const train = await finishRun(tx, await lockTrain(tx, userId, trainId), now);
    const order = ordersAt(train.at, now.getTime(), openAt(now)).find((o) => o.id === orderId);
    if (!order) fail('no_order', t('Поръчката вече не е на борсата.'), 404);
    const why = cannotTake(train, order!);
    if (why) fail(why, reasonText(why));
    needLicences(held, order!.stops);
    const taken = await tx.insert(jobState).values({ key: orderKey(order!.id), value: { trainId: train.id, userId, at: now.toISOString() }, updatedAt: now }).onConflictDoNothing().returning({ key: jobState.key });
    if (!taken.length) fail('order_taken', t('Друг влак вече взе тази поръчка.'));
    return depart(tx, train, order!, order!, company, now);
  });
}

/** The best order for this train at its terminal (by pay less cost), among those `fits` lets through; null when none. */
async function bestOrder(db: DbOrTx, train: Train, held: ReadonlySet<string>, company: boolean, now: Date, fits: (o: TrainOrder) => boolean = () => true) {
  const orders = ordersAt(train.at, now.getTime(), openAt(now)).filter((o) => fits(o) && !cannotTake({ ...train, run: null }, o) && !missingLicences(railLicences(pathCountries(o.stops)), held).length);
  if (!orders.length) return null;
  const taken = new Set((await db.select({ key: jobState.key }).from(jobState).where(inArray(jobState.key, orders.map((o) => orderKey(o.id))))).map((r) => r.key.slice('train-order:'.length)));
  const value = (o: TrainOrder) => payFor(o, company) - planRun(train, o, o.tons, company, now.getTime()).cost.total;
  return orders.filter((o) => !taken.has(o.id) && value(o) > 0).sort((a, b) => value(b) - value(a))[0] ?? null;
}

/**
 * 1.3.3: sends the train on the best order at its terminal that fits (the
 * regular line, and „Пусни пак“ from a notification). Fails with `no_order`
 * when there is none.
 */
export async function sendBest(db: Database, userId: string, trainId: string, now: Date, fits?: (o: TrainOrder) => boolean) {
  const company = await inCompany(db, userId);
  const held = await heldLicences(db, userId);
  return db.transaction(async (tx) => {
    const train = await finishRun(tx, await lockTrain(tx, userId, trainId), now);
    if (train.run) fail('busy', reasonText('busy'));
    const order = await bestOrder(tx, train, held, company, now, fits);
    if (!order) fail('no_order', t('Сега на гарата няма подходяща поръчка за този влак.'));
    const taken = await tx.insert(jobState).values({ key: orderKey(order!.id), value: { trainId: train.id, userId, at: now.toISOString() }, updatedAt: now }).onConflictDoNothing().returning({ key: jobState.key });
    if (!taken.length) fail('order_taken', t('Друг влак вече взе тази поръчка.'));
    return depart(tx, train, order!, order!, company, now);
  });
}

/** 1.3.3: the owner sets the regular line (null turns it off). The ends must be open terminals the train's network reaches. */
export async function setTrainLine(db: Database, userId: string, trainId: string, line: Omit<TrainLine, 'on'> | null, now: Date) {
  if (line) {
    for (const id of [line.home, line.far]) if (id !== null && (!terminal(id) || !openAt(now)(terminal(id)!.country))) fail('bad_terminal', t('Няма такава товарна гара.'));
    if (line.far === line.home) fail('bad_line', t('Двата края на линията трябва да са различни гари.'));
    if (line.wagonType && !(line.wagonType in WAGONS)) fail('bad_wagon', t('Няма такъв вагон.'));
  }
  return db.transaction(async (tx) => {
    const train = await lockTrain(tx, userId, trainId);
    const next: Train = { ...train, line: line ? { ...line, on: true } : null };
    await save(tx, next, now);
    return next;
  });
}

/**
 * 1.3.3: the worker runs the regular lines — every free train with a line takes
 * the best fitting order at its terminal; with nothing there for a whole board
 * window it goes empty to the other end (when the line says so). Money short or
 * no order: it waits for the next try.
 */
export async function runLines(db: Database, now = new Date()) {
  let sent = 0;
  for (const tr of (await allTrains(db)).filter((x) => x.line?.on && !x.rental && (!x.run || new Date(x.run.arriveAt) <= now))) {
    const line = tr.line!;
    try {
      await sendBest(db, tr.ownerId, tr.id, now, (o) => lineFits(line, tr.run?.to ?? tr.at, o));
      sent++;
    } catch (e) {
      const at = tr.run?.to ?? tr.at;
      const waited = tr.idleSince ? now.getTime() - new Date(tr.idleSince).getTime() : 0;
      const other = at === line.home ? line.far : line.home;
      if (line.emptyBack && other !== null && other !== at && waited >= TRAINS.windowHours * 3_600_000 && (e as { code?: string }).code === 'no_order') {
        await moveTrain(db, tr.ownerId, tr.id, other, now).then(() => sent++, () => undefined);
      }
    }
  }
  return sent;
}

/** Where a train can go empty from its terminal (the quickest way through the open countries, by its locomotive). */
export const emptyRoutes = (train: Pick<Train, 'at' | 'loco'>, now: Date) => [...pathsFrom(train.at, openAt(now), LOCOS[train.loco].electric).values()].sort((a, b) => a.km - b.km);

/** Sends the train empty to another terminal (to find loads there). */
export async function moveTrain(db: Database, userId: string, trainId: string, to: number, now: Date) {
  const company = await inCompany(db, userId);
  const held = await heldLicences(db, userId);
  return db.transaction(async (tx) => {
    const train = await finishRun(tx, await lockTrain(tx, userId, trainId), now);
    if (train.run) fail('busy', reasonText('busy'));
    const path = emptyRoutes(train, now).find((p) => p.to === to);
    if (!path) fail('no_route', LOCOS[train.loco].electric && pathsFrom(train.at, openAt(now)).has(to) ? reasonText('diesel_only') : t('Няма жп път дотам.'));
    if (grossFor(train, 0) > pullOver(train.loco, path!)) fail('too_heavy', reasonText('too_heavy'));
    needLicences(held, path!.stops);
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

/** How a hired run is paid: by `payerId`, with `feeCents` for the train (to `ownerId`, or to the game). */
interface Hire { payerId: string; feeCents: number; ownerId: string | null }

async function depart(tx: Tx, train: Train, path: RailPath, order: TrainOrder | null, company: boolean, now: Date, hire?: Hire) {
  const plan = planRun(train, path, order?.tons ?? 0, company, now.getTime());
  const acc = await account(tx, hire?.payerId ?? train.ownerId);
  const from = tx_(terminal(path.from)?.name), to = tx_(terminal(path.to)?.name);
  await post(tx, acc.id, [
    { category: 'tolls', amountCents: -plan.cost.track, description: t('Такса за жп линия {0} → {1}', from, to), idempotencyKey: `train-track:${train.id}:${now.getTime()}` },
    { category: 'fuel', amountCents: -plan.cost.energy, description: t('Енергия за влака {0} → {1}', from, to), idempotencyKey: `train-energy:${train.id}:${now.getTime()}` },
    ...(hire ? [{ category: 'rental' as const, amountCents: -hire.feeCents, description: t('Нает влак {0} → {1}', from, to), idempotencyKey: `train-hire:${train.id}:${now.getTime()}` }] : []),
  ], { requireFunds: true });
  if (hire?.ownerId && hire.feeCents > 0) {
    const owner = await account(tx, hire.ownerId);
    await post(tx, owner.id, [{ category: 'train_hire', amountCents: hire.feeCents, description: t('Влакът ти е нает: {0} → {1}', from, to), idempotencyKey: `train-hire-fee:${train.id}:${now.getTime()}` }]);
  }
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
    ...(hire?.ownerId ? { hirerId: hire.payerId, hireFeeCents: hire.feeCents } : {}),
  };
  const next: Train = { ...train, run };
  await save(tx, next, now);
  return next;
}
const tx_ = (name: string | undefined) => place(name ?? '');

/** The owner puts a train out for hire at a share of an order's pay (null takes it back). */
export async function setTrainHire(db: Database, userId: string, trainId: string, share: number | null, now: Date) {
  if (share !== null && !(TRAINS.hire.shares as readonly number[]).includes(share)) fail('bad_share', t('Няма такава такса.'));
  return db.transaction(async (tx) => {
    const train = await lockTrain(tx, userId, trainId);
    const next = { ...train, hireShare: share };
    await save(tx, next, now);
    return next;
  });
}

/** Hired runs a player has on the way: the game's trains they hired and players' trains carrying their orders. */
const hiredBy = (all: Train[], userId: string) => all.filter((tr) => (tr.rental && tr.ownerId === userId) || tr.run?.hirerId === userId);

/**
 * Hires a train for one order at a terminal: one of the game's (`'game'`, a
 * share of the pay; no licence needed) or a player's put out for hire there
 * (their share, to them; it runs under its owner's licences).
 */
export async function hireTrain(db: Database, userId: string, terminalId: number, orderId: string, via: string, now: Date) {
  const company = await inCompany(db, userId);
  const [u] = await db.select({ level: users.level, vip: users.vipLevel }).from(users).where(eq(users.id, userId));
  if ((u?.level ?? 0) < TRAINS.hire.minLevel) fail('level', t('Наем на влак е от ниво {0}.', TRAINS.hire.minLevel));
  const lim = trainLimits(company, u?.vip ?? 0);
  const term = terminal(terminalId);
  if (!term || !openAt(now)(term.country)) fail('bad_terminal', t('Няма такава товарна гара.'));
  const order = ordersAt(terminalId, now.getTime(), openAt(now)).find((o) => o.id === orderId);
  if (!order) fail('no_order', t('Поръчката вече не е на борсата.'), 404);
  const ownerHeld = via === 'game' ? null : await heldLicences(db, (await allTrains(db)).find((tr) => tr.id === via)?.ownerId ?? '');
  return db.transaction(async (tx) => {
    // One hire at a time per player (the count below must not race).
    const acc = await account(tx, userId);
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, acc.id)).for('update');
    if (hiredBy(await allTrains(tx), userId).length >= lim.hires) fail('max_hires', t('Най-много {0} наети влака наведнъж. Повече — с по-високо VIP ниво.', lim.hires));
    let train: Train;
    let hire: Hire;
    if (via === 'game') {
      const r = rentalFor(order!);
      if (!r) fail('no_rental', t('Няма свободен влак на играта за тази поръчка.'));
      train = { id: randomUUID(), ownerId: userId, ...r!, at: order!.from, run: null, boughtAt: now.toISOString(), runs: 0, tons: 0, earnedCents: 0, rental: true };
      await tx.insert(jobState).values({ key: key(train.id), value: train, updatedAt: now });
      hire = { payerId: userId, feeCents: hireFee(payFor(order!, company), TRAINS.hire.gameShare), ownerId: null };
    } else {
      const found = await lockAny(tx, via);
      if (!found || found.rental || found.ownerId === userId || !found.hireShare) fail('no_train', t('Този влак не е под наем.'), 404);
      train = await finishRun(tx, found!, now);
      const why = cannotTake(train, order!);
      if (why) fail(why, reasonText(why));
      needLicences(ownerHeld ?? new Set(), order!.stops);
      hire = { payerId: userId, feeCents: hireFee(payFor(order!, company), train.hireShare!), ownerId: train.ownerId };
    }
    const taken = await tx.insert(jobState).values({ key: orderKey(order!.id), value: { trainId: train.id, userId, at: now.toISOString() }, updatedAt: now }).onConflictDoNothing().returning({ key: jobState.key });
    if (!taken.length) fail('order_taken', t('Друг влак вече взе тази поръчка.'));
    return depart(tx, train, order!, order!, company, now, hire);
  });
}

/** The hire board at a terminal: its orders, what the game's train and each player's train for hire there would cost, and my hired runs. */
export async function hireBoard(db: Database, userId: string, terminalId: number, now: Date, wagon: WagonType | null = null) {
  await settleTrains(db, now, userId);
  const company = await inCompany(db, userId);
  const [u] = await db.select({ level: users.level, vip: users.vipLevel }).from(users).where(eq(users.id, userId));
  const lim = trainLimits(company, u?.vip ?? 0);
  const open = openAt(now);
  const all = await allTrains(db);
  const term = terminal(terminalId);
  const orders = term && open(term.country) ? ordersAt(terminalId, now.getTime(), open).filter((o) => !wagon || o.wagonType === wagon) : [];
  const ids = orders.map((o) => orderKey(o.id));
  const taken = new Set(ids.length ? (await db.select({ key: jobState.key }).from(jobState).where(inArray(jobState.key, ids))).map((r) => r.key.slice('train-order:'.length)) : []);
  const forHire = all.filter((tr) => !tr.rental && tr.hireShare && tr.ownerId !== userId && tr.at === terminalId && (!tr.run || new Date(tr.run.arriveAt) <= now));
  const ownerIds = [...new Set(forHire.map((tr) => tr.ownerId))];
  const owners = new Map(ownerIds.length ? (await db.select({ id: users.id, name: users.username }).from(users).where(inArray(users.id, ownerIds))).map((r) => [r.id, r.name]) : []);
  const held = new Map(await Promise.all(ownerIds.map(async (id) => [id, await heldLicences(db, id)] as const)));
  const rows = orders.map((o) => {
    const pay = payFor(o, company);
    const game = rentalFor(o);
    const gamePlan = game ? planRun(game, o, o.tons, company, now.getTime()) : null;
    const players = forHire.flatMap((tr) => {
      const free = { ...tr, run: null };
      if (cannotTake(free, o) || missingLicences(railLicences(pathCountries(o.stops)), held.get(tr.ownerId) ?? new Set()).length) return [];
      const plan = planRun(tr, o, o.tons, company, now.getTime());
      const fee = hireFee(pay, tr.hireShare!);
      return [{ trainId: tr.id, owner: owners.get(tr.ownerId) ?? '', loco: tr.loco, share: tr.hireShare!, fee, cost: plan.cost.total, hours: plan.hours, net: pay - fee - plan.cost.total }];
    }).sort((a, b) => b.net - a.net);
    const gameFee = hireFee(pay, TRAINS.hire.gameShare);
    return {
      ...o, pay, taken: taken.has(o.id),
      game: game && gamePlan ? { loco: game.loco, fee: gameFee, cost: gamePlan.cost.total, hours: gamePlan.hours, net: pay - gameFee - gamePlan.cost.total } : null,
      players,
    };
  }).sort((a, b) => Number(a.taken) - Number(b.taken) || b.pay - a.pay);
  const mine = hiredBy(all, userId).map((tr) => ({ id: tr.id, loco: tr.loco, rental: !!tr.rental, run: tr.run! })).filter((h) => h.run);
  // 1.3.3: every open terminal with its free orders (of the chosen wagon kind), the best pay and the trains for hire — best first.
  const everywhere = RAIL_TERMINALS.filter((x) => open(x.country)).map((x) => ({ x, list: ordersAt(x.id, now.getTime(), open).filter((o) => !wagon || o.wagonType === wagon) }));
  const allKeys = everywhere.flatMap((e) => e.list.map((o) => orderKey(o.id)));
  const takenAll = new Set(allKeys.length ? (await db.select({ key: jobState.key }).from(jobState).where(inArray(jobState.key, allKeys))).map((r) => r.key.slice('train-order:'.length)) : []);
  const stations = everywhere.map(({ x, list }) => {
    const freeOrders = list.filter((o) => !takenAll.has(o.id));
    return { id: x.id, name: x.name, orders: freeOrders.length, best: Math.max(0, ...freeOrders.map((o) => payFor(o, company))), trains: all.filter((tr) => !tr.rental && tr.hireShare && tr.ownerId !== userId && tr.at === x.id && !tr.run).length };
  }).sort((a, b) => b.best - a.best || b.orders - a.orders);
  return { level: u?.level ?? 0, minLevel: TRAINS.hire.minLevel, hires: lim.hires, active: mine, orders: rows, terminal: term ?? null, stations, wagon };
}

/** The page: my trains (with the board at each one's terminal) and what I may buy. */
export type TrainsView = Awaited<ReturnType<typeof trainsView>>;

export async function trainsView(db: Database, userId: string, now: Date) {
  await settleTrains(db, now, userId);
  const company = await inCompany(db, userId);
  const lim = trainLimits(company, await vipOf(db, userId));
  const open = openAt(now);
  const held = await heldLicences(db, userId);
  const mine = (await allTrains(db)).filter((tr) => tr.ownerId === userId && !tr.rental).sort((a, b) => a.boughtAt.localeCompare(b.boughtAt));
  const ids = [...new Set(mine.filter((tr) => !tr.run).flatMap((tr) => ordersAt(tr.at, now.getTime(), open).map((o) => orderKey(o.id))))];
  const taken = new Set(ids.length ? (await db.select({ key: jobState.key }).from(jobState).where(inArray(jobState.key, ids))).map((r) => r.key.slice('train-order:'.length)) : []);
  const trains = mine.map((tr) => ({
    ...tr,
    empty: tr.run ? [] : emptyRoutes(tr, now).filter((p) => p.stops.length <= 4 && !missingLicences(railLicences(pathCountries(p.stops)), held).length).map((p) => ({ ...p, ...planRun(tr, p, 0, company, now.getTime()) })),
    orders: tr.run ? [] : ordersAt(tr.at, now.getTime(), open).map((o) => {
      const missing = missingLicences(railLicences(pathCountries(o.stops)), held);
      const why = taken.has(o.id) ? 'order_taken' : (cannotTake(tr, o) ?? (missing.length ? 'licence' : null));
      const plan = planRun(tr, o, o.tons, company, now.getTime());
      return { ...o, pay: payFor(o, company), cost: plan.cost.total, hours: plan.hours, gross: plan.gross, limit: plan.limit, need: wagonsFor(o.wagonType, o.tons), why, missing };
    }).sort((a, b) => Number(!!a.why) - Number(!!b.why) || b.pay - b.cost - (a.pay - a.cost)),
  }));
  return { trains, company, limits: lim, licensed: held.has('rail'), terminals: RAIL_TERMINALS.filter((x) => open(x.country)) };
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
  const trains = (await allTrains(db)).filter((tr) => (tr.ownerId === userId && (!tr.rental || tr.run)) || tr.run?.hirerId === userId).map((tr) => ({ id: tr.id, label: LOCOS[tr.loco].name, at: tr.at, run: tr.run }));
  return { lines, terminals, trains };
}
