import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { RELAY } from '@/lib/game/relay';
import { tripStats } from '@/lib/game/trip-log';
import { closeDb } from '@/server/db/client';
import { companies, contracts, deliveries, ledgerEntries, relays, userBadges, vehicles } from '@/server/db/schema';
import { acceptContract, settleDelivery } from '@/server/game/deliveries';
import { expireRelays } from '@/server/game/relay';
import { shareTrip, tripLog, tripsOf } from '@/server/game/trip-log';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());
beforeAll(() => {
  process.env.ROAD_EVENTS = 'off';
});

const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (userId: string) => (await db().select().from(vehicles).where(eq(vehicles.companyId, (await accountOf(userId)).id)))[0]!;
async function drive(userId: string, contractId: string) {
  const d = await acceptContract(db(), userId, contractId, (await truckOf(userId)).id);
  const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
  await db().transaction((tx) => settleDelivery(tx, d.id, new Date(row!.etaAt.getTime() + 60_000)));
  return d.id;
}
async function relay() {
  const leg1 = await makeContract('Sofia', 'Plovdiv', { rewardCents: 800_00 });
  const leg2 = await makeContract('Plovdiv', 'Burgas', { rewardCents: 900_00, status: 'held' });
  const [r] = await db().insert(relays).values({ originCityId: leg1.originCityId, relayCityId: leg1.destCityId, destCityId: leg2.destCityId, leg1ContractId: leg1.id, leg2ContractId: leg2.id }).returning();
  await db().update(contracts).set({ relayId: r!.id, relayLeg: 1 }).where(eq(contracts.id, leg1.id));
  await db().update(contracts).set({ relayId: r!.id, relayLeg: 2 }).where(eq(contracts.id, leg2.id));
  return { r: r!, leg1, leg2 };
}

describe('v1.10 relay', () => {
  it('two drivers, one load: the hand-over opens the second leg; both on time — a bonus and a badge each', async () => {
    const a = await newPlayer('Sofia');
    const b = await newPlayer('Plovdiv');
    const { r, leg1, leg2 } = await relay();
    await drive(a.userId, leg1.id);
    const [mid] = await db().select().from(relays).where(eq(relays.id, r.id));
    expect(mid).toMatchObject({ status: 'leg2', leg1UserId: a.userId, leg1Late: false });
    const [open] = await db().select().from(contracts).where(eq(contracts.id, leg2.id));
    expect(open!.status).toBe('open');
    await drive(b.userId, leg2.id);
    const [done] = await db().select().from(relays).where(eq(relays.id, r.id));
    expect(done!.status).toBe('done');
    for (const [p, reward] of [[a, 800_00], [b, 900_00]] as const) {
      const [bonus] = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, (await accountOf(p.userId)).id), eq(ledgerEntries.idempotencyKey, `relay:${r.id}:${p === a ? 'leg1' : 'leg2'}`)));
      expect(bonus!.amountCents).toBe(Math.round(reward * RELAY.bonusShare));
      expect((await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, RELAY.badge))))).toHaveLength(1);
    }
  });

  it('nobody takes the second leg in time: the relay fails, without a bonus', async () => {
    const a = await newPlayer('Sofia');
    const { r, leg1, leg2 } = await relay();
    await drive(a.userId, leg1.id);
    await db().update(contracts).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(contracts.id, leg2.id));
    await expireRelays(db());
    expect((await db().select().from(relays).where(eq(relays.id, r.id)))[0]!.status).toBe('failed');
  });
});

describe('v1.10 trip log', () => {
  it('the numbers of a trip; it is public only once shared', async () => {
    const p = await newPlayer('Sofia');
    const id = await drive(p.userId, (await makeContract('Sofia', 'Plovdiv')).id);
    const mine = await tripLog(db(), id, { userId: p.userId });
    expect(mine!.from).toBeTruthy();
    expect(mine!.stats.driveMin).toBeGreaterThan(0);
    expect(mine!.stats.avgKmh).toBeGreaterThan(20);
    expect(mine!.ledger.length).toBeGreaterThan(0);
    expect(await tripLog(db(), id, { publicOnly: true })).toBeNull();
    const other = await newPlayer('Sofia');
    expect(await tripLog(db(), id, { userId: other.userId })).toBeNull();
    await shareTrip(db(), p.userId, id);
    const pub = await tripLog(db(), id, { publicOnly: true });
    expect(pub!.ledger).toHaveLength(0);
    expect((await tripsOf(db(), p.userId))[0]!.id).toBe(id);
    expect(tripStats([], 0).totalMin).toBe(0);
  });
});
