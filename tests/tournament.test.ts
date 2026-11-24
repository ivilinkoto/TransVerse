import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { weekEndsAt, weekKey } from '@/lib/game/leagues';
import { TOURNAMENT, tournamentPool, tournamentPrizes } from '@/lib/game/tournament';
import { closeDb } from '@/server/db/client';
import { companies, contracts, deliveries, jobState, users, vehicles } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { GameError } from '@/server/game/errors';
import { joinTournament, settleTournament, standings } from '@/server/game/tournament';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;
const give = (userId: string, n: number) => db().transaction((tx) => postCoins(tx, userId, { amount: n, reason: 'purchase', description: 'test', idempotencyKey: `tourney-test:${userId}:${n}` }));
// A finished delivery of `tons` at `at` for the player (as if the truck arrived).
async function delivered(userId: string, tons: number, at: Date) {
  const [acc] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
  const c = await makeContract('Sofia', 'Plovdiv', { weightTons: tons });
  await db().insert(deliveries).values({ contractId: c.id, companyId: acc!.id, vehicleId: truck!.id, routeId: c.routeId, emptyKm: 0, loadedKm: 150, schedule: [], estimatedCosts: {}, status: 'completed', startedAt: new Date(at.getTime() - 3_600_000), etaAt: at, deadlineAt: at, completedAt: at } as never);
}

describe('1.3.2.4 „Турнир на седмицата“', () => {
  it('a 1.3.2.4 feature; the pool is 80 % of the fees; 50/30/20 from three players', () => {
    expect(FEATURES.tournaments).toBe('1.3.2.4');
    expect(tournamentPool(5)).toBe(400);
    expect(tournamentPrizes(5)).toEqual([200, 120, 80]);
    expect(tournamentPrizes(2)).toEqual([]);
    expect(tournamentPrizes(7).reduce((a, b) => a + b, 0)).toBe(tournamentPool(7));
  });

  it('entry for the fee once a week; tons count from the entry; the week pays the first three', async () => {
    // A week long ago (the worker in other tests settles the real last week): settled as if it were „now“ the week after.
    const now = new Date(Date.now() - (20 + Math.floor(Math.random() * 500)) * 7 * 86_400_000);
    const lastWeek = weekKey(new Date(now.getTime() - 7 * 86_400_000));
    const start = new Date(weekEndsAt(lastWeek).getTime() - 6 * 86_400_000);
    const players: Awaited<ReturnType<typeof newPlayer>>[] = [];
    for (let i = 0; i < 4; i++) players.push(await newPlayer());
    for (const p of players) await give(p.userId, 500);
    for (const p of players) await joinTournament(db(), p.userId, start);
    expect(await code(joinTournament(db(), players[0]!.userId, start))).toBe('already_in');
    expect(await coins(players[0]!.userId)).toBe(500 - TOURNAMENT.feeCoins);
    // Before the entry it does not count; after, it does.
    await delivered(players[0]!.userId, 50, new Date(start.getTime() - 60_000));
    await delivered(players[0]!.userId, 10, new Date(start.getTime() + 60_000));
    await delivered(players[1]!.userId, 30, new Date(start.getTime() + 60_000));
    await delivered(players[2]!.userId, 20, new Date(start.getTime() + 60_000));
    const table = await standings(db(), lastWeek, weekEndsAt(lastWeek));
    const ours = table.filter((r) => players.some((p) => p.userId === r.userId));
    expect(ours.map((r) => r.tons)).toEqual([30, 20, 10, 0]);
    const before = await Promise.all(players.map((p) => coins(p.userId)));
    await settleTournament(db(), now);
    const prizes = tournamentPrizes(table.length);
    const place = (id: string) => table.findIndex((r) => r.userId === id);
    for (const [i, p] of players.entries()) expect(await coins(p.userId)).toBe(before[i]! + (prizes[place(p.userId)] ?? 0));
    // Once only.
    expect(await settleTournament(db(), now)).toBe(0);
    const [flag] = await db().select().from(jobState).where(eq(jobState.key, `tourney-settled:${lastWeek}`));
    expect(flag).toBeTruthy();
    expect(contracts).toBeTruthy();
  });
});
