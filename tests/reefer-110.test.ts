import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { rangeFor, REEFER, simulateReefer, slipChance } from '@/lib/game/reefer';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, ledgerEntries, vehicles } from '@/server/db/schema';
import { acceptContract } from '@/server/game/deliveries';
import { settleReefer } from '@/server/game/reefer';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length]!;
};

describe('v1.10 refrigerated loads', () => {
  it('ranges by goods; a worn unit, a long trip and summer slip more; medicines are strict', () => {
    expect(rangeFor('Замразено месо')).toMatchObject({ min: -22, max: -18 });
    expect(rangeFor('Лекарства').strict).toBeGreaterThan(1);
    expect(rangeFor('Млечни продукти')).toMatchObject({ min: 0, max: 6 });
    const good = slipChance({ condition: 100, hours: 2, summer: false, strict: 1 });
    const bad = slipChance({ condition: 40, hours: 10, summer: true, strict: 1 });
    expect(bad).toBeGreaterThan(good);
    expect(slipChance({ condition: 40, hours: 10, summer: true, strict: 1.6 })).toBeGreaterThan(bad);
    const fine = simulateReefer(rangeFor('Цветя'), 0.1, seq(0.5));
    expect(fine.outcome).toBe('perfect');
    expect(fine.readings).toHaveLength(REEFER.readings);
    expect(fine.readings.every((v) => v >= 2 && v <= 6)).toBe(true);
    expect(simulateReefer(rangeFor('Цветя'), 0.9, seq(0.1)).outcome).toBe('spoiled');
  });

  it('on arrival: the readings are kept and the pay changes', async () => {
    const p = await newPlayer();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv')).id, truck!.id);
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    const cents = await db().transaction((tx) => settleReefer(tx, p.userId, row!, { cargoType: 'refrigerated', goods: 'Лекарства' }, 30, 1_000_00, new Date(), seq(0.1)));
    expect(cents).toBe(-400_00);
    const [after] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(after!.reefer).toMatchObject({ min: 2, max: 8, outcome: 'spoiled' });
    const [entry] = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.refId, d.id), eq(ledgerEntries.idempotencyKey, `delivery:${d.id}:reefer`)));
    expect(entry!.amountCents).toBe(-400_00);
    expect(await db().transaction((tx) => settleReefer(tx, p.userId, row!, { cargoType: 'pallets', goods: 'Мебели' }, 30, 1_000_00, new Date()))).toBe(0);
  });
});
