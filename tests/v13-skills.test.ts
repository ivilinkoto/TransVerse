import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the feature as released (before the date it is staff-only).
vi.mock('@/server/features', async (load) => ({ ...(await load<typeof import('@/server/features')>()), featureFor: async () => true }));
import { skillPoints, skillsBonusCents, SKILL_RULES } from '@/lib/game/skills';
import { closeDb } from '@/server/db/client';
import { companies, ledgerEntries, users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { learnSkill, recordSkillsTrip, resetSkills, skillsView } from '@/server/game/skills';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const trip = { rewardCents: 100_000, bonusCents: 10_000, fuelCents: 30_000, maintenanceCents: 10_000, tollCents: 5_000, loadedKm: 900, ownerDrove: true, convoy: false, sofiaHour: 12 };

describe('1.3 „Умения на шофьора“', () => {
  it('a point per level above the first; effects are small and only add', () => {
    expect(skillPoints(1)).toBe(0);
    expect(skillPoints(8)).toBe(7);
    expect(skillsBonusCents({}, trip)).toBe(0);
    // 3 ranks of fuel saving: 6 % of the fuel; 1 rank of haggling: 1 % of the reward.
    expect(skillsBonusCents({ fuel_saver: 3, haggler: 1 }, trip)).toBe(1_800 + 1_000);
    // Long haul only over 800 km, the boss only for hired drivers, the night owl only at night.
    expect(skillsBonusCents({ long_haul: 1 }, { ...trip, loadedKm: 500 })).toBe(0);
    expect(skillsBonusCents({ boss: 2 }, trip)).toBe(0);
    expect(skillsBonusCents({ boss: 2 }, { ...trip, ownerDrove: false })).toBe(4_000);
    expect(skillsBonusCents({ night_owl: 1 }, { ...trip, sofiaHour: 23 })).toBe(3_000);
  });

  it('learning spends points; ranks stop at the top; the first reset is free, then it costs', async () => {
    const p = await newPlayer();
    expect(await code(learnSkill(db(), p.userId, 'haggler', new Date()))).toBe('no_points');
    await db().update(users).set({ level: 5 }).where(eq(users.id, p.userId));
    for (let i = 1; i <= SKILL_RULES.maxRank; i++) expect(await learnSkill(db(), p.userId, 'haggler', new Date())).toBe(i);
    expect(await code(learnSkill(db(), p.userId, 'haggler', new Date()))).toBe('max_rank');
    await learnSkill(db(), p.userId, 'gentle', new Date());
    expect(await code(learnSkill(db(), p.userId, 'gentle', new Date()))).toBe('no_points');
    expect((await skillsView(db(), p.userId)).free).toBe(0);
    expect(await resetSkills(db(), p.userId, new Date())).toBe(0);
    expect((await skillsView(db(), p.userId)).free).toBe(4);
    await learnSkill(db(), p.userId, 'fuel_saver', new Date());
    const [acc] = await db().select({ id: companies.id, b: companies.balanceCents }).from(companies).where(eq(companies.ownerId, p.userId));
    await db().update(companies).set({ balanceCents: SKILL_RULES.resetCents + 1 }).where(eq(companies.id, acc!.id));
    expect(await resetSkills(db(), p.userId, new Date())).toBe(SKILL_RULES.resetCents);
    expect((await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.id, acc!.id)))[0]!.b).toBe(1);
  });

  it('a delivery pays the skills once, as one line', async () => {
    const p = await newPlayer();
    await db().update(users).set({ level: 3 }).where(eq(users.id, p.userId));
    await learnSkill(db(), p.userId, 'haggler', new Date());
    await learnSkill(db(), p.userId, 'fuel_saver', new Date());
    const [acc] = await db().select({ id: companies.id }).from(companies).where(eq(companies.ownerId, p.userId));
    const f = { ...trip, userId: p.userId, companyId: acc!.id, deliveryId: '00000000-0000-4000-8000-0000000000aa' };
    await db().transaction((tx) => recordSkillsTrip(tx, f, new Date('2026-11-12T12:00:00+02:00')));
    await db().transaction((tx) => recordSkillsTrip(tx, f, new Date('2026-11-12T12:00:00+02:00')));
    const lines = await db().select({ a: ledgerEntries.amountCents }).from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc!.id), like(ledgerEntries.idempotencyKey, '%:skills')));
    expect(lines.map((x) => x.a)).toEqual([1_000 + 600]);
  });
});
