import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { cannotTake, GRADES, grossFor, LOCOS, orderPay, ordersAt, pathsFrom, pullOver, RAIL_LINES, RAIL_TERMINALS, runCost, runLegs, tareTons, TRAINS, WAGONS, type Train } from '@/lib/game/trains';
import { closeDb } from '@/server/db/client';
import { cities, companies, companyLicences, jobState, userLicences, users } from '@/server/db/schema';
import { membershipOf } from '@/server/game/membership';
import { LICENCES, licenceOpen } from '@/lib/game/licences';
import { buyLicence } from '@/server/game/licences';
import { post } from '@/server/game/finance';
import { GameError } from '@/server/game/errors';
import { buyTrain, moveTrain, sellTrain, sendTrain, settleTrains, trainsView } from '@/server/game/trains';
import { isTrainPage, sectionFor, VEHICLE_SWITCH } from '@/components/game/nav';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const SOFIA = 727011;
const balance = async (userId: string) => (await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.ownerId, userId)))[0]!.b;
async function rich(userId: string, level: number, licences: string[] = ['rail', 'international', 'customs'], vipLevel = 3) {
  await db().update(users).set({ level, vipLevel }).where(eq(users.id, userId));
  if (licences.length) await db().insert(userLicences).values(licences.map((licence) => ({ userId, licence, priceCents: 0, source: 'purchase' }))).onConflictDoNothing();
  const [acc] = await db().select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  await db().transaction((tx) => post(tx, acc!.id, [{ category: 'admin_adjustment', amountCents: 3_000_000_00, description: 'test funds', idempotencyKey: `test-train:${userId}` }]));
}
const trainRow = async (id: string) => (await db().select({ value: jobState.value }).from(jobState).where(eq(jobState.key, `train:${id}`)))[0]?.value as Train | undefined;

describe('1.3.3 „Жп линия“: own freight trains on real lines', () => {
  it('is a 1.3.3 feature; a network of real lines between real terminals through real towns', async () => {
    expect(FEATURES.trains).toBe('1.3.3');
    const ids = new Set(RAIL_TERMINALS.map((x) => x.id));
    expect(new Set(RAIL_LINES.map((l) => l.id)).size).toBe(RAIL_LINES.length);
    for (const l of RAIL_LINES) {
      expect(ids.has(l.a) && ids.has(l.b), l.id).toBe(true);
      expect(l.km / l.hours, l.id).toBeLessThan(80);
    }
    // Every terminal and every town on the way is a city of the game, in the right country.
    const towns = [...new Set([...ids, ...RAIL_LINES.flatMap((l) => l.via)])];
    const rows = await db().select({ id: cities.id, country: cities.countryCode }).from(cities).where(inArray(cities.id, towns));
    expect(rows).toHaveLength(towns.length);
    for (const r of rows) if (ids.has(r.id)) expect(RAIL_TERMINALS.find((x) => x.id === r.id)!.country).toBe(r.country);
    // A line that crosses a border has a border stop, and only then.
    const country = new Map(rows.map((r) => [r.id, r.country]));
    for (const l of RAIL_LINES) expect(!!l.border, l.id).toBe(country.get(l.a) !== country.get(l.b) || [l.a, ...l.via, l.b].some((v) => country.get(v) !== country.get(l.a)));
    // One network: every terminal reaches every other one.
    expect(pathsFrom(SOFIA).size).toBe(RAIL_TERMINALS.length - 1);
    expect(RAIL_LINES.length).toBeGreaterThanOrEqual(30);
  });

  it('a far run goes through the terminals between, with a stop at each and the border waits', () => {
    const toVarna = pathsFrom(SOFIA).get(726050)!;
    expect(toVarna.stops).toEqual([SOFIA, 731233, 726050]);
    expect(toVarna.km).toBe(285 + 233);
    const toIstanbul = pathsFrom(SOFIA).get(742394)!;
    expect(toIstanbul.stops).toEqual([SOFIA, 728193, 742394]);
    expect(toIstanbul.borders.map((b) => b.name)).toEqual(['Свиленград – Капъкуле']);
    const legs = runLegs(toIstanbul, 'balkan-e40', 1000, 0);
    expect(legs.map((l) => l.kind)).toEqual(['run', 'stop', 'run', 'border', 'run']);
    // An electric locomotive has no way through a line without wires.
    expect(pathsFrom(SOFIA, () => true, true).get(787657)).toBeUndefined();
    expect(pathsFrom(SOFIA).get(787657)!.electric).toBe(false);
  });

  it('a locomotive pulls less up the hills; a heavier train is slower and uses more energy', () => {
    const flat = pathsFrom(727523).get(726050)!; // Русе – Варна
    const mountain = pathsFrom(2867714).get(3164527)!; // Мюнхен – Верона (Бренер)
    expect(pullOver('rila-e60', flat)).toBe(2_700);
    expect(pullOver('rila-e60', mountain)).toBe(Math.floor(2_700 * GRADES.mountain.pull));
    const time = (gross: number) => runLegs(flat, 'balkan-e40', gross, 0).at(-1)!.end;
    expect(time(1_800)).toBeGreaterThan(time(600));
    expect(runCost('balkan-e40', flat, 1_800, false).energy).toBeGreaterThan(runCost('balkan-e40', flat, 600, false).energy);
    expect(runCost('balkan-e40', flat, 1_000, true).track).toBeLessThan(runCost('balkan-e40', flat, 1_000, false).track);
    // 22 full hoppers (22 × 92 t) are too heavy for the diesel even on a flat line.
    const order = { from: 727523, electric: true, wagonType: 'hopper' as const, tons: 1_500, pull: 1 };
    expect(cannotTake({ loco: 'danubia-d22', wagons: { hopper: 22 }, run: null, at: 727523 }, order)).toBe('too_heavy');
    expect(cannotTake({ loco: 'rila-e60', wagons: { hopper: 22 }, run: null, at: 727523 }, order)).toBeNull();
  });

  it('balance: a 15-wagon train pays back in no less than three weeks of perfect non-stop runs (about 1–4 months as played)', () => {
    for (const loco of Object.keys(LOCOS) as (keyof typeof LOCOS)[]) {
      const train = { loco, wagons: { container: 15 } };
      const price = LOCOS[loco].priceCents + 15 * WAGONS.container.priceCents;
      for (const l of RAIL_LINES.filter((x) => !LOCOS[loco].electric || x.electric)) {
        const path = pathsFrom(l.a).get(l.b)!;
        const hours = (gross: number) => runLegs(path, loco, gross, 0).at(-1)!.end / 3_600_000;
        const full = Math.min(15 * WAGONS.container.tons, pullOver(loco, path) - tareTons(train.wagons));
        // Best: a full train at the best rate both ways, in a company.
        const best = Math.round(orderPay(full, l.km, 'container', 1.2) * (1 + TRAINS.company.payBonus)) - runCost(loco, path, grossFor(train, full), true).total;
        expect(price / ((best / hours(grossFor(train, full))) * 24), `${loco} ${l.id}`).toBeGreaterThan(20);
        // Typical: 900 t (or what it pulls) at an average rate, solo, every other return empty.
        const load = Math.min(900, full);
        const typical = orderPay(load, l.km, 'container', 1.05) - runCost(loco, path, grossFor(train, load), false).total - runCost(loco, path, grossFor(train, 0), false).total / 2;
        const days = price / ((typical / (hours(grossFor(train, load)) * 1.5)) * 24);
        expect(days, `${loco} ${l.id}`).toBeGreaterThan(35);
        if (l.km >= 150 && !l.border) expect(days, `${loco} ${l.id}`).toBeLessThan(130);
      }
    }
  });

  it('the board is the same for everyone: two orders to each neighbour and a few far ones', () => {
    const t0 = Date.parse('2026-12-04T10:00:00+02:00');
    const a = ordersAt(SOFIA, t0), b = ordersAt(SOFIA, t0 + 60_000);
    expect(a).toEqual(b);
    const near = RAIL_LINES.filter((l) => l.a === SOFIA || l.b === SOFIA).length * TRAINS.ordersPerLine;
    expect(a.length).toBe(near + TRAINS.farOrders);
    expect(a.filter((o) => o.stops.length > 2)).toHaveLength(TRAINS.farOrders);
    for (const o of a) expect(o.tons).toBeGreaterThanOrEqual(TRAINS.tons.min);
    expect(ordersAt(SOFIA, t0 + TRAINS.windowHours * 3_600_000)).not.toEqual(a);
  });

  it('solo from level 25: buy, take an order once, get paid on arrival, run empty, sell', async () => {
    const p = await newPlayer();
    const n = { loco: 'rila-e60' as const, wagonType: 'container' as const, wagons: 25, terminalId: SOFIA };
    // A board with a container order this train takes (some windows have none).
    let now = new Date();
    for (let i = 0; i < 50 && !ordersAt(SOFIA, now.getTime()).some((o) => o.wagonType === 'container' && o.electric && !cannotTake({ ...n, run: null, at: SOFIA, wagons: { container: 25 } }, o)); i++) now = new Date(now.getTime() + TRAINS.windowHours * 3_600_000);
    await rich(p.userId, 24);
    expect(await code(buyTrain(db(), p.userId, n, now))).toBe('level');
    await rich(p.userId, 25);
    const before = await balance(p.userId);
    const train = await buyTrain(db(), p.userId, n, now);
    expect(await balance(p.userId)).toBe(before - LOCOS['rila-e60'].priceCents - 25 * WAGONS.container.priceCents);

    const view = await trainsView(db(), p.userId, now);
    const order = view.trains[0]!.orders.find((o) => !o.why)!;
    const b1 = await balance(p.userId);
    const sent = await sendTrain(db(), p.userId, train.id, order.id, now);
    expect(await balance(p.userId)).toBe(b1 - order.cost);
    expect(sent.run).toMatchObject({ payCents: order.payCents, stops: order.stops, grossTons: order.gross });
    expect(new Date(sent.run!.arriveAt).getTime() - now.getTime()).toBe(Math.round(order.hours * 3_600_000));
    // Taken: not again, by this train or another one.
    const other = await newPlayer();
    await rich(other.userId, 25);
    const t2 = await buyTrain(db(), other.userId, n, now);
    expect(await code(sendTrain(db(), other.userId, t2.id, order.id, now))).toBe('order_taken');
    // Arrival.
    const arrive = new Date(new Date(sent.run!.arriveAt).getTime() + 1000);
    const b2 = await balance(p.userId);
    await settleTrains(db(), arrive);
    await settleTrains(db(), arrive);
    expect(await balance(p.userId)).toBe(b2 + order.payCents);
    expect(await trainRow(train.id)).toMatchObject({ at: order.to, run: null, runs: 1, tons: order.tons });

    // Empty back to Sofia over the network.
    const later = new Date(arrive.getTime() + 60_000);
    const moved = await moveTrain(db(), p.userId, train.id, SOFIA, later);
    expect(moved.run).toMatchObject({ to: SOFIA, orderId: null, payCents: 0, grossTons: 25 * WAGONS.container.tare });
    expect(await code(sellTrain(db(), p.userId, train.id, later))).toBe('busy');
    const home = new Date(new Date(moved.run!.arriveAt).getTime() + 1000);
    await settleTrains(db(), home);
    const b3 = await balance(p.userId);
    const back = await sellTrain(db(), p.userId, train.id, home);
    expect(back).toBe(Math.round((LOCOS['rila-e60'].priceCents + 25 * WAGONS.container.priceCents) * TRAINS.sellBack));
    expect(await balance(p.userId)).toBe(b3 + back);
    expect(await trainRow(train.id)).toBeUndefined();
  });

  it('an electric locomotive stays off the lines without wires', async () => {
    const p = await newPlayer();
    await rich(p.userId, 25);
    const train = await buyTrain(db(), p.userId, { loco: 'balkan-e40', wagonType: 'hopper', wagons: 10, terminalId: SOFIA }, new Date());
    expect(await code(moveTrain(db(), p.userId, train.id, 787657, new Date()))).toBe('no_route');
    const view = await trainsView(db(), p.userId, new Date());
    for (const o of view.trains[0]!.orders.filter((x) => !x.electric)) expect(o.why).toBe('diesel_only');
    expect(view.trains[0]!.empty.every((p) => p.electric)).toBe(true);
  });

  it('in a player company with the rail licence: from level 12, +10% pay, a cheaper track and one more train', async () => {
    const p = await playerWithCompany();
    // No licence of their own: the company's (bought from its treasury) is enough for its members.
    await rich(p.userId, 12, ['international', 'customs']);
    const m = (await membershipOf(db(), p.userId))!;
    await db().insert(companyLicences).values({ companyId: m.company.id, licence: 'rail', priceCents: 0, boughtBy: p.userId });
    const view0 = await trainsView(db(), p.userId, new Date());
    expect(view0.company).toBe(true);
    expect(view0.limits).toMatchObject({ minLevel: TRAINS.company.minLevel, maxTrains: TRAINS.maxTrains + 1 });
    await buyTrain(db(), p.userId, { loco: 'danubia-d22', wagonType: 'tank', wagons: 18, terminalId: SOFIA }, new Date());
    const view = await trainsView(db(), p.userId, new Date());
    const o = view.trains[0]!.orders[0]!;
    expect(o.pay).toBe(Math.round(o.payCents * 1.1));
    expect(o.cost).toBe(runCost('danubia-d22', o, o.gross, true).total);
  });

  it('Автопарк and Курсове each have a trucks half and a trains half', () => {
    const has = () => true;
    expect(sectionFor('/game/trains', has)?.key).toBe('fleet');
    expect(sectionFor('/game/contracts/trains', has)?.key).toBe('jobs');
    // 1.3.3: in Автопарк the trains are a tab (like the trailers), not a half.
    expect(VEHICLE_SWITCH.fleet).toBeUndefined();
    expect(VEHICLE_SWITCH.jobs).toEqual({ trucks: '/game/contracts', trains: '/game/contracts/trains' });
    expect(isTrainPage('/game/contracts/trains')).toBe(true);
    expect(isTrainPage('/game/contracts')).toBe(false);
    expect(isTrainPage('/game/trainsx')).toBe(false);
  });

  it('the rail licence: needed for a train; over a border also the international and outside the EU the customs one', async () => {
    expect(LICENCES.rail).toMatchObject({ feature: 'trains', minLevel: 25, priceCents: 300_000_00 });
    expect(licenceOpen(LICENCES.rail, () => false)).toBe(false);
    expect(licenceOpen(LICENCES.rail, (f) => f === 'trains')).toBe(true);
    expect(licenceOpen(LICENCES.air, () => true)).toBe(false);
    const p = await newPlayer();
    await rich(p.userId, 25, []);
    const n = { loco: 'danubia-d22' as const, wagonType: 'container' as const, wagons: 10, terminalId: SOFIA };
    expect(await code(buyTrain(db(), p.userId, n, new Date()))).toBe('licence');
    // Before the release only the team can buy it.
    if (!FEATURES.trains || Date.now() < Date.parse('2026-12-04T00:00:00+02:00')) expect(await code(buyLicence(db(), p.userId, 'rail'))).toBe('licence_unavailable');
    await db().insert(userLicences).values({ userId: p.userId, licence: 'rail', priceCents: 0, source: 'purchase' });
    const train = await buyTrain(db(), p.userId, n, new Date());
    const view = await trainsView(db(), p.userId, new Date());
    const tr = view.trains.find((x) => x.id === train.id)!;
    for (const o of tr.orders) {
      const abroad = o.stops.some((id) => RAIL_TERMINALS.find((x) => x.id === id)!.country !== 'BG');
      if (abroad && !o.why?.match(/order_taken|wagons|too_heavy/)) expect(o.why, o.id).toBe('licence');
      if (abroad) expect(o.missing).toContain('international');
      if (!abroad) expect(o.missing).toEqual([]);
    }
    // No empty run abroad without the licences, and none is offered.
    expect(tr.empty.every((e) => e.stops.every((id) => RAIL_TERMINALS.find((x) => x.id === id)!.country === 'BG'))).toBe(true);
    expect(await code(moveTrain(db(), p.userId, train.id, 787657, new Date()))).toBe('licence');
  });
});
