import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { BRANCH, creditRating, creditTier, loanTerms } from '@/lib/game/business';
import { batchTons, recipeOf } from '@/lib/game/factory';
import { closeDb } from '@/server/db/client';
import { cityMarkets, companies, companyBuildings, companyFactories, contracts, depots, haulerRatings, ledgerEntries, loans, organizations, treasuryEntries, vehicles, warehouseStock } from '@/server/db/schema';
import { branchBonus, collectLoans, creditOf, ensureBranchLoads, openBranch, repayLoan, takeLoan } from '@/server/game/business';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyers, chooseRecipe, orderRaw, recordFactoryDelivery, runFactories, sellProduct } from '@/server/game/factory';
import { buyGoods, expireFreight, postFreight, rateHauler } from '@/server/game/trade';
import { approximateProvider } from '@/server/geo/routing';
import { cityByName, db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const account = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;
const truck = async (userId: string) => (await db().select().from(vehicles).where(and(eq(vehicles.companyId, (await account(userId)).id), sql`${vehicles.soldAt} is null`)))[0]!;

describe('the factory', () => {
  it('raw materials in, a batch, the product sold to a buyer for the treasury', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    await db().update(organizations).set({ companyLevel: 3, treasuryCents: 500_000_00 }).where(eq(organizations.id, org.id));
    expect(await code(chooseRecipe(db(), owner.userId, 'furniture'))).toBe('no_factory');
    await db().insert(companyBuildings).values({ organizationId: org.id, type: 'factory', x: 8, y: 4, level: 1 });
    await chooseRecipe(db(), owner.userId, 'furniture');
    const order = await orderRaw(db(), owner.userId, 1, new Date(), approximateProvider);
    expect(order.loads).toBe(2); // 8 t of timber in loads of at most 7 t
    expect(await code(orderRaw(db(), owner.userId, 1, new Date(), approximateProvider))).toBe('enough');
    const raw = await db().select().from(contracts).where(eq(contracts.factoryOrgId, org.id));
    // Strangers may not take the members' loads.
    const stranger = await newPlayer('Sofia');
    expect(await code(acceptContract(db(), stranger.userId, raw[0]!.id, (await truck(stranger.userId)).id))).toBe('members_only');
    for (const c of raw) await db().transaction((tx) => recordFactoryDelivery(tx, c));

    const t0 = new Date();
    await runFactories(db(), t0);
    let [f] = await db().select().from(companyFactories).where(eq(companyFactories.organizationId, org.id));
    expect(f!.batchEndsAt).not.toBeNull();
    expect(f!.stock.timber).toBe(0);
    await runFactories(db(), new Date(t0.getTime() + 7 * 3_600_000));
    [f] = await db().select().from(companyFactories).where(eq(companyFactories.organizationId, org.id));
    expect(f!.productTons).toBe(batchTons(recipeOf('furniture')!, 1));

    // A buyer that takes furniture (pallets) in this test.
    const plovdiv = await cityByName('Plovdiv');
    await db().insert(cityMarkets).values({ cityId: plovdiv.id, cargoType: 'pallets', produces: false, consumes: true, demand: 1 }).onConflictDoUpdate({ target: [cityMarkets.cityId, cityMarkets.cargoType], set: { consumes: true, demand: 1 } });
    const b = (await buyers(db(), org.id))[0]!;
    const sale = await sellProduct(db(), owner.userId, b.cityId, new Date(), approximateProvider);
    expect(sale.tons).toBe(6);
    const products = await db().select().from(contracts).where(and(eq(contracts.factoryOrgId, org.id), eq(contracts.material, 'product')));
    const before = (await orgOf(owner.userId)).treasuryCents;
    for (const c of products) await db().transaction((tx) => recordFactoryDelivery(tx, c));
    expect((await orgOf(owner.userId)).treasuryCents - before).toBe(Math.round(6 * b.priceCentsPerTon));
  });
});

describe('the freight exchange', () => {
  it('own goods hauled by another player: escrow, sale for the owner, pay for the hauler, a rating', async () => {
    const owner = await playerWithCompany('Sofia', 50_000_00);
    const acc = await account(owner.userId);
    const [depot] = await db().select().from(depots).where(eq(depots.companyId, acc.id));
    const sofia = await cityByName('Sofia');
    const plovdiv = await cityByName('Plovdiv');
    await db().insert(cityMarkets).values({ cityId: sofia.id, cargoType: 'pallets', produces: true, consumes: false }).onConflictDoUpdate({ target: [cityMarkets.cityId, cityMarkets.cargoType], set: { produces: true } });
    await db().insert(cityMarkets).values({ cityId: plovdiv.id, cargoType: 'pallets', produces: false, consumes: true, demand: 1 }).onConflictDoUpdate({ target: [cityMarkets.cityId, cityMarkets.cargoType], set: { consumes: true, demand: 1 } });
    await buyGoods(db(), owner.userId, { depotId: depot!.id, cargo: 'pallets', tons: 2 });
    expect(await code(postFreight(db(), owner.userId, { depotId: depot!.id, cargo: 'pallets', tons: 1, destCityId: plovdiv.id, mode: 'sell', priceCents: 1_00 }, new Date(), approximateProvider))).toBe('bad_price');
    const cash = (await account(owner.userId)).balanceCents;
    const id = await postFreight(db(), owner.userId, { depotId: depot!.id, cargo: 'pallets', tons: 1, destCityId: plovdiv.id, mode: 'sell', priceCents: 400_00 }, new Date(), approximateProvider);
    expect((await account(owner.userId)).balanceCents).toBe(cash - 400_00);
    expect(await code(acceptContract(db(), owner.userId, id, (await truck(owner.userId)).id))).toBe('own_offer');

    const hauler = await newPlayer('Sofia');
    const d = await acceptContract(db(), hauler.userId, id, (await truck(hauler.userId)).id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), (await account(hauler.userId)).id);
    const [sold] = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc.id), eq(ledgerEntries.category, 'trade_sale')));
    expect(sold!.amountCents).toBeGreaterThan(0);
    const [paid] = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, (await account(hauler.userId)).id), eq(ledgerEntries.category, 'freight')));
    expect(paid!.amountCents).toBe(400_00);
    await rateHauler(db(), owner.userId, id, 5);
    expect((await db().select().from(haulerRatings).where(eq(haulerRatings.contractId, id)))[0]!.stars).toBe(5);
    expect(await code(rateHauler(db(), owner.userId, id, 4))).toBe('not_found');

    // Nobody takes the second one: goods and money come back.
    const id2 = await postFreight(db(), owner.userId, { depotId: depot!.id, cargo: 'pallets', tons: 1, destCityId: plovdiv.id, mode: 'sell', priceCents: 400_00 }, new Date(), approximateProvider);
    const mid = (await account(owner.userId)).balanceCents;
    await expireFreight(db(), new Date(Date.now() + 25 * 3_600_000));
    expect((await account(owner.userId)).balanceCents).toBe(mid + 400_00);
    expect((await db().select().from(contracts).where(eq(contracts.id, id2)))[0]!.status).toBe('returned');
    expect((await db().select().from(warehouseStock).where(eq(warehouseStock.depotId, depot!.id)))[0]!.tons).toBe(1);
  });
});

describe('branches', () => {
  it('a branch in another city: loads of its own and a bonus on deliveries there', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    const plovdiv = await cityByName('Plovdiv');
    expect(await code(openBranch(db(), owner.userId, plovdiv.id))).toBe('no_slot');
    await db().update(organizations).set({ companyLevel: 4, treasuryCents: 100_000_00 }).where(eq(organizations.id, org.id));
    await openBranch(db(), owner.userId, plovdiv.id);
    expect((await orgOf(owner.userId)).treasuryCents).toBe(100_000_00 - BRANCH.priceCents);
    expect(await code(openBranch(db(), owner.userId, (await cityByName('Varna')).id))).toBe('no_slot');
    expect(await ensureBranchLoads(db(), new Date(), approximateProvider)).toBeGreaterThan(0);
    const own = await db().select().from(contracts).where(eq(contracts.branchOrgId, org.id));
    expect(own.every((c) => c.originCityId === plovdiv.id)).toBe(true);
    const acc = await account(owner.userId);
    const bonus = await db().transaction((tx) => branchBonus(tx, { id: '00000000-0000-0000-0000-000000000001', companyId: acc.id }, owner.userId, plovdiv.id, 1_000_00, new Date()));
    expect(bonus).toBe(Math.round(1_000_00 * BRANCH.bonusShare));
  });
});

describe('loans', () => {
  it('a rating, a loan, weekly payments, paying off early', async () => {
    expect(creditRating({ level: 1, deliveries: 0, onTimeShare: 0, paidLoans: 0, missedPayments: 0, accountAgeDays: 0 })).toBeGreaterThanOrEqual(520);
    expect(creditTier(800).maxCents).toBeGreaterThan(creditTier(600).maxCents);
    const p = await newPlayer('Sofia');
    const c = await creditOf(db(), p.userId);
    expect(c.tier.maxCents).toBeGreaterThan(0);
    const cash = (await account(p.userId)).balanceCents;
    expect(await code(takeLoan(db(), p.userId, 5_000_00, 5))).toBe('bad_weeks');
    const loan = await takeLoan(db(), p.userId, 5_000_00, 4);
    expect((await account(p.userId)).balanceCents).toBe(cash + 5_000_00);
    expect(await code(takeLoan(db(), p.userId, 1_000_00, 4))).toBe('active_loan');
    const terms = loanTerms(5_000_00, c.tier.rateBps, 4);
    await collectLoans(db(), new Date(loan.nextDueAt.getTime() + 1000));
    const [after] = await db().select().from(loans).where(eq(loans.id, loan.id));
    expect(after!.paidCents).toBe(terms.weeklyCents);
    await repayLoan(db(), p.userId);
    const [done] = await db().select().from(loans).where(eq(loans.id, loan.id));
    expect(done!.status).toBe('paid');
    expect((await creditOf(db(), p.userId)).rating).toBeGreaterThan(c.rating);
  });
});

void treasuryEntries;
