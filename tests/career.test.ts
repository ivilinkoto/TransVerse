import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { companies, vehicles } from '@/server/db/schema';
import { playerCareer } from '@/server/game/career';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

async function deliver(userId: string, to: string, tons: number) {
  const [c] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [v] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, c!.id), sql`${vehicles.soldAt} is null`));
  const d = await acceptContract(db(), userId, (await makeContract('Sofia', to, { weightTons: tons })).id, v!.id);
  await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), c!.id);
}

describe('player career', () => {
  it('totals, records, favourite lanes and recent trips without money', async () => {
    const p = await newPlayer('Sofia');
    expect((await playerCareer(db(), p.userId))!.trips).toBe(0);
    await deliver(p.userId, 'Plovdiv', 4);
    // The truck is now in Plovdiv: move it back for the next Sofia load.
    const [c] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    await db().update(vehicles).set({ cityId: p.hq.id }).where(eq(vehicles.companyId, c!.id));
    await deliver(p.userId, 'Burgas', 6);
    const career = (await playerCareer(db(), p.userId))!;
    expect(career.trips).toBe(2);
    expect(career.tons).toBe(10);
    expect(career.longest!.to).toBe('Бургас');
    expect(career.heaviest!.tons).toBe(6);
    expect(career.lanes).toHaveLength(2);
    expect(career.recent[0]!.to).toBe('Бургас');
    expect(JSON.stringify(career)).not.toMatch(/Cents|reward|payout/i);
  });
});
