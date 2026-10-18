import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, organizations, vehicles } from '@/server/db/schema';
import { companyHighlights } from '@/server/game/company-profile';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { joinCompany } from '@/server/game/membership';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

async function deliver(userId: string, from: string, to: string, weightTons: number): Promise<string> {
  const [account] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [v] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, account!.id), sql`${vehicles.soldAt} is null`, eq(vehicles.status, 'idle')));
  const contract = await makeContract(from, to, { weightTons });
  const d = await acceptContract(db(), userId, contract.id, v!.id);
  await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account!.id);
  return d.id;
}

describe('company profile', () => {
  it('counts the members’ trips since they joined, with records and history', async () => {
    const owner = await playerWithCompany('Sofia');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await db().update(organizations).set({ recruitment: 'open' }).where(eq(organizations.id, org!.id));
    const member = await newPlayer('Sofia');
    // A trip before joining does not count for the company.
    const before = await deliver(member.userId, 'Sofia', 'Burgas', 5);
    expect(await joinCompany(db(), member.userId, org!.id)).toBe('joined');
    await db().update(deliveries).set({ completedAt: new Date(Date.now() - 3_600_000) }).where(eq(deliveries.id, before));
    await deliver(member.userId, 'Sofia', 'Plovdiv', 6);
    await deliver(member.userId, 'Sofia', 'Varna', 4);

    const h = (await companyHighlights(db(), org!.id))!;
    expect(h.trips).toBe(2);
    expect(h.tons).toBe(10);
    expect(h.longest).toMatchObject({ player: member.username, to: 'Варна' });
    expect(h.heaviest).toMatchObject({ player: member.username, to: 'Пловдив' });
    expect(h.weekly[0]).toMatchObject({ player: member.username, trips: 2 });
    expect(h.history.map((e) => e.kind)).toEqual(expect.arrayContaining(['founded', 'joined']));
    expect(JSON.stringify(h)).not.toMatch(/Cents|balance/i);
  });
});
