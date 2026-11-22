import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FLEET_UPKEEP, upkeepCents } from '@/lib/game/fleet-upkeep';
import { closeDb } from '@/server/db/client';
import { companies, ledgerEntries, vehicles } from '@/server/db/schema';
import { post } from '@/server/game/finance';
import { runFleetUpkeep } from '@/server/game/staff';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('1.3.2.1: the daily upkeep of an own fleet', () => {
  it('is free for the first trucks and dearer per truck the bigger the fleet', () => {
    expect(upkeepCents(0)).toBe(0);
    expect(upkeepCents(3)).toBe(0);
    expect(upkeepCents(4)).toBe(300_00);
    expect(upkeepCents(10)).toBe(7 * 300_00);
    expect(upkeepCents(11)).toBe(7 * 300_00 + 700_00);
    expect(upkeepCents(30)).toBe(7 * 300_00 + 15 * 700_00 + 5 * 1_500_00);
  });

  it('charges the day once, only owned trucks, never below zero, not before the start', async () => {
    const p = await newPlayer();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [first] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    // Five owned trucks and one rented: the two over the free three pay 300 lv. each; the rented one does not count.
    await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, first!.id));
    for (let i = 0; i < 4; i++) await db().insert(vehicles).values({ ...first!, id: undefined, plate: `U ${i} ${Date.now() % 10000}`, ownership: 'owned' });
    await db().insert(vehicles).values({ ...first!, id: undefined, plate: `R ${Date.now() % 10000}`, ownership: 'rented' });
    await db().transaction((tx) => post(tx, acc!.id, [{ category: 'admin_adjustment', amountCents: 10_000_00, description: 'test', idempotencyKey: `upkeep-fund:${acc!.id}` }]));
    const day = FLEET_UPKEEP.from;
    expect(await runFleetUpkeep(db(), '2026-11-29')).toBe(0);
    await runFleetUpkeep(db(), day);
    await runFleetUpkeep(db(), day);
    const rows = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc!.id), eq(ledgerEntries.idempotencyKey, `fleet-upkeep:${acc!.id}:${day}`)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountCents).toBe(-upkeepCents(5));
  });
});
