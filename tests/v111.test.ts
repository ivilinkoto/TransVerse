import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { featureLive } from '@/lib/game/features';
import { cleanTruckName, TRUCK_NAME_MAX, truckLabel } from '@/lib/game/truck-names';
import { closeDb } from '@/server/db/client';
import { companies, users, vehicles } from '@/server/db/schema';
import { runAction } from '@/server/game/actions';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const ip = async () => '127.0.0.1';
async function truckOf(userId: string) {
  const [c] = await db().select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  const [v] = await db().select().from(vehicles).where(eq(vehicles.companyId, c!.id));
  return v!;
}
async function asUser(userId: string) {
  const [u] = await db().select({ id: users.id, role: users.role, username: users.username }).from(users).where(eq(users.id, userId));
  return u!;
}

describe('v1.1.1', () => {
  it('is live for players now', () => {
    expect(featureLive('truck_names', new Date())).toBe(true);
    expect(featureLive('online_now', new Date())).toBe(true);
  });

  it('cleans a truck name: one line, single spaces, at most the limit; empty clears it', () => {
    expect(cleanTruckName('  Бисер\n на  пътя ')).toBe('Бисер на пътя');
    expect(cleanTruckName('   ')).toBeNull();
    expect(cleanTruckName('я'.repeat(40))!.length).toBe(TRUCK_NAME_MAX);
    expect(truckLabel({ plate: 'CA 1234 AB', nickname: 'Бисер' })).toBe('Бисер · CA 1234 AB');
    expect(truckLabel({ plate: 'CA 1234 AB', nickname: null })).toBe('CA 1234 AB');
  });

  it('the owner names a truck through runAction; another player cannot', async () => {
    const p = await newPlayer();
    const other = await newPlayer();
    const truck = await truckOf(p.userId);
    const res = await runAction(db(), await asUser(p.userId), { type: 'nameVehicle', vehicleId: truck.id, name: '  Синята   стрела ' }, ip);
    expect(res).toMatchObject({ ok: true, nickname: 'Синята стрела' });
    expect((await truckOf(p.userId)).nickname).toBe('Синята стрела');
    await expect(runAction(db(), await asUser(other.userId), { type: 'nameVehicle', vehicleId: truck.id, name: 'Чужд' }, ip)).rejects.toMatchObject({ code: 'vehicle_not_found' });
    expect((await truckOf(p.userId)).nickname).toBe('Синята стрела');
    await runAction(db(), await asUser(p.userId), { type: 'nameVehicle', vehicleId: truck.id, name: '' }, ip);
    expect((await truckOf(p.userId)).nickname).toBeNull();
  });
});
