import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { cannotTake, lineFits, ordersAt, TRAINS, type Train } from '@/lib/game/trains';
import { notificationButtons } from '@/lib/game/notification-buttons';
import { closeDb } from '@/server/db/client';
import { companies, jobState, notifications, userLicences, users } from '@/server/db/schema';
import { post } from '@/server/game/finance';
import { GameError } from '@/server/game/errors';
import { buyTrain, runLines, sendBest, setTrainLine, settleTrains } from '@/server/game/trains';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const SOFIA = 727011;
const DOMESTIC = new Set([727011, 728193, 732770, 726050, 727523, 731233, 726848, 725905]);
const trainRow = async (id: string) => (await db().select({ value: jobState.value }).from(jobState).where(eq(jobState.key, `train:${id}`)))[0]?.value as Train;
async function owner() {
  const p = await newPlayer();
  await db().update(users).set({ level: 25, vipLevel: 3 }).where(eq(users.id, p.userId));
  await db().insert(userLicences).values({ userId: p.userId, licence: 'rail', priceCents: 0, source: 'purchase' }).onConflictDoNothing();
  const [acc] = await db().select({ id: companies.id }).from(companies).where(eq(companies.ownerId, p.userId));
  await db().transaction((tx) => post(tx, acc!.id, [{ category: 'admin_adjustment', amountCents: 3_000_000_00, description: 'test funds', idempotencyKey: `test-line:${p.userId}` }]));
  return p;
}

describe('1.3.3: the regular line and „Пусни пак“', () => {
  it('a line takes orders of its wagon kind to the other end (or anywhere)', () => {
    const line = { home: 1, far: 2, wagonType: 'hopper' as const };
    expect(lineFits(line, 1, { to: 2, wagonType: 'hopper' })).toBe(true);
    expect(lineFits(line, 2, { to: 1, wagonType: 'hopper' })).toBe(true);
    expect(lineFits(line, 1, { to: 3, wagonType: 'hopper' })).toBe(false);
    expect(lineFits(line, 1, { to: 2, wagonType: 'tank' })).toBe(false);
    expect(lineFits({ ...line, far: null, wagonType: null }, 1, { to: 9, wagonType: 'tank' })).toBe(true);
  });

  it('the arrival notification offers „Пусни пак“ (a button that sends the train)', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(notificationButtons(`/game/trains?train=${id}&trainAgain=${id}`)).toEqual([{ label: '🚆 Пусни пак', action: { type: 'trainAgain', trainId: id }, primary: true }]);
  });

  it('the worker runs the line: the free train takes the best fitting order, again after it arrives', async () => {
    const p = await owner();
    let now = new Date();
    const n = { loco: 'danubia-d22' as const, wagonType: 'hopper' as const, wagons: 22, terminalId: SOFIA };
    const fits = (t: number) => ordersAt(SOFIA, t).some((o) => o.stops.every((s) => DOMESTIC.has(s)) && !cannotTake({ ...n, run: null, at: SOFIA, wagons: { hopper: 22 } }, o));
    for (let i = 0; i < 80 && !fits(now.getTime()); i++) now = new Date(now.getTime() + TRAINS.windowHours * 3_600_000);
    const train = await buyTrain(db(), p.userId, n, now);
    expect(await code(sendBest(db(), p.userId, train.id, now, () => false))).toBe('no_order');
    await setTrainLine(db(), p.userId, train.id, { home: SOFIA, far: null, wagonType: 'hopper', emptyBack: false }, now);
    expect((await trainRow(train.id)).line).toMatchObject({ on: true, home: SOFIA, wagonType: 'hopper' });
    expect(await runLines(db(), now)).toBeGreaterThanOrEqual(1);
    const first = await trainRow(train.id);
    expect(first.run?.wagonType).toBe('hopper');
    // Arrival: paid, then the line sends it on from there when something fits.
    const arrive = new Date(new Date(first.run!.arriveAt).getTime() + 1000);
    await settleTrains(db(), arrive);
    expect((await trainRow(train.id)).runs).toBe(1);
    const notes = await db().select({ href: notifications.href }).from(notifications).where(eq(notifications.userId, p.userId));
    expect(notes.map((x) => x.href)).toContain(`/game/trains?train=${train.id}`);
    // Turned off: the worker leaves it alone.
    await setTrainLine(db(), p.userId, train.id, null, arrive);
    expect((await trainRow(train.id)).line).toBeNull();
  });
});
