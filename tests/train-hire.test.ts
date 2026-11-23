import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { cannotTake, hireFee, ordersAt, payFor, rentalFor, TRAINS, trainLimits, type Train } from '@/lib/game/trains';
import { unlocksAt, VIP_UNLOCKS } from '@/lib/game/vip-levels';
import { closeDb } from '@/server/db/client';
import { companies, jobState, userLicences, users } from '@/server/db/schema';
import { post } from '@/server/game/finance';
import { GameError } from '@/server/game/errors';
import { buyTrain, hireBoard, hireTrain, setTrainHire, settleTrains } from '@/server/game/trains';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const SOFIA = 727011;
const balance = async (userId: string) => (await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.ownerId, userId)))[0]!.b;
async function setUp(userId: string, level: number, vipLevel: number, licences: string[] = []) {
  await db().update(users).set({ level, vipLevel }).where(eq(users.id, userId));
  if (licences.length) await db().insert(userLicences).values(licences.map((licence) => ({ userId, licence, priceCents: 0, source: 'purchase' }))).onConflictDoNothing();
  const [acc] = await db().select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  await db().transaction((tx) => post(tx, acc!.id, [{ category: 'admin_adjustment', amountCents: 3_000_000_00, description: 'test funds', idempotencyKey: `test-hire:${userId}` }]));
}
const trainRow = async (id: string) => (await db().select({ value: jobState.value }).from(jobState).where(eq(jobState.key, `train:${id}`)))[0]?.value as Train | undefined;
const isDomestic = (o: { stops: number[] }) => o.stops.every((id) => id === SOFIA || [728193, 732770, 726050, 727523, 731233, 726848, 725905].includes(id));

describe('1.3.3: trains by VIP level, and hiring a train for one order', () => {
  it('own trains from VIP3, more at VIP4–5; hires at once by VIP level; the unlocks are listed', async () => {
    expect(trainLimits(false, 2).vip).toBe(false);
    expect(trainLimits(false, 3)).toMatchObject({ vip: true, maxTrains: TRAINS.maxTrains, hires: 3 });
    expect(trainLimits(false, 5).maxTrains).toBe(TRAINS.maxTrains + 2);
    expect([0, 1, 2].map((v) => trainLimits(false, v).hires)).toEqual([1, 2, 3]);
    expect(VIP_UNLOCKS.map((u) => u.level)).toEqual([1, 2, 2, 3, 4, 5]);
    expect(unlocksAt(3, () => false)).toEqual([]);
    const p = await newPlayer();
    await setUp(p.userId, 30, 2, ['rail']);
    expect(await code(buyTrain(db(), p.userId, { loco: 'danubia-d22', wagonType: 'hopper', wagons: 10, terminalId: SOFIA }, new Date()))).toBe('vip_level');
    await db().update(users).set({ vipLevel: 3 }).where(eq(users.id, p.userId));
    expect(await code(buyTrain(db(), p.userId, { loco: 'danubia-d22', wagonType: 'hopper', wagons: 10, terminalId: SOFIA }, new Date()))).toBe('ok');
  });

  it("a game train: the smallest that can, 35% of the pay, paid on arrival and gone", async () => {
    const p = await newPlayer();
    await setUp(p.userId, 9, 0);
    let now = new Date();
    const pick = async () => (await hireBoard(db(), p.userId, SOFIA, now)).orders.find((o) => !o.taken && isDomestic(o) && o.game);
    let row = await pick();
    for (let i = 0; i < 50 && !row; i++) {
      now = new Date(now.getTime() + TRAINS.windowHours * 3_600_000);
      row = await pick();
    }
    const order = ordersAt(SOFIA, now.getTime()).find((o) => o.id === row!.id)!;
    const r = rentalFor(order)!;
    expect(cannotTake({ ...r, run: null, at: SOFIA }, order)).toBeNull();
    expect(await code(hireTrain(db(), p.userId, SOFIA, order.id, 'game', now))).toBe('level');
    await db().update(users).set({ level: 10 }).where(eq(users.id, p.userId));
    expect(row!.game!.fee).toBe(hireFee(payFor(order, false), TRAINS.hire.gameShare));
    const b0 = await balance(p.userId);
    const tr = await hireTrain(db(), p.userId, SOFIA, order.id, 'game', now);
    expect(tr.rental).toBe(true);
    expect(await balance(p.userId)).toBe(b0 - row!.game!.fee - row!.game!.cost);
    // VIP0: one hired train at a time.
    const second = ordersAt(SOFIA, now.getTime()).find((o) => o.id !== order.id && isDomestic(o) && rentalFor(o));
    if (second) expect(await code(hireTrain(db(), p.userId, SOFIA, second.id, 'game', now))).toBe('max_hires');
    await settleTrains(db(), new Date(new Date(tr.run!.arriveAt).getTime() + 1000));
    expect(await balance(p.userId)).toBe(b0 - row!.game!.fee - row!.game!.cost + row!.pay);
    expect(await trainRow(tr.id)).toBeUndefined();
  });

  it("a player's train for hire: the fee to its owner, the pay to the one who hired it", async () => {
    const owner = await newPlayer();
    await setUp(owner.userId, 25, 3, ['rail']);
    let now = new Date();
    const n = { loco: 'danubia-d22' as const, wagonType: 'hopper' as const, wagons: 22, terminalId: SOFIA };
    const train = await buyTrain(db(), owner.userId, n, now);
    const hirer = await newPlayer();
    await setUp(hirer.userId, 12, 0);
    const any = ordersAt(SOFIA, now.getTime())[0]!;
    expect(await code(hireTrain(db(), hirer.userId, SOFIA, any.id, train.id, now))).toBe('no_train');
    expect(await code(setTrainHire(db(), owner.userId, train.id, 0.33, now))).toBe('bad_share');
    await setTrainHire(db(), owner.userId, train.id, 0.2, now);
    // A window with a free order this train can carry.
    const pick = async () => (await hireBoard(db(), hirer.userId, SOFIA, now)).orders.find((o) => !o.taken && o.players.some((x) => x.trainId === train.id));
    let row = await pick();
    for (let i = 0; i < 80 && !row; i++) {
      now = new Date(now.getTime() + TRAINS.windowHours * 3_600_000);
      row = await pick();
    }
    const order = row!;
    const offer = order.players.find((x) => x.trainId === train.id)!;
    expect(offer.fee).toBe(hireFee(order.pay, 0.2));
    const [o0, h0] = [await balance(owner.userId), await balance(hirer.userId)];
    const sent = await hireTrain(db(), hirer.userId, SOFIA, order.id, train.id, now);
    expect(sent.run).toMatchObject({ hirerId: hirer.userId, hireFeeCents: offer.fee });
    expect(await balance(owner.userId)).toBe(o0 + offer.fee);
    expect(await balance(hirer.userId)).toBe(h0 - offer.fee - offer.cost);
    await settleTrains(db(), new Date(new Date(sent.run!.arriveAt).getTime() + 1000));
    expect(await balance(hirer.userId)).toBe(h0 - offer.fee - offer.cost + order.pay);
    expect(await balance(owner.userId)).toBe(o0 + offer.fee);
    expect(await trainRow(train.id)).toMatchObject({ run: null, at: order.to, runs: 1, earnedCents: offer.fee, hireShare: 0.2 });
  });
});
