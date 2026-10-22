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
