import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { RELIEF } from '@/lib/game/relief';
import { closeDb } from '@/server/db/client';
import { companies, contracts, globalEvents, jobState, userBadges, users, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { runRelief } from '@/server/game/relief';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const truckOf = async (userId: string) => {
  const [acc] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
  return { acc: acc!, truck: truck! };
};
const coins = async (userId: string) => (await db().select().from(users).where(eq(users.id, userId)))[0]!.coins;

describe('v1.8 community', () => {
  it('a humanitarian convoy: an event and relief loads; a relief load on time pays ТрансКоин and the badge', async () => {
    await db().delete(jobState).where(eq(jobState.key, 'humanitarian'));
    const r = await runRelief(db());
    expect(r?.country).toBeTruthy();
    const [e] = await db().select().from(globalEvents).where(eq(globalEvents.id, r!.eventId));
    expect(e!.countryCode).toBe(r!.country);
    const loads = await db().select().from(contracts).where(and(eq(contracts.humanitarian, true), eq(contracts.status, 'open')));
    expect(loads.length).toBeGreaterThan(0);
    // The second run in the same window starts nothing new.
    expect((await runRelief(db()))?.eventId).toBe(r!.eventId);

    const p = await newPlayer();
    const { acc, truck } = await truckOf(p.userId);
    const c0 = await coins(p.userId);
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv', { humanitarian: true })).id, truck.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc.id);
    expect(await coins(p.userId)).toBeGreaterThanOrEqual(c0 + RELIEF.coins);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, RELIEF.badge)))).toHaveLength(1);
  });

});
