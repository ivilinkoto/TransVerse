import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { MISSIONS, missionById, periodWindow, pickMissions, scaledTarget } from '@/lib/game/missions';
import { closeDb } from '@/server/db/client';
import { companies, ledgerEntries, missionProgress, users, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { claimMission, missionBoard, recordMissionProgress } from '@/server/game/missions';
import { db, makeContract, newPlayer } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

describe('mission rules', () => {
  it('uses Bulgarian calendar periods', () => {
    // 23:30 UTC on 16 Oct is already 17 Oct in Sofia (UTC+3 in summer time).
    const late = new Date('2026-10-16T23:30:00Z');
    expect(periodWindow('daily', late).key).toBe('D2026-10-17');
    expect(periodWindow('daily', late).endsAt.toISOString()).toBe('2026-10-17T21:00:00.000Z');
    expect(periodWindow('weekly', new Date('2026-10-16T10:00:00Z')).key).toBe('W2026-42');
    expect(periodWindow('weekly', new Date('2026-10-16T10:00:00Z')).endsAt.toISOString()).toBe('2026-10-18T21:00:00.000Z'); // Monday 00:00 Sofia
    // After the switch to winter time (25 Oct) midnight is 22:00 UTC.
    expect(periodWindow('monthly', new Date('2026-11-10T10:00:00Z')).endsAt.toISOString()).toBe('2026-11-30T22:00:00.000Z');
  });

  it('picks missions the player can do, the same set for the same period', () => {
    const rookie = { level: 1, licences: new Set<string>(), inCompany: false };
    const a = pickMissions('weekly', rookie, 'u1:W2026-42');
    expect(a).toHaveLength(3);
    expect(a.map((m) => m.id)).toEqual(pickMissions('weekly', rookie, 'u1:W2026-42').map((m) => m.id));
    expect(a.every((m) => !m.eligible || m.eligible(rookie))).toBe(true);
    expect(a.some((m) => m.id === 'w_international' || m.id === 'w_countries')).toBe(false);
    const veteran = { level: 12, licences: new Set(['international', 'reefer']), inCompany: true };
    expect(pickMissions('season', veteran, 'x').length).toBe(4);
    const km = missionById('d_km')!;
    expect(scaledTarget(km, 1)).toBe(600);
    expect(scaledTarget(km, 12)).toBe(1200);
    expect(MISSIONS.every((m) => m.rewardCents > 0 && m.rewardXp > 0)).toBe(true);
  });
});

describe('missions in the game', () => {
  it('assigns missions, counts deliveries and pays each reward once', async () => {
    const p = await newPlayer('Sofia');
    const now = new Date();
    const board = await missionBoard(db(), p.userId, now);
    const byPeriod = (period: string) => board.current.filter((r) => r.period === period).length;
    expect([byPeriod('daily'), byPeriod('weekly'), byPeriod('monthly')]).toEqual([3, 3, 3]);
    expect(byPeriod('season')).toBeGreaterThanOrEqual(3);

    // Make every current mission finishable with one delivery.
    await db().update(missionProgress).set({ target: 1 }).where(eq(missionProgress.userId, p.userId));
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const contract = await makeContract('Sofia', 'Plovdiv', { rewardCents: 800_00 });
    const d = await acceptContract(db(), p.userId, contract.id, truck!.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000));

    const rows = await db().select().from(missionProgress).where(eq(missionProgress.userId, p.userId));
    const deliveriesMission = rows.find((r) => missionById(r.missionId)?.metric === 'deliveries');
    expect(deliveriesMission?.completedAt).not.toBeNull();
    const pending = rows.find((r) => !r.completedAt);
    if (pending) expect(await code(claimMission(db(), p.userId, pending.periodKey, pending.missionId))).toBe('mission_incomplete');

    const before = (await db().select().from(companies).where(eq(companies.id, account!.id)))[0]!.balanceCents;
    const [u0] = await db().select({ xp: users.xp }).from(users).where(eq(users.id, p.userId));
    const reward = await claimMission(db(), p.userId, deliveriesMission!.periodKey, deliveriesMission!.missionId);
    expect((await db().select().from(companies).where(eq(companies.id, account!.id)))[0]!.balanceCents).toBe(before + reward.cents);
    const [u1] = await db().select({ xp: users.xp }).from(users).where(eq(users.id, p.userId));
    expect(u1!.xp).toBe(u0!.xp + reward.xp);
    expect(await code(claimMission(db(), p.userId, deliveriesMission!.periodKey, deliveriesMission!.missionId))).toBe('mission_claimed');
    const paid = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, account!.id), eq(ledgerEntries.category, 'mission_reward')));
    expect(paid).toHaveLength(1);
  });

  it('counts distinct countries across deliveries', async () => {
    const p = await newPlayer();
    const now = new Date();
    const board = await missionBoard(db(), p.userId, now);
    const daily = board.windows.find((w) => w.period === 'daily')!;
    await db().insert(missionProgress).values({ userId: p.userId, periodKey: daily.key, missionId: 'w_countries', period: 'daily', target: 3, rewardCents: 100_00, rewardXp: 10, endsAt: daily.endsAt });
    const facts = { loadedKm: 300, tons: 2, onTime: true, rewardCents: 500_00, cargoType: 'pallets', urgent: false, inCompany: false };
    await db().transaction((tx) => recordMissionProgress(tx, p.userId, { ...facts, countries: ['BG', 'RO'] }, now));
    await db().transaction((tx) => recordMissionProgress(tx, p.userId, { ...facts, countries: ['BG', 'RO'] }, now));
    let [row] = await db().select().from(missionProgress).where(and(eq(missionProgress.userId, p.userId), eq(missionProgress.missionId, 'w_countries')));
    expect(row!.progress).toBe(2);
    expect(row!.completedAt).toBeNull();
    await db().transaction((tx) => recordMissionProgress(tx, p.userId, { ...facts, countries: ['RO', 'HU'] }, now));
    [row] = await db().select().from(missionProgress).where(and(eq(missionProgress.userId, p.userId), eq(missionProgress.missionId, 'w_countries')));
    expect(row!.progress).toBe(3);
    expect(row!.data.countries).toEqual(['BG', 'HU', 'RO']);
    expect(row!.completedAt).not.toBeNull();
  });
});
