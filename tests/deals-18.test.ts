import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { ghostLead, haggleAccepted, SEALED, sealedTier } from '@/lib/game/deals';
import { closeDb } from '@/server/db/client';
import { companies, ledgerEntries, vehicles } from '@/server/db/schema';
import { haggle } from '@/server/game/deals';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const account = async (userId: string) => {
  const [acc] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
  return { acc: acc!, truck: truck! };
};

describe('v1.8 deals', () => {
  it('sealed tiers and the ghost lead', () => {
    const tiers = Array.from({ length: 2000 }, (_, i) => sealedTier(`c-${i}`).id);
    const share = (id: string) => tiers.filter((t) => t === id).length / tiers.length;
    expect(share('ordinary')).toBeGreaterThan(0.6);
    expect(share('valuable')).toBeGreaterThan(0.18);
    expect(share('exceptional')).toBeGreaterThan(0.02);
    expect(share('exceptional')).toBeLessThan(0.09);
    expect(SEALED.tiers.map((t) => t.weight).reduce((a, b) => a + b, 0)).toBe(100);
    // Record 60 min; my loaded leg takes 50 → 10 min ahead.
    expect(ghostLead(0, 50 * 60_000, 60)).toBe(10);
    expect(ghostLead(0, 75 * 60_000, 60)).toBe(-15);
  });

  it('a sealed load opens on arrival on time', async () => {
    const p = await newPlayer();
    const { acc, truck } = await account(p.userId);
    const c = await makeContract('Sofia', 'Plovdiv', { sealed: true, rewardCents: 1_000_00 });
    const d = await acceptContract(db(), p.userId, c.id, truck.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc.id);
    const bonus = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc.id), eq(ledgerEntries.category, 'sealed_bonus')));
    const expected = Math.round(1_000_00 * sealedTier(c.id).bonus);
    expect(bonus.reduce((s, b) => s + b.amountCents, 0)).toBe(expected);
  });

  it('haggling: once; a yes pays the extra, a no takes the load away', async () => {
    const p = await newPlayer();
    const { acc, truck } = await account(p.userId);
    const small = await makeContract('Sofia', 'Plovdiv', { rewardCents: 500_00 });
    expect(await code(haggle(db(), p.userId, small.id, 10))).toBe('no_haggle');
    const c = await makeContract('Sofia', 'Plovdiv', { rewardCents: 2_000_00 });
    const r = await haggle(db(), p.userId, c.id, 20);
    expect(r.accepted).toBe(haggleAccepted(c.id, p.userId, 20));
    expect(await code(haggle(db(), p.userId, c.id, 10))).toBe('already_haggled');
    if (!r.accepted) {
      expect(await code(acceptContract(db(), p.userId, c.id, truck.id))).toBe('haggle_refused');
      return;
    }
    const d = await acceptContract(db(), p.userId, c.id, truck.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc.id);
    const extra = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc.id), eq(ledgerEntries.category, 'haggle_bonus')));
    expect(extra.map((e) => e.amountCents)).toEqual([40_000]);
  });
});
