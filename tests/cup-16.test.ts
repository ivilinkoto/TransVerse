import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { bracketSeeds, matchWinner, SPRING_CUP } from '@/lib/game/tournament';
import { closeDb } from '@/server/db/client';
import { companies, ledgerEntries, recruitmentPosts, tournamentEntries, tournamentMatches, userBadges, users, vehicles } from '@/server/db/schema';
import { runCommand } from '@/server/discord/commands';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { footprint } from '@/server/game/footprint';
import { postRecruitment, recruitmentBoard, removeRecruitment } from '@/server/game/recruitment';
import { setSpecialization } from '@/server/game/specialization';
import { joinCup, runCup } from '@/server/game/tournament';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;

describe('the cup rules', () => {
  it('seeds 1 and 2 can meet only in the final; a tie goes to the higher seed', () => {
    const pairs = bracketSeeds(16);
    expect(pairs[0]).toEqual([1, 16]);
    // 1 and 2 in different halves, 1–4 in different quarters.
    const half = (seed: number) => Math.floor(pairs.findIndex((p) => p.includes(seed)) / 4);
    const quarter = (seed: number) => Math.floor(pairs.findIndex((p) => p.includes(seed)) / 2);
    expect(half(1)).not.toBe(half(2));
    expect(new Set([1, 2, 3, 4].map(quarter)).size).toBe(4);
    expect(pairs.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(matchWinner({ id: 'a', seed: 4, km: 100 }, { id: 'b', seed: 1, km: 100 })).toBe('b');
    expect(matchWinner({ id: 'a', seed: 4, km: 101 }, { id: 'b', seed: 1, km: 100 })).toBe('a');
    expect(matchWinner({ id: 'a', seed: 4, km: 0 }, null)).toBe('a');
    expect(matchWinner(null, null)).toBeNull();
  });
});

describe('v1.6 company and community', () => {
  it('a specialisation pays on its cargo, changes once a month; "Картата ми" shows the trip', async () => {
    const p = await playerWithCompany();
    expect(await setSpecialization(db(), p.userId, 'general')).toEqual({ specialization: 'general' });
    expect(await code(setSpecialization(db(), p.userId, 'reefer'))).toBe('too_soon');
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    const c = await makeContract('Sofia', 'Plovdiv', { cargoType: 'pallets' });
    const d = await acceptContract(db(), p.userId, c.id, truck!.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc!.id);
    const spec = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc!.id), like(ledgerEntries.description, 'Специализация%')));
    expect(spec).toHaveLength(1);
    expect(spec[0]!.amountCents).toBe(Math.round(c.rewardCents * 0.05));
    const map = await footprint(db(), p.userId);
    expect(map.trips).toBe(1);
    expect(map.lanes[0]!.name).toContain('→');
    expect(map.cities.length).toBeGreaterThan(0);
  });

  it('the recruitment board: a company post replaces the old one, a driver post, removal', async () => {
    const boss = await playerWithCompany();
    const driver = await newPlayer();
    expect(await code(postRecruitment(db(), boss.userId, { kind: 'company', text: 'кратко' }))).toBe('short');
    await postRecruitment(db(), boss.userId, { kind: 'company', text: 'Търсим шофьори за Балканите, вноска 5 %.' });
    const second = await postRecruitment(db(), boss.userId, { kind: 'company', text: 'Търсим шофьори за Германия, вноска 5 %.', minLevel: 3 });
    expect(await code(postRecruitment(db(), boss.userId, { kind: 'driver', text: 'Търся компания, карам вечер.' }))).toBe('member');
    const mine = await postRecruitment(db(), driver.userId, { kind: 'driver', text: 'Търся компания, карам вечер.' });
    const board = await recruitmentBoard(db(), new Date());
    expect(board.companies.filter((p) => p.userId === boss.userId).map((p) => p.id)).toEqual([second.id]);
    expect(board.drivers.some((p) => p.id === mine.id)).toBe(true);
    expect(await code(removeRecruitment(db(), driver.userId, second.id))).toBe('forbidden');
    await removeRecruitment(db(), driver.userId, mine.id);
    expect(await db().select().from(recruitmentPosts).where(eq(recruitmentPosts.id, mine.id))).toHaveLength(0);
  });

  it('/маршрут: the truck route between two cities', async () => {
    const reply = await runCommand(db(), { name: 'маршрут', options: { от: 'Sofia', до: 'Plovdiv' }, discordUserId: 'nobody' });
    expect(reply.embeds![0]!.title).toContain('→');
    expect((await runCommand(db(), { name: 'маршрут', options: { от: 'Sofia', до: 'Атлантида' }, discordUserId: 'nobody' })).ephemeral).toBe(true);
  });
});
