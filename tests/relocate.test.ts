import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES, featureLive } from '@/lib/game/features';
import { RELOCATE, relocateQuote } from '@/lib/game/relocate';
import { closeDb } from '@/server/db/client';
import { companies, ledgerEntries, vehicles } from '@/server/db/schema';
import { relocateVehicle } from '@/server/game/fleet';
import { cityByName, db, newPlayer } from './helpers';

afterAll(() => closeDb());

const truckOf = async (userId: string) => {
  const [co] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  return { co: co!, v: (await db().select().from(vehicles).where(eq(vehicles.companyId, co!.id)))[0]! };
};

describe('1.2.3.3 a truck to any city', () => {
  it('is live now (1.2.3.3 is out)', () => {
    expect(FEATURES.truck_relocate).toBe('1.2.3.3');
    expect(featureLive('truck_relocate', new Date('2026-11-07T13:00:00+02:00'))).toBe(true);
  });

  it('the price and time grow with the distance', () => {
    const sofia: [number, number] = [42.7, 23.32];
    const near = relocateQuote(sofia, [42.15, 24.75]);
    const far = relocateQuote(sofia, [48.2, 16.37]);
    expect(near.km).toBeGreaterThan(100);
    expect(far.costCents).toBeGreaterThan(near.costCents);
    expect(far.minutes).toBeGreaterThan(near.minutes);
    expect(near.costCents).toBe(RELOCATE.baseCents + Math.round(near.km * RELOCATE.centsPerKm));
    expect(relocateQuote(sofia, [55.75, 37.6]).minutes).toBeLessThanOrEqual(RELOCATE.maxHours * 60);
  });

  it('pays from the account, moves the truck (and its trailer) and keeps it busy until it arrives', async () => {
    const p = await newPlayer('Sofia');
    const { co, v } = await truckOf(p.userId);
    const varna = await cityByName('Varna');
    const now = new Date();
    const r = await relocateVehicle(db(), p.userId, v.id, varna.id, now);
    const [moved] = await db().select().from(vehicles).where(eq(vehicles.id, v.id));
    expect(moved!.cityId).toBe(varna.id);
    expect(moved!.movingUntil!.getTime()).toBe(r.arrivesAt.getTime());
    expect(r.arrivesAt.getTime() - now.getTime()).toBeGreaterThan(60 * 60_000);
    const [paid] = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, co.id), eq(ledgerEntries.category, 'relocation')));
    expect(paid!.amountCents).toBe(-r.costCents);
    // On the way: no second move.
    await expect(relocateVehicle(db(), p.userId, v.id, (await cityByName('Plovdiv')).id, now)).rejects.toThrow();
  });

  it('refuses a truck of another player and the same city', async () => {
    const a = await newPlayer('Sofia');
    const b = await newPlayer('Sofia');
    const { v } = await truckOf(a.userId);
    await expect(relocateVehicle(db(), b.userId, v.id, (await cityByName('Varna')).id)).rejects.toThrow();
    await expect(relocateVehicle(db(), a.userId, v.id, v.cityId)).rejects.toThrow();
  });
});
