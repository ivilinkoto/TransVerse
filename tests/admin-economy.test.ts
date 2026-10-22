import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { economyOverview, fraudSignals } from '@/server/admin-economy';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('economy dashboard and fraud signals', () => {
  it('counts the money in the game and flags accounts from one network', async () => {
    await newPlayer();
    const eco = await economyOverview(db());
    expect(eco.total).toBe(eco.players + eco.treasuries);
    expect(eco.accounts).toBeGreaterThan(0);
    expect(eco.richest.length).toBeGreaterThan(0);
    expect(eco.flows.some((f) => f.income > 0)).toBe(true);
    expect(eco.accounts).toBeGreaterThan(0);

    const a = await newPlayer();
    const b = await newPlayer();
    const hash = `test-net-${Date.now()}`;
    await db().update(users).set({ signupIpHash: hash }).where(eq(users.id, a.userId));
    await db().update(users).set({ signupIpHash: hash }).where(eq(users.id, b.userId));
    const fraud = await fraudSignals(db());
    const net = fraud.networks.find((n) => n.users.includes(a.username));
    expect(net?.users).toEqual(expect.arrayContaining([a.username, b.username]));
  });
});

describe('pay balance', () => {
  it('suggests from the inflation, changes only when applied', async () => {
    const { BALANCE, applyPayFactor, balanceSuggestion, payFactor } = await import('@/server/admin-economy');
    expect(balanceSuggestion(0.01, 1)).toBeNull();
    expect(balanceSuggestion(0.1, 1)!.factor).toBeLessThan(1);
    expect(balanceSuggestion(-0.08, 1)!.factor).toBeGreaterThan(1);
    expect(balanceSuggestion(5, 1)!.factor).toBeGreaterThanOrEqual(1 - BALANCE.maxStep);
    const admin = await newPlayer();
    expect(await payFactor(db())).toBe(1);
    expect(await applyPayFactor(db(), admin.userId, 0.93)).toBe(0.93);
    expect(await payFactor(db())).toBe(0.93);
    await applyPayFactor(db(), admin.userId, 1);
  });
});

describe('planned events', () => {
  it('a planned event is announced once when it starts', async () => {
    const { globalEvents } = await import('@/server/db/schema');
    const { announceStartedEvents } = await import('@/server/game/events');
    const now = new Date();
    const [e] = await db().insert(globalEvents).values({ name: 'Тест старт', metric: 'tons', target: 1000, minContribution: 1, rewards: { participants: { eur: 1, xp: 1, coins: 0 }, top: [] } as never, startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 3_600_000), createdAt: new Date(now.getTime() - 86_400_000) }).returning();
    expect(await announceStartedEvents(db(), now)).toBeGreaterThanOrEqual(1);
    expect(await announceStartedEvents(db(), now)).toBe(0);
    // Gone again, so it does not take contributions from other test files.
    await db().delete(globalEvents).where(eq(globalEvents.id, e!.id));
  });
});
