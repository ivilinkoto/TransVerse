import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { deliveryXp, FLEET_XP_SHARE, legacyXpForLevel, levelForXp, xpForLevel } from '@/lib/game/progression';
import { closeDb, getPool } from '@/server/db/client';
import { companies, deliveries, driverCandidates, drivers, users, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { buyVehicle } from '@/server/game/fleet';
import { assignDriver, hireDriver } from '@/server/game/staff';
import { db, makeContract, playerWithCompany } from './helpers';

afterAll(async () => closeDb());

describe('level curve (v1.1)', () => {
  it('levels take much longer: about 125 000 XP for level 10', () => {
    expect(xpForLevel(2)).toBe(1000);
    expect(xpForLevel(10)).toBeGreaterThan(120_000);
    expect(xpForLevel(15)).toBeGreaterThan(4 * legacyXpForLevel(15));
    expect(levelForXp(xpForLevel(12))).toBe(12);
    expect(deliveryXp(500, 20, true, 1)).toBeCloseTo(303, -1);
    expect(deliveryXp(500, 20, false, 1)).toBeLessThan(160);
  });

  it('the one-time conversion keeps the level and the progress to the next one', async () => {
    const level = 15;
    const half = legacyXpForLevel(level) + (legacyXpForLevel(level + 1) - legacyXpForLevel(level)) / 2;
    const conversion = readFileSync('drizzle/0028_rebalance_xp.sql', 'utf8').replace(/^--.*$/gm, '').replace(/WHERE "xp" > 0;/, 'WHERE "xp" > 0 AND "id" = $1;');
    const p = await playerWithCompany();
    await db().update(users).set({ level, xp: Math.round(half) }).where(eq(users.id, p.userId));
    await getPool().query(conversion, [p.userId]);
    const [u] = await db().select({ xp: users.xp, level: users.level }).from(users).where(eq(users.id, p.userId));
    expect(levelForXp(u!.xp)).toBe(level);
    expect((u!.xp - xpForLevel(level)) / (xpForLevel(level + 1) - xpForLevel(level))).toBeCloseTo(0.5, 2);
  });

  it("a hired driver's trip gives the player only a share of the XP", async () => {
    const p = await playerWithCompany();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    await db().update(companies).set({ balanceCents: 500_000_00 }).where(eq(companies.id, account!.id));
    const truck = await buyVehicle(db(), p.userId, 'hemus-r12-box', p.hq.id);
    const [cand] = await db().insert(driverCandidates).values({ companyId: account!.id, name: 'Наемник', skill: 1, salaryCentsPerDay: 100_00, expiresAt: new Date(Date.now() + 3_600_000) }).returning();
    const hired = await hireDriver(db(), p.userId, cand!.id);
    await assignDriver(db(), p.userId, hired.id, truck.id);
    const before = (await db().select({ xp: users.xp }).from(users).where(eq(users.id, p.userId)))[0]!.xp;
    const job = await makeContract('Sofia', 'Plovdiv', { weightTons: 5 });
    const d = await acceptContract(db(), p.userId, job.id, truck.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account!.id);
    const [done] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    const after = (await db().select({ xp: users.xp }).from(users).where(eq(users.id, p.userId)))[0]!.xp;
    const [driver] = await db().select({ xp: drivers.xp }).from(drivers).where(eq(drivers.id, hired.id));
    expect(after - before).toBe(done!.xpAwarded);
    expect(done!.xpAwarded).toBe(Math.round(driver!.xp * FLEET_XP_SHARE));
    void vehicles;
  });
});
