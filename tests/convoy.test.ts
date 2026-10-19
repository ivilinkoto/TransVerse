import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, friendships, ledgerEntries, notifications, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const truck = async (userId: string) => {
  const [c] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [v] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, c!.id), sql`${vehicles.soldAt} is null`));
  return { accountId: c!.id, vehicleId: v!.id };
};
const befriend = (a: string, b: string) => db().insert(friendships).values({ requesterId: a, addresseeId: b, status: 'accepted' });

describe('convoy', () => {
  it('friends on the same lane drive together and each gets the bonus on time', async () => {
    const a = await newPlayer('Sofia');
    const b = await newPlayer('Sofia');
    await befriend(a.userId, b.userId);
    const ta = await truck(a.userId);
    const tb = await truck(b.userId);
    const da = await acceptContract(db(), a.userId, (await makeContract('Sofia', 'Plovdiv')).id, ta.vehicleId);
    const db2 = await acceptContract(db(), b.userId, (await makeContract('Sofia', 'Plovdiv')).id, tb.vehicleId);
    const [ra] = await db().select().from(deliveries).where(eq(deliveries.id, da.id));
    const [rb] = await db().select().from(deliveries).where(eq(deliveries.id, db2.id));
    expect(ra!.convoyWith).toBe(db2.id);
    expect(rb!.convoyWith).toBe(da.id);
    const titles = (await db().select().from(notifications).where(eq(notifications.userId, a.userId))).map((n) => n.title);
    expect(titles).toContainEqual(expect.stringContaining('Конвой с'));

    await settleDueDeliveries(db(), new Date(Math.max(da.etaAt.getTime(), db2.etaAt.getTime()) + 1000));
    for (const [d, account] of [[da, ta.accountId], [db2, tb.accountId]] as const) {
      const bonus = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, account), eq(ledgerEntries.category, 'convoy_bonus'), eq(ledgerEntries.refId, d.id)));
      expect(bonus).toHaveLength(1);
      expect(bonus[0]!.amountCents).toBeGreaterThan(0);
    }
  });

  it('no convoy with a stranger, on another lane, or with a third truck', async () => {
    const a = await newPlayer('Sofia');
    const stranger = await newPlayer('Sofia');
    const friend = await newPlayer('Sofia');
    const third = await newPlayer('Sofia');
    await befriend(a.userId, friend.userId);
    await befriend(a.userId, third.userId);
    const d1 = await acceptContract(db(), a.userId, (await makeContract('Sofia', 'Burgas')).id, (await truck(a.userId)).vehicleId);
    const d2 = await acceptContract(db(), stranger.userId, (await makeContract('Sofia', 'Burgas')).id, (await truck(stranger.userId)).vehicleId);
    const d3 = await acceptContract(db(), friend.userId, (await makeContract('Sofia', 'Varna')).id, (await truck(friend.userId)).vehicleId);
    const d4 = await acceptContract(db(), third.userId, (await makeContract('Sofia', 'Burgas')).id, (await truck(third.userId)).vehicleId);
    const rows = await db().select({ id: deliveries.id, convoyWith: deliveries.convoyWith }).from(deliveries).where(sql`${deliveries.id} in (${sql.join([d1.id, d2.id, d3.id, d4.id].map((x) => sql`${x}`), sql`, `)})`);
    const by = new Map(rows.map((r) => [r.id, r.convoyWith]));
    expect(by.get(d2.id)).toBeNull();
    expect(by.get(d3.id)).toBeNull();
    // The friend on the same lane pairs with a; nobody else can join that pair.
    expect(by.get(d4.id)).toBe(d1.id);
    expect(by.get(d1.id)).toBe(d4.id);
  });
});
