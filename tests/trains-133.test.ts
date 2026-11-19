import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { LOCOS, orderPay, ordersAt, RAIL_LINES, RAIL_TERMINALS, runCost, TRAINS, WAGONS, type Train } from '@/lib/game/trains';
import { closeDb } from '@/server/db/client';
import { cities, companies, jobState, users } from '@/server/db/schema';
import { post } from '@/server/game/finance';
import { GameError } from '@/server/game/errors';
import { buyTrain, moveTrain, sellTrain, sendTrain, settleTrains, trainsView } from '@/server/game/trains';
import { isTrainPage, sectionFor, VEHICLE_SWITCH } from '@/components/game/nav';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const SOFIA = 727011;
const balance = async (userId: string) => (await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.ownerId, userId)))[0]!.b;
async function rich(userId: string, level: number) {
  await db().update(users).set({ level }).where(eq(users.id, userId));
  const [acc] = await db().select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  await db().transaction((tx) => post(tx, acc!.id, [{ category: 'admin_adjustment', amountCents: 3_000_000_00, description: 'test funds', idempotencyKey: `test-train:${userId}` }]));
}
const trainRow = async (id: string) => (await db().select({ value: jobState.value }).from(jobState).where(eq(jobState.key, `train:${id}`)))[0]?.value as Train | undefined;

describe('1.3.3 „Жп линия“: own freight trains on real lines', () => {
  it('is a 1.3.3 feature; every line joins two real terminals that are cities of the game', async () => {
    expect(FEATURES.trains).toBe('1.3.3');
    const ids = new Set(RAIL_TERMINALS.map((x) => x.id));
    expect(new Set(RAIL_LINES.map((l) => l.id)).size).toBe(RAIL_LINES.length);
    for (const l of RAIL_LINES) {
      expect(ids.has(l.a) && ids.has(l.b), l.id).toBe(true);
      expect(l.km / l.hours, l.id).toBeLessThan(80);
    }
    const rows = await db().select({ id: cities.id, country: cities.countryCode }).from(cities).where(inArray(cities.id, [...ids]));
    expect(rows).toHaveLength(ids.size);
    for (const r of rows) expect(RAIL_TERMINALS.find((x) => x.id === r.id)!.country).toBe(r.country);
    // Every terminal has a line, and Bulgaria has lines to its neighbours.
    for (const x of RAIL_TERMINALS) expect(RAIL_LINES.some((l) => l.a === x.id || l.b === x.id), x.name).toBe(true);
    expect(RAIL_LINES.length).toBeGreaterThanOrEqual(25);
  });

  it('balance: a 15-wagon train pays back in no less than three weeks of perfect non-stop runs (about 1–4 months as played)', () => {
    for (const loco of Object.keys(LOCOS) as (keyof typeof LOCOS)[]) {
      const price = LOCOS[loco].priceCents + 15 * WAGONS.container.priceCents;
      for (const l of RAIL_LINES.filter((x) => !LOCOS[loco].electric || x.electric)) {
        // Best: a full train at the best rate both ways, in a company.
        const best = Math.round(orderPay(Math.min(TRAINS.tons.max, 15 * WAGONS.container.tons), l.km, 'container', 1.2) * (1 + TRAINS.company.payBonus)) - runCost(loco, l.km, true, true).total;
        expect(price / ((best / l.hours) * 24), `${loco} ${l.id}`).toBeGreaterThan(20);
        // Typical: 900 t at an average rate, solo, every other return empty.
        const typical = orderPay(900, l.km, 'container', 1.05) - runCost(loco, l.km, true, false).total - runCost(loco, l.km, false, false).total / 2;
        const days = price / ((typical / (l.hours * 1.5)) * 24);
        expect(days, `${loco} ${l.id}`).toBeGreaterThan(40);
        if (l.km >= 150) expect(days, `${loco} ${l.id}`).toBeLessThan(130);
      }
    }
  });

  it('the board is the same for everyone, and an order fits only a train with the right wagons', () => {
    const t0 = Date.parse('2026-12-04T10:00:00+02:00');
    const a = ordersAt(SOFIA, t0), b = ordersAt(SOFIA, t0 + 60_000);
    expect(a).toEqual(b);
    expect(a.length).toBe(RAIL_LINES.filter((l) => l.a === SOFIA || l.b === SOFIA).length * TRAINS.ordersPerLine);
    for (const o of a) expect(o.tons).toBeGreaterThanOrEqual(TRAINS.tons.min);
    expect(ordersAt(SOFIA, t0 + TRAINS.windowHours * 3_600_000)).not.toEqual(a);
  });

  it('solo from level 15: buy, take an order once, get paid on arrival, run empty, sell', async () => {
    const p = await newPlayer();
    const now = new Date();
    const n = { loco: 'danubia-d22' as const, wagonType: 'container' as const, wagons: 18, terminalId: SOFIA };
    await rich(p.userId, 14);
    expect(await code(buyTrain(db(), p.userId, n, now))).toBe('level');
    await rich(p.userId, 15);
    const before = await balance(p.userId);
    const train = await buyTrain(db(), p.userId, n, now);
    expect(await balance(p.userId)).toBe(before - LOCOS['danubia-d22'].priceCents - 18 * WAGONS.container.priceCents);

    // A container order from Sofia fits (18 × 60 t ≥ 1500 t).
    const view = await trainsView(db(), p.userId, now);
    const order = view.trains[0]!.orders.find((o) => o.wagonType === 'container') ?? view.trains[0]!.orders[0]!;
    if (order.wagonType !== 'container') expect(order.why).toBe('wagons');
    else {
      expect(order.why).toBeNull();
      const b1 = await balance(p.userId);
      const sent = await sendTrain(db(), p.userId, train.id, order.id, now);
      expect(await balance(p.userId)).toBe(b1 - runCost('danubia-d22', order.km, true, false).total);
      expect(sent.run!.payCents).toBe(order.payCents);
      // Taken: not again, by this train or another one.
      const other = await newPlayer();
      await rich(other.userId, 15);
      const t2 = await buyTrain(db(), other.userId, n, now);
      expect(await code(sendTrain(db(), other.userId, t2.id, order.id, now))).toBe('order_taken');
      // Arrival.
      const arrive = new Date(new Date(sent.run!.arriveAt).getTime() + 1000);
      const b2 = await balance(p.userId);
      await settleTrains(db(), arrive);
      await settleTrains(db(), arrive);
      expect(await balance(p.userId)).toBe(b2 + order.payCents);
      const after = (await trainRow(train.id))!;
      expect(after).toMatchObject({ at: order.to, run: null, runs: 1, tons: order.tons });
    }

    // Empty back to Sofia (a diesel runs on any line).
    const here = (await trainRow(train.id))!.at;
    if (here !== SOFIA) {
      const back = RAIL_LINES.find((l) => (l.a === here && l.b === SOFIA) || (l.b === here && l.a === SOFIA))!;
      const moved = await moveTrain(db(), p.userId, train.id, back.id, new Date(Date.now() + 2 * 86_400_000));
      expect(moved.run).toMatchObject({ to: SOFIA, orderId: null, payCents: 0 });
      expect(await code(sellTrain(db(), p.userId, train.id, new Date(Date.now() + 2 * 86_400_000)))).toBe('busy');
      await settleTrains(db(), new Date(Date.now() + 5 * 86_400_000));
    }
    const b3 = await balance(p.userId);
    const back = await sellTrain(db(), p.userId, train.id, new Date(Date.now() + 5 * 86_400_000));
    expect(back).toBe(Math.round((LOCOS['danubia-d22'].priceCents + 18 * WAGONS.container.priceCents) * TRAINS.sellBack));
    expect(await balance(p.userId)).toBe(b3 + back);
    expect(await trainRow(train.id)).toBeUndefined();
  });

  it('an electric locomotive stays off the lines without wires', async () => {
    const p = await newPlayer();
    await rich(p.userId, 15);
    const train = await buyTrain(db(), p.userId, { loco: 'balkan-e40', wagonType: 'hopper', wagons: 10, terminalId: SOFIA }, new Date());
    expect(await code(moveTrain(db(), p.userId, train.id, 'sofia-nis', new Date()))).toBe('diesel_only');
    const view = await trainsView(db(), p.userId, new Date());
    for (const o of view.trains[0]!.orders.filter((x) => x.lineId === 'sofia-nis' || x.lineId === 'sofia-thessaloniki')) expect(o.why).toBe('diesel_only');
  });

  it('in a player company: from level 12, +10% pay, a cheaper track and one more train', async () => {
    const p = await playerWithCompany();
    await rich(p.userId, 12);
    const view0 = await trainsView(db(), p.userId, new Date());
    expect(view0.company).toBe(true);
    expect(view0.limits).toEqual({ minLevel: TRAINS.company.minLevel, maxTrains: TRAINS.maxTrains + 1 });
    await buyTrain(db(), p.userId, { loco: 'danubia-d22', wagonType: 'tank', wagons: 18, terminalId: SOFIA }, new Date());
    const view = await trainsView(db(), p.userId, new Date());
    const o = view.trains[0]!.orders[0]!;
    expect(o.pay).toBe(Math.round(o.payCents * 1.1));
    expect(o.cost).toBe(runCost('danubia-d22', o.km, true, true).total);
    expect(runCost('danubia-d22', 100, true, true).track).toBeLessThan(runCost('danubia-d22', 100, true, false).track);
  });

  it('Автопарк and Курсове each have a trucks half and a trains half', () => {
    const has = () => true;
    expect(sectionFor('/game/trains', has)?.key).toBe('fleet');
    expect(sectionFor('/game/contracts/trains', has)?.key).toBe('jobs');
    expect(VEHICLE_SWITCH.fleet).toEqual({ trucks: '/game/fleet', trains: '/game/trains' });
    expect(VEHICLE_SWITCH.jobs).toEqual({ trucks: '/game/contracts', trains: '/game/contracts/trains' });
    expect(isTrainPage('/game/contracts/trains')).toBe(true);
    expect(isTrainPage('/game/contracts')).toBe(false);
    expect(isTrainPage('/game/trainsx')).toBe(false);
  });
});
