import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { TRAILER_UPGRADES } from '@/lib/game/catalog';
import { COMPANY_TRAILERS } from '@/lib/game/company-fleet';
import { upgradeFactor } from '@/lib/game/economy';
import { closeDb } from '@/server/db/client';
import { companies, depots, organizations, orgTrailers, trailers, treasuryEntries, vehicles } from '@/server/db/schema';
import { borrowOrgTrailer, buyOrgTrailer, companyTrailerBonus, returnOrgTrailer, sellOrgTrailer, upgradeOrgTrailer } from '@/server/game/company-trailers';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyDepot, buyTrailer, buyVehicle, coupleTrailer, installTrailerUpgrade, moveToDepot } from '@/server/game/fleet';
import { approximateProvider } from '@/server/geo/routing';
import { cityByName, db, makeContract, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const account = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;

async function rich(start = 'Sofia') {
  const p = await playerWithCompany(start);
  const acc = await account(p.userId);
  await db().update(companies).set({ balanceCents: 2_000_000_00 }).where(eq(companies.id, acc.id));
  await db().execute(sql`update users set level = 5, xp = 999999 where id = ${p.userId}`);
  return { ...p, acc };
}

describe('moving to a depot', () => {
  it('a truck goes to a depot in a minute, pays the road and picks up the trailer there', async () => {
    const p = await rich('Sofia');
    const tractor = await buyVehicle(db(), p.userId, 'danubia-t440', p.hq.id);
    const plovdiv = await cityByName('Plovdiv');
    const depot = await buyDepot(db(), p.userId, plovdiv.id);
    const trailer = await buyTrailer(db(), p.userId, 'curtain-13', plovdiv.id);
    expect(await code(coupleTrailer(db(), p.userId, tractor.id, trailer.id))).toBe('different_city');
    const before = (await account(p.userId)).balanceCents;
    const now = new Date();
    const move = await moveToDepot(db(), p.userId, tractor.id, depot.id, now, approximateProvider);
    expect(move.km).toBeGreaterThan(100);
    expect((await account(p.userId)).balanceCents).toBe(before - move.costCents);
    const [v] = await db().select().from(vehicles).where(eq(vehicles.id, tractor.id));
    expect(v!.cityId).toBe(plovdiv.id);
    expect(await code(moveToDepot(db(), p.userId, tractor.id, depot.id, now, approximateProvider))).toBe('same_city');
    // Still on the road for a minute: no coupling, no loads.
    expect(await code(coupleTrailer(db(), p.userId, tractor.id, trailer.id))).toBe('moving');
    const c = await makeContract('Plovdiv', 'Sofia');
    expect(await code(acceptContract(db(), p.userId, c.id, tractor.id))).toBe('moving');
    await db().update(vehicles).set({ movingUntil: new Date(Date.now() - 1000) }).where(eq(vehicles.id, tractor.id));
    await coupleTrailer(db(), p.userId, tractor.id, trailer.id);
    expect((await db().select().from(trailers).where(eq(trailers.id, trailer.id)))[0]!.vehicleId).toBe(tractor.id);
    const [other] = await db().select().from(depots).where(and(eq(depots.companyId, p.acc.id), eq(depots.cityId, p.hq.id)));
    if (other) {
      await moveToDepot(db(), p.userId, tractor.id, other.id, new Date(), approximateProvider);
      expect((await db().select().from(trailers).where(eq(trailers.id, trailer.id)))[0]!.cityId).toBe(p.hq.id);
    }
  });
});

describe('trailer upgrades', () => {
  it('save fuel, are paid once, the logo carries the company name', async () => {
    expect(upgradeFactor(['eco_tune', 'aero_skirts'], 'fuel')).toBeCloseTo(0.92 * 0.96);
    const p = await rich('Sofia');
    const t = await buyTrailer(db(), p.userId, 'curtain-13', p.hq.id);
    const before = (await account(p.userId)).balanceCents;
    await installTrailerUpgrade(db(), p.userId, t.id, 'aero_skirts');
    expect(await code(installTrailerUpgrade(db(), p.userId, t.id, 'aero_skirts'))).toBe('already_installed');
    await installTrailerUpgrade(db(), p.userId, t.id, 'company_logo');
    const [row] = await db().select().from(trailers).where(eq(trailers.id, t.id));
    expect(row!.upgrades).toEqual(['aero_skirts', 'company_logo']);
    expect(row!.logo).toMatch(/^ТЕСТ /);
    expect((await account(p.userId)).balanceCents).toBe(before - TRAILER_UPGRADES.aero_skirts.priceCents - TRAILER_UPGRADES.company_logo.priceCents);
    const lowbed = await buyTrailer(db(), p.userId, 'lowbed-4', p.hq.id).catch(() => null);
    if (lowbed) expect(await code(installTrailerUpgrade(db(), p.userId, lowbed.id, 'aero_skirts'))).toBe('not_applicable');
  });
});

describe('company trailers', () => {
  it('bought from the treasury, borrowed with the logo, bonus to the treasury, returned', async () => {
    const owner = await rich('Sofia');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    expect(await code(buyOrgTrailer(db(), owner.userId, 'curtain-13'))).toBe('no_parking');
    await db().update(organizations).set({ treasuryCents: 500_000_00, upgrades: { parking: 1 } }).where(eq(organizations.id, org!.id));
    const ot = await buyOrgTrailer(db(), owner.userId, 'curtain-13');
    await upgradeOrgTrailer(db(), owner.userId, ot.id, 'led_markers');
    expect(await code(upgradeOrgTrailer(db(), owner.userId, ot.id, 'company_logo'))).toBe('unknown_upgrade');
    const borrowed = await borrowOrgTrailer(db(), owner.userId, ot.id);
    expect(borrowed.ownership).toBe('company');
    expect(borrowed.upgrades).toEqual(['led_markers', 'company_logo']);
    expect(borrowed.logo).toMatch(/^ТЕСТ /);
    expect(await code(borrowOrgTrailer(db(), owner.userId, ot.id))).toBe('lent');
    expect(await code(sellOrgTrailer(db(), owner.userId, ot.id))).toBe('lent');

    // The bonus of a trip (paid by the game into the treasury, once per delivery).
    const id = '00000000-0000-4000-8000-000000000001';
    await db().transaction((tx) => companyTrailerBonus(tx, org!.id, id, 100_000, owner.username));
    await db().transaction((tx) => companyTrailerBonus(tx, org!.id, id, 100_000, owner.username));
    const bonus = await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, org!.id), eq(treasuryEntries.refId, id)));
    expect(bonus.map((b) => b.amountCents)).toEqual([100_000 * COMPANY_TRAILERS.treasuryShare]);

    await db().update(trailers).set({ condition: 80 }).where(eq(trailers.id, borrowed.id));
    await returnOrgTrailer(db(), owner.userId, borrowed.id);
    const [back] = await db().select().from(orgTrailers).where(eq(orgTrailers.id, ot.id));
    expect(back!.lentTo).toBeNull();
    expect(back!.condition).toBe(80);
    const value = await sellOrgTrailer(db(), owner.userId, ot.id);
    expect(value).toBeGreaterThan(0);
  });
});
