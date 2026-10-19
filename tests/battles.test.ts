import { and, eq, or, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { battleOutcome, BATTLE_RULES, pairCompanies } from '@/lib/game/battles';
import { closeDb } from '@/server/db/client';
import { companies, companyBattles, organizations, treasuryEntries, vehicles } from '@/server/db/schema';
import { battleRecord, currentBattle, ensureWeeklyBattles, recordBattleDelivery, settleBattles } from '@/server/game/battles';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { db, makeContract, playerWithCompany } from './helpers';

afterAll(() => closeDb());

// A Monday far ahead, so no other test's deliveries are "active" that week.
const MONDAY = new Date('2031-03-03T08:00:00Z');

async function companyThatDelivered(at: Date) {
  const owner = await playerWithCompany('Sofia');
  const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
  const [acc] = await db().select().from(companies).where(eq(companies.ownerId, owner.userId));
  const [v] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, acc!.id), sql`${vehicles.soldAt} is null`));
  const d = await acceptContract(db(), owner.userId, (await makeContract('Sofia', 'Plovdiv', { expiresAt: new Date('2032-01-01T00:00:00Z') })).id, v!.id, at);
  await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc!.id);
  return org!;
}

describe('company battles', () => {
  it('pairs neighbours by level and decides the outcome by tonnes', () => {
    const list = [{ id: 'a', level: 3, xp: 10 }, { id: 'b', level: 9, xp: 5 }, { id: 'c', level: 4, xp: 0 }, { id: 'd', level: 8, xp: 0 }, { id: 'e', level: 1, xp: 0 }];
    expect(pairCompanies(list, 'w').map(([x, y]) => [x.id, y.id])).toEqual([['b', 'd'], ['c', 'a']]);
    expect(battleOutcome(10, 4)).toBe('win');
    expect(battleOutcome(0, 0)).toBe('none');
    expect(battleOutcome(5, 5)).toBe('draw');
  });

  it('active companies meet once a week; the one with more tonnes takes the reward', async () => {
    const a = await companyThatDelivered(new Date(MONDAY.getTime() - 3 * 86_400_000));
    const b = await companyThatDelivered(new Date(MONDAY.getTime() - 2 * 86_400_000));
    expect(await ensureWeeklyBattles(db(), MONDAY)).toBeGreaterThanOrEqual(1);
    expect(await ensureWeeklyBattles(db(), MONDAY)).toBe(0); // once per week
    const [battle] = await db().select().from(companyBattles).where(or(eq(companyBattles.aId, a.id), eq(companyBattles.bId, a.id)));
    expect([battle!.aId, battle!.bId].sort()).toEqual([a.id, b.id].sort());

    await db().transaction(async (tx) => {
      await recordBattleDelivery(tx, a.id, 24, MONDAY);
      await recordBattleDelivery(tx, b.id, 10, MONDAY);
    });
    const now = await currentBattle(db(), a.id, MONDAY);
    expect(now).toMatchObject({ ourTons: 24, theirTons: 10, rival: { id: b.id } });

    await settleBattles(db(), new Date(battle!.endsAt.getTime() + 1000));
    const [done] = await db().select().from(companyBattles).where(eq(companyBattles.id, battle!.id));
    expect(done).toMatchObject({ status: 'done', winnerId: a.id });
    const prize = await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, a.id), eq(treasuryEntries.category, 'company_battle')));
    expect(prize.map((p) => p.amountCents)).toEqual([BATTLE_RULES.rewardCents]);
    expect(await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, b.id), eq(treasuryEntries.category, 'company_battle')))).toHaveLength(0);
    expect((await battleRecord(db(), a.id)).wins).toBe(1);
    // Settled once.
    await settleBattles(db(), new Date(battle!.endsAt.getTime() + 5000));
    expect(await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, a.id), eq(treasuryEntries.category, 'company_battle')))).toHaveLength(1);
  });
});
