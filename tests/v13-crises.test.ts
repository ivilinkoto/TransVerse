import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the feature as released (before the date it is staff-only).
vi.mock('@/server/features', async (load) => ({ ...(await load<typeof import('@/server/features')>()), featureFor: async () => true }));
import { CRISES, CRISIS_RULES, crisisAt, crisisOutcome } from '@/lib/game/crises';
import { closeDb } from '@/server/db/client';
import { companies, jobState, ledgerEntries } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { crisisView, recordCrisisDelivery, voteCrisis } from '@/server/game/crises';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const at = (s: string) => new Date(s);

describe('1.3 „Световни кризи“ — rules', () => {
  it('a crisis every 14 days from 13.11: three crisis days, seven days of effect', () => {
    expect(crisisAt(at('2026-11-12T23:00:00+02:00'))).toBeNull();
    expect(crisisAt(at('2026-11-13T00:10:00+02:00'))).toMatchObject({ id: 'port_strike', n: 0, dayIndex: 0, phase: 'crisis' });
    expect(crisisAt(at('2026-11-16T10:00:00+02:00'))).toMatchObject({ phase: 'effect', dayIndex: 3 });
    expect(crisisAt(at('2026-11-23T10:00:00+02:00'))).toBeNull();
    expect(crisisAt(at('2026-11-27T10:00:00+02:00'))).toMatchObject({ id: 'fuel_shortage', n: 1 });
    expect(Object.keys(CRISES)).toHaveLength(4);
  });

  it('the outcome: the option with more votes (a on a tie); full bonus with 2 of 3 goals', () => {
    expect(crisisOutcome({ a: 3, b: 5 }, 2)).toEqual({ option: 'b', share: CRISIS_RULES.bonus.full });
    expect(crisisOutcome({ a: 2, b: 2 }, 1)).toEqual({ option: 'a', share: CRISIS_RULES.bonus.half });
  });
});

describe('1.3 „Световни кризи“ — on the server', () => {
  it('votes once, counts tonnes to the crisis country, then pays the winning way', async () => {
    await db().delete(jobState).where(like(jobState.key, 'crisis:0'));
    const p = await newPlayer();
    const q = await newPlayer();
    const day1 = at('2026-11-13T12:00:00+02:00');
    expect(await code(voteCrisis(db(), p.userId, 'b', at('2026-11-12T12:00:00+02:00')))).toBe('no_crisis');
    await voteCrisis(db(), p.userId, 'b', day1);
    await voteCrisis(db(), q.userId, 'b', day1);
    expect(await code(voteCrisis(db(), p.userId, 'a', day1))).toBe('voted');
    const [acc] = await db().select({ id: companies.id }).from(companies).where(eq(companies.ownerId, p.userId));
    const trip = (n: number, dest: string, tons: number, when: Date) => db().transaction((tx) => recordCrisisDelivery(tx, { userId: p.userId, companyId: acc!.id, deliveryId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, destCountry: dest, tons, rewardCents: 100_000 }, when));
    // Day 1 and day 2 reach the goal; elsewhere does not count.
    await trip(1, 'RO', CRISIS_RULES.dailyTons, day1);
    await trip(2, 'HU', 500, day1);
    await trip(3, 'RO', CRISIS_RULES.dailyTons, at('2026-11-14T12:00:00+02:00'));
    const view = await crisisView(db(), p.userId, at('2026-11-15T12:00:00+02:00'));
    expect(view.myVote).toBe('b');
    expect(view.state!.tons.slice(0, 2)).toEqual([CRISIS_RULES.dailyTons, CRISIS_RULES.dailyTons]);
    expect(view.state!.votes).toEqual({ a: 0, b: 2 });
    // The effect: way b (Варна → BG), full bonus; only to BG.
    const effect = at('2026-11-17T12:00:00+02:00');
    expect((await crisisView(db(), p.userId, effect)).outcome).toEqual({ option: 'b', share: CRISIS_RULES.bonus.full });
    await trip(4, 'RO', 10, effect);
    await trip(5, 'BG', 10, effect);
    await trip(5, 'BG', 10, effect);
    const lines = await db().select({ a: ledgerEntries.amountCents }).from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc!.id), like(ledgerEntries.idempotencyKey, '%:crisis')));
    expect(lines.map((x) => x.a)).toEqual([10_000]);
  });
});
