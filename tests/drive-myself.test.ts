import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { companies, drivers, vehicles } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { driveMyself } from '@/server/game/staff';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

async function setup() {
  const p = await newPlayer();
  const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
  const [first] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
  const [second] = await db().insert(vehicles).values({ ...first!, id: undefined, plate: `T ${Date.now() % 10000} XX` }).returning();
  return { p, acc: acc!, first: first!, second: second! };
}
const owner = async (companyId: string) => (await db().select().from(drivers).where(and(eq(drivers.companyId, companyId), eq(drivers.isOwner, true))))[0];

describe('„Карай този камион сам“', () => {
  it('moves the player to another idle truck; a hired driver there steps out', async () => {
    const { p, acc, second } = await setup();
    const [hired] = await db().insert(drivers).values({ companyId: acc.id, name: 'Петър', skill: 1, salaryCentsPerDay: 100_00, vehicleId: second.id }).returning();
    await driveMyself(db(), p.userId, second.id);
    expect((await owner(acc.id))!.vehicleId).toBe(second.id);
    expect((await db().select().from(drivers).where(eq(drivers.id, hired!.id)))[0]!.vehicleId).toBeNull();
  });

  it('makes the player’s own driver again when an old account lost it', async () => {
    const { p, acc, second } = await setup();
    await db().delete(drivers).where(and(eq(drivers.companyId, acc.id), eq(drivers.isOwner, true)));
    await driveMyself(db(), p.userId, second.id);
    const me = await owner(acc.id);
    expect(me).toMatchObject({ vehicleId: second.id, salaryCentsPerDay: 0 });
  });

  it('waits while the player drives another truck on a trip', async () => {
    const { p, acc, first, second } = await setup();
    await db().update(vehicles).set({ status: 'on_delivery' }).where(eq(vehicles.id, first.id));
    expect((await owner(acc.id))!.vehicleId).toBe(first.id);
    expect(await code(driveMyself(db(), p.userId, second.id))).toBe('driver_busy');
  });
});
