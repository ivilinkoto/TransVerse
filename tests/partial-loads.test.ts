import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the feature as released (before the date it is staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { partError, partRewardCents, partTons } from '@/lib/game/partial';
import { closeDb } from '@/server/db/client';
import { companies, contracts, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('partial loads', () => {
  it('a truck takes what it carries, and enough must stay on the board', () => {
    expect(partTons(25, 6.2)).toBe(6.2);
    expect(partTons(25, 6.25)).toBe(6.2);
    expect(partTons(6, 6.2)).toBeNull();
    expect(partTons(6.5, 6.2)).toBe(6);
    expect(partTons(0.8, 0.4)).toBeNull();
    expect(partRewardCents({ weightTons: 25, rewardCents: 2_500_00 }, 6.2)).toBe(620_00);
    expect(partError(25, 7, 6.2)).toContain('побира');
    expect(partError(25, 0.3, 6.2)).toContain('0.5');
    expect(partError(6.5, 6.2, 6.2)).toBe('Вземи целия товар.');
    expect(partError(25, 6.2, 6.2)).toBeNull();
  });

  it('the part goes with the share of the pay; the rest stays on the board', async () => {
    const p = await newPlayer('Sofia');
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const job = await makeContract('Sofia', 'Plovdiv', { weightTons: 25, rewardCents: 2_500_00 });

    await expect(acceptContract(db(), p.userId, job.id, truck!.id)).rejects.toThrow(/надвишава/);
    await expect(acceptContract(db(), p.userId, job.id, truck!.id, new Date(), { tons: 9 })).rejects.toThrow(/побира/);

    const d = await acceptContract(db(), p.userId, job.id, truck!.id, new Date(), { tons: 1.3 });
    const [part] = await db().select().from(contracts).where(eq(contracts.id, d.contractId));
    const [rest] = await db().select().from(contracts).where(eq(contracts.id, job.id));
    expect(part!.id).not.toBe(job.id);
    expect(part).toMatchObject({ weightTons: 1.3, rewardCents: 130_00, status: 'accepted', acceptedByCompanyId: account!.id, goods: job.goods });
    expect(rest).toMatchObject({ weightTons: 23.7, rewardCents: 2_370_00, status: 'open' });

    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account!.id);
    const [done] = await db().select().from(contracts).where(eq(contracts.id, d.contractId));
    expect(done!.status).toBe('accepted');
  });

  it('urgent, groupage and private loads go only whole', async () => {
    const p = await newPlayer('Sofia');
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const urgent = await makeContract('Sofia', 'Plovdiv', { weightTons: 10, urgent: true });
    await expect(acceptContract(db(), p.userId, urgent.id, truck!.id, new Date(), { tons: 1 })).rejects.toThrow(/само цяла/);
    const trade = await makeContract('Sofia', 'Plovdiv', { weightTons: 10, status: 'trade', tradeCompanyId: account!.id });
    await expect(acceptContract(db(), p.userId, trade.id, truck!.id, new Date(), { tons: 1 })).rejects.toThrow(/само цяла/);
  });
});
