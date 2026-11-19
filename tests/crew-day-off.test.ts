import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { onDutyCrew } from '@/lib/game/crew';
import { truckBlock } from '@/lib/game/truck-ready';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, drivers, vehicles } from '@/server/db/schema';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const NOW = new Date();
const OFF = new Date(NOW.getTime() + 6 * 3_600_000);
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

/** A player's truck with the player at the wheel and a hired co-driver. */
async function crewTruck() {
  const p = await newPlayer();
  const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
  const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
  const [owner] = await db().select().from(drivers).where(eq(drivers.companyId, acc!.id));
  const [co] = await db().insert(drivers).values({ companyId: acc!.id, name: 'Петър Тестов', skill: 1, salaryCentsPerDay: 100_00, coVehicleId: truck!.id }).returning();
  return { userId: p.userId, truck: truck!, owner: owner!, co: co! };
}

describe('two drivers: a day off for one is not a day off for both', () => {
  it('the rule: the other one drives alone', () => {
    const a = { id: 'a', vacationUntil: null }, b = { id: 'b', vacationUntil: null };
    const off = (d: { id: string }) => ({ ...d, vacationUntil: OFF });
    expect(onDutyCrew(a, b, NOW)).toEqual({ driver: a, coDriver: b });
    expect(onDutyCrew(a, off(b), NOW)).toEqual({ driver: a, coDriver: null });
    expect(onDutyCrew(off(a), b, NOW)).toEqual({ driver: b, coDriver: null });
    expect(onDutyCrew(off(a), off(b), NOW)).toBeNull();
    expect(onDutyCrew(off(a), null, NOW)).toBeNull();
    // The truck is ready while one of the two can drive.
    const truck = { id: 't', status: 'idle', condition: 100, model: { kind: 'van' }, trailer: null, delivery: null };
    expect(truckBlock({ ...truck, driver: off(a), coDriver: b }, NOW)).toBeNull();
    expect(truckBlock({ ...truck, driver: off(a), coDriver: off(b) }, NOW)?.reason).toBe('Шофьорът е в почивен ден.');
  });

  it('the co-driver on a day off: the main driver takes the load alone', async () => {
    const t = await crewTruck();
    await db().update(drivers).set({ vacationUntil: OFF }).where(eq(drivers.id, t.co.id));
    const job = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), t.userId, job.id, t.truck.id);
    const [row] = await db().select({ driverId: deliveries.driverId, coDriverId: deliveries.coDriverId }).from(deliveries).where(eq(deliveries.id, d.id));
    expect(row).toEqual({ driverId: t.owner.id, coDriverId: null });
  });

  it('the main driver on a day off: the co-driver drives; both off: the truck waits', async () => {
    const t = await crewTruck();
    await db().update(drivers).set({ vacationUntil: OFF }).where(eq(drivers.id, t.owner.id));
    const job = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), t.userId, job.id, t.truck.id);
    const [row] = await db().select({ driverId: deliveries.driverId, coDriverId: deliveries.coDriverId }).from(deliveries).where(eq(deliveries.id, d.id));
    expect(row).toEqual({ driverId: t.co.id, coDriverId: null });

    const both = await crewTruck();
    await db().update(drivers).set({ vacationUntil: OFF }).where(eq(drivers.companyId, (await db().select({ c: drivers.companyId }).from(drivers).where(eq(drivers.id, both.co.id)))[0]!.c));
    expect(await code(acceptContract(db(), both.userId, (await makeContract('Sofia', 'Plovdiv')).id, both.truck.id))).toBe('vacation');
  });
});
