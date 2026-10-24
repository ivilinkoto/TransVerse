import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { dividendPool, nextSharePrice, SHARES } from '@/lib/game/shares';
import { closeDb } from '@/server/db/client';
import { companies, companyMembers, ledgerEntries, organizations, shareHoldings } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { post, postTreasury } from '@/server/game/finance';
import { buyShares, listCompany, payDividends, sellShares, updateSharePrices } from '@/server/game/shares';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const orgOf = async (ownerId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, ownerId)))[0]!;

describe('v1.8 share exchange', () => {
  it('price moves at most 10 % a day towards the value; dividends by the share outside', () => {
    expect(nextSharePrice(0, 100_000_00, 0)).toBe(100_00);
    expect(nextSharePrice(100_00, 1_000_000_00, 0)).toBe(110_00);
    expect(nextSharePrice(100_00, 0, 0)).toBe(90_00);
    expect(nextSharePrice(1_00, 0, 0)).toBe(SHARES.minPriceCents);
    expect(dividendPool(10_000_00, 400)).toBe(80_000);
  });

  it('list, buy into the treasury, hold, sell, prices and dividends', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    // Too young first, then 20 days old with two members.
    expect(await code(listCompany(db(), owner.userId))).toBe('too_young');
    await db().update(organizations).set({ createdAt: new Date(Date.now() - 20 * 86_400_000) }).where(eq(organizations.id, org.id));
    expect(await code(listCompany(db(), owner.userId))).toBe('too_small');
    const mate = await newPlayer();
    const [rank] = await db().select({ rankId: companyMembers.rankId }).from(companyMembers).where(eq(companyMembers.userId, owner.userId));
    await db().insert(companyMembers).values({ userId: mate.userId, companyId: org.id, rankId: rank!.rankId });
    await db().transaction((tx) => postTreasury(tx, org.id, [{ category: 'admin_adjustment', amountCents: 100_000_00, description: 'test', idempotencyKey: `t:${org.id}` }]));
    const { priceCents } = await listCompany(db(), owner.userId);
    expect(priceCents).toBeGreaterThanOrEqual(100_00);

    expect(await code(buyShares(db(), mate.userId, org.id, 5))).toBe('own_company');
    const investor = await newPlayer();
    const acc = await accountOf(investor.userId);
    await db().transaction((tx) => post(tx, acc.id, [{ category: 'admin_adjustment', amountCents: 50_000_00, description: 'test', idempotencyKey: `t:${acc.id}` }]));
    const before = (await accountOf(investor.userId)).balanceCents;
    const treasury0 = (await orgOf(owner.userId)).treasuryCents;
    await buyShares(db(), investor.userId, org.id, 10);
    expect((await accountOf(investor.userId)).balanceCents).toBe(before - Math.round(priceCents * 10 * (1 + SHARES.feeShare)));
    expect((await orgOf(owner.userId)).treasuryCents).toBe(treasury0 + priceCents * 10);
    expect(await code(buyShares(db(), investor.userId, org.id, SHARES.perPlayerMax))).toBe('too_many');
    expect(await code(sellShares(db(), investor.userId, org.id, 5))).toBe('locked');

    // A week of contributions: the price climbs (at most 10 %), Monday pays the dividend.
    await db().transaction((tx) => postTreasury(tx, org.id, [{ category: 'member_contribution', amountCents: 5_000_00, description: 'курс', idempotencyKey: `c:${org.id}` }]));
    await updateSharePrices(db());
    expect((await orgOf(owner.userId)).sharePriceCents).toBe(Math.round(priceCents * 1.1));
    await payDividends(db());
    const div = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc.id), eq(ledgerEntries.category, 'share_dividend')));
    expect(div.map((d) => d.amountCents)).toEqual([dividendPool(5_000_00, 10)]);
    await payDividends(db());
    expect(await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc.id), eq(ledgerEntries.category, 'share_dividend')))).toHaveLength(1);

    await db().update(shareHoldings).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(shareHoldings.userId, investor.userId));
    const sold = await sellShares(db(), investor.userId, org.id, 4);
    expect(sold).toEqual({ shares: 6, payoutCents: Math.round(Math.round(priceCents * 1.1) * 4 * SHARES.sellShare) });
  });
});
