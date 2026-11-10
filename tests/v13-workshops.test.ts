import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the feature as released (before the date it is staff-only).
vi.mock('@/server/features', async (load) => ({ ...(await load<typeof import('@/server/features')>()), featureFor: async () => true, requireFeature: () => undefined }));
import { ownerShare, WORKSHOP } from '@/lib/game/workshops';
import { closeDb } from '@/server/db/client';
import { cities, companies, users, vehicles } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { repairVehicle } from '@/server/game/fleet';
import { getWorkshop, openWorkshop, rateWorkshop, setWorkshopPrice, upgradeWorkshop, workshopsView } from '@/server/game/workshops';
import { db, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const balance = async (userId: string) => (await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.ownerId, userId)))[0]!.b;

describe('1.3 „Собствен сервиз“', () => {
  it('open from level 10, set the price, upgrade; repairs pay the owner; no repairs at one\'s own; one rating', async () => {
    const owner = await playerWithCompany('Sofia', 200_000_00);
    const customer = await playerWithCompany('Sofia', 50_000_00);
    const now = new Date('2026-11-12T12:00:00+02:00');
    const [sofia] = await db().select({ id: cities.id }).from(cities).where(eq(cities.name, 'Sofia')).limit(1);
    expect(await code(openWorkshop(db(), owner.userId, sofia!.id, 'Сервиз Ас', now))).toBe('level');
    await db().update(users).set({ level: WORKSHOP.minLevel }).where(eq(users.id, owner.userId));
    const before = await balance(owner.userId);
    await openWorkshop(db(), owner.userId, sofia!.id, 'Сервиз Ас', now);
    expect(await balance(owner.userId)).toBe(before - WORKSHOP.openCents);
    expect(await code(openWorkshop(db(), owner.userId, sofia!.id, 'Втори', now))).toBe('has_workshop');
    expect(await code(setWorkshopPrice(db(), owner.userId, 150, now))).toBe('bad_price');
    expect(await setWorkshopPrice(db(), owner.userId, 80, now)).toBe(80);

    // The customer's truck in Sofia, worn.
    const [custAcc] = await db().select({ id: companies.id }).from(companies).where(eq(companies.ownerId, customer.userId));
    const [truck] = await db().select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.companyId, custAcc!.id)).limit(1);
    await db().update(vehicles).set({ condition: 50, cityId: sofia!.id, ownership: 'owned', status: 'idle' }).where(eq(vehicles.id, truck!.id));
    const view = await workshopsView(db(), customer.userId);
    expect(view.trucks.find((x) => x.id === truck!.id)?.workshops.map((w) => w.name)).toEqual(['Сервиз Ас']);

    const ownerBefore = await balance(owner.userId);
    const cost = await repairVehicle(db(), customer.userId, truck!.id, { workshop: owner.userId });
    expect(cost).toBeGreaterThan(0);
    expect(await balance(owner.userId)).toBe(ownerBefore + Math.round(cost * ownerShare(1)));
    const w = (await getWorkshop(db(), owner.userId))!;
    expect(w.repairs).toBe(1);

    // Owners cannot repair their own trucks in their workshop; a truck elsewhere cannot come in.
    const [ownAcc] = await db().select({ id: companies.id }).from(companies).where(eq(companies.ownerId, owner.userId));
    const [ownTruck] = await db().select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.companyId, ownAcc!.id)).limit(1);
    await db().update(vehicles).set({ condition: 50, cityId: sofia!.id, ownership: 'owned', status: 'idle' }).where(eq(vehicles.id, ownTruck!.id));
    expect(await code(repairVehicle(db(), owner.userId, ownTruck!.id, { workshop: owner.userId }))).toBe('own_workshop');
    const [varna] = await db().select({ id: cities.id }).from(cities).where(eq(cities.name, 'Varna')).limit(1);
    await db().update(vehicles).set({ condition: 40, cityId: varna!.id }).where(eq(vehicles.id, truck!.id));
    expect(await code(repairVehicle(db(), customer.userId, truck!.id, { workshop: owner.userId }))).toBe('wrong_city');

    await rateWorkshop(db(), customer.userId, owner.userId, 5, now);
    expect(await code(rateWorkshop(db(), customer.userId, owner.userId, 4, now))).toBe('rated');
    expect((await getWorkshop(db(), owner.userId))!).toMatchObject({ ratingSum: 5, ratingCount: 1 });

    expect(await upgradeWorkshop(db(), owner.userId, now)).toBe(2);
    expect(await upgradeWorkshop(db(), owner.userId, now)).toBe(3);
    expect(await code(upgradeWorkshop(db(), owner.userId, now))).toBe('max_level');
    expect(ownerShare(3)).toBe(0.9);
  });
});
