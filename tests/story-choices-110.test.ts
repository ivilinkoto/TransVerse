import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { choiceOutcome, scenarioById, shrinkAfter } from '@/lib/game/road-choices';
import { STORY, taskStep } from '@/lib/game/story';
import { closeDb } from '@/server/db/client';
import { coinEntries, companies, deliveries, ledgerEntries, storyProgress, vehicles } from '@/server/db/schema';
import { acceptContract, settleDelivery } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { decideChoice, planChoice, tickChoices } from '@/server/game/road-choices';
import { storyDelivered } from '@/server/game/story';
import { cityByName, db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());
beforeAll(() => {
  process.env.ROAD_EVENTS = 'off';
});

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
async function onTheRoad() {
  const p = await newPlayer('Sofia');
  const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, (await accountOf(p.userId)).id));
  const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Varna', { rewardCents: 1_000_00 })).id, truck!.id);
  const now = Date.now();
  await db().update(deliveries).set({ choice: { id: 'jam', at: now - 60_000, deadline: now + 10 * 60_000 } }).where(eq(deliveries.id, d.id));
  const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
  return { p, d: row! };
}

describe('v1.10 decisions on the way', () => {
  it('the rules: time saved shrinks the rest of the trip; a gamble can go wrong', () => {
    const segs = [{ start: 0, end: 100 }, { start: 100, end: 200 }];
    const out = shrinkAfter(segs, 100, 50);
    expect(out[1]!.end).toBe(150);
    expect(shrinkAfter(segs, 100, 1_000)[1]!.end).toBe(150); // never below half of what is left
    const shortcut = scenarioById('shortcut')!;
    expect(choiceOutcome(shortcut.a, 0.9).saveMin).toBe(25);
    expect(choiceOutcome(shortcut.a, 0.1).delayMin).toBe(25);
  });

  it('a long trip may get a decision half-way; a short one never', async () => {
    const p = await newPlayer();
    const t0 = Date.now();
    const long = [{ kind: 'drive' as const, leg: 'loaded' as const, start: t0, end: t0 + 3 * 3_600_000, fromKm: 0, toKm: 200 }];
    const c = await planChoice(db(), p.userId, long, new Date(t0), () => 0.01);
    expect(c && c.at > t0 && c.at < t0 + 3 * 3_600_000).toBe(true);
    const short = [{ ...long[0]!, end: t0 + 20 * 60_000 }];
    expect(await planChoice(db(), p.userId, short, new Date(t0), () => 0.01)).toBeNull();
  });

  it('choosing changes the arrival and pays on arrival; once only', async () => {
    const { p, d } = await onTheRoad();
    await decideChoice(db(), p.userId, d.id, 'a');
    const [after] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(after!.etaAt.getTime()).toBeLessThan(d.etaAt.getTime());
    expect(after!.choice).toMatchObject({ decided: 'a', costCents: 20_00 });
    expect(await code(decideChoice(db(), p.userId, d.id, 'b'))).toBe('already');
    await db().transaction((tx) => settleDelivery(tx, d.id, new Date(after!.etaAt.getTime() + 60_000)));
    const [cost] = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.refId, d.id), eq(ledgerEntries.idempotencyKey, `delivery:${d.id}:choice-cost`)));
    expect(cost!.amountCents).toBe(-20_00);
  });

  it('without an answer the calm option goes when the time is up', async () => {
    const { d } = await onTheRoad();
    await tickChoices(db(), new Date(d.choice!.deadline + 60_000));
    const [after] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(after!.choice?.decided).toBe('b');
    expect(after!.etaAt.getTime()).toBeGreaterThan(d.etaAt.getTime());
  });
});

describe('v1.10 the story', () => {
  it('the first chapter: its three tasks, then the reward and the next chapter', async () => {
    const p = await newPlayer();
    const acc = await accountOf(p.userId);
    const cities = await Promise.all(['Plovdiv', 'Varna', 'Burgas'].map(cityByName));
    expect(taskStep(STORY[0]!.tasks[0], { onTime: true, km: 0, tons: 1, foreign: false, convoy: false, newCity: false })).toBe(1);
    const at = new Date();
    for (const c of cities) await db().transaction((tx) => storyDelivered(tx, p.userId, acc.id, { onTime: true, km: 120, tons: 2, foreign: false, convoy: false, destCityId: c.id }, at));
    const [s] = await db().select().from(storyProgress).where(eq(storyProgress.userId, p.userId));
    expect(s!.chapter).toBe(1);
    expect(s!.counts).toEqual([0, 0, 0]);
    const coins = await db().select().from(coinEntries).where(and(eq(coinEntries.userId, p.userId), eq(coinEntries.reason, 'story')));
    expect(coins[0]!.amount).toBe(STORY[0]!.coins);
    // Chapter 2 waits for level 3.
    await db().transaction((tx) => storyDelivered(tx, p.userId, acc.id, { onTime: true, km: 500, tons: 12, foreign: false, convoy: false, destCityId: cities[0]!.id }, at));
    expect((await db().select().from(storyProgress).where(eq(storyProgress.userId, p.userId)))[0]!.counts).toEqual([0, 0, 0]);
  });
});
