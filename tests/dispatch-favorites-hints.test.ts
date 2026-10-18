import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, users, vehicles } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { autoDispatchTick, planDispatch, runDispatch, setAutoDispatch } from '@/server/game/dispatch';
import { db, makeContract, newPlayer } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

describe('dispatcher', () => {
  it('proposes one profitable on-time job per free truck and sends it', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    await makeContract('Sofia', 'Plovdiv', { weightTons: 2, rewardCents: 2_000_00 });
    const plan = await planDispatch(db(), p.userId);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.vehicleId).toBe(truck!.id);
    expect(plan[0]!.profitCents).toBeGreaterThan(0);
    const res = await runDispatch(db(), p.userId, plan);
    expect(res.sent).toBe(1);
    expect(await planDispatch(db(), p.userId)).toHaveLength(0); // the truck is on the road
  });

  it('VIP auto-dispatch sends a free truck by itself; without VIP it is switched off', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    expect(await code(setAutoDispatch(db(), p.userId, truck!.id, true))).toBe('vip_only');
    await db().update(users).set({ vipUntil: new Date(Date.now() + 86_400_000) }).where(eq(users.id, p.userId));
    await setAutoDispatch(db(), p.userId, truck!.id, true);
    await makeContract('Sofia', 'Plovdiv', { weightTons: 2, rewardCents: 2_000_00 });
    await autoDispatchTick(db());
    const auto = await db().select().from(deliveries).where(and(eq(deliveries.companyId, account!.id), eq(deliveries.autoDispatched, true)));
    expect(auto).toHaveLength(1);
  });
});
