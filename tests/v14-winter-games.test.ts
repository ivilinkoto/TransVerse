import { eq, like, or } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the feature as released (before 13.12 it is staff-only).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { medalTable, topSum, WINTER_GAMES } from '@/lib/game/winter-games';
import { closeDb } from '@/server/db/client';
import { companyBuildings, jobState, organizations, userBadges } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { joinCompany, updateSettings } from '@/server/game/membership';
import { awardWinterGames, medals, voteXmasBase, winterGamesStandings, xmasBaseVotes } from '@/server/game/winter-games';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;
const DAY = new Date('2026-12-16T15:00:00+02:00');

describe('1.4 „Зимни игри на компаниите“', () => {
  it('a company counts its best 5 members; the medal table goes gold, silver, bronze', () => {
    expect(topSum([1, 9, 3, 7, 5, 8, 2])).toBe(9 + 8 + 7 + 5 + 3);
    const table = medalTable([
      { name: 'Б', gold: 1, silver: 3, bronze: 0 },
      { name: 'А', gold: 2, silver: 0, bronze: 0 },
      { name: 'В', gold: 1, silver: 3, bronze: 1 },
    ]);
    expect(table.map((r) => r.name)).toEqual(['А', 'В', 'Б']);
  });

  it('standings come from what the members already play; the prizes are given once', async () => {
    const a = await playerWithCompany();
    const b = await playerWithCompany();
    const orgA = await orgOf(a.userId);
    const orgB = await orgOf(b.userId);
    await updateSettings(db(), a.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const m = await newPlayer();
    await joinCompany(db(), m.userId, orgA.id);
    const run = (metres: number) => ({ runs: [{ metres, stars: 1, crashes: 0, cans: 0, at: DAY.toISOString() }, { metres: metres / 2, stars: 0, crashes: 1, cans: 0, at: DAY.toISOString() }], awarded: 1 });
    await db().insert(jobState).values([
      { key: `night-run:D2026-12-15:${a.userId}`, value: run(3000) },
      { key: `night-run:D2026-12-15:${m.userId}`, value: run(2000) },
      { key: `night-run:D2026-12-16:${a.userId}`, value: run(1000) },
      { key: `night-run:D2026-12-15:${b.userId}`, value: run(4500) },
      // Before the Games: does not count.
      { key: `night-run:D2026-12-10:${b.userId}`, value: run(99000) },
      { key: `courier:D2026-12-15:${b.userId}`, value: { runs: [{ city: 'sofia', delivered: 8, timeS: 1500, points: 900, stars: 3, at: DAY.toISOString() }], awarded: 3 } },
    ]);
    try {
      const st = await winterGamesStandings(db(), DAY);
      expect(st.night_run.find((r) => r.orgId === orgA.id)?.value).toBe(6000);
      expect(st.night_run.find((r) => r.orgId === orgB.id)?.value).toBe(4500);
      expect(st.courier.find((r) => r.orgId === orgB.id)?.value).toBe(900);
      const table = medals(st);
      expect(table.some((r) => r.orgId === orgA.id)).toBe(true);

      // Not before the end; then once.
      expect(await awardWinterGames(db(), DAY)).toBe(false);
      const end = new Date(WINTER_GAMES.to);
      expect(await awardWinterGames(db(), end)).toBe(true);
      expect(await awardWinterGames(db(), end)).toBe(false);
      const champ = medals(await winterGamesStandings(db(), end))[0]!;
      const [o] = await db().select({ treasury: organizations.treasuryCents }).from(organizations).where(eq(organizations.id, champ.orgId));
      expect(o!.treasury).toBeGreaterThanOrEqual(WINTER_GAMES.championCents);
    } finally {
      await db().delete(jobState).where(or(like(jobState.key, 'night-run:D2026-12-%'), like(jobState.key, 'courier:D2026-12-%'), eq(jobState.key, 'winter-games-awarded:2026')));
      await db().delete(userBadges).where(eq(userBadges.badge, WINTER_GAMES.championTitle));
    }
  });

  it('„Най-красивата коледна база“: one vote a day, not for the own base, only for a built base', async () => {
    const owner = await playerWithCompany();
    const other = await playerWithCompany();
    const org = await orgOf(owner.userId);
    const otherOrg = await orgOf(other.userId);
    const voter = await newPlayer();
    try {
      expect(await code(voteXmasBase(db(), voter.userId, org.id, new Date('2026-12-01T12:00:00+02:00')))).toBe('contest_closed');
      expect(await code(voteXmasBase(db(), voter.userId, org.id, DAY))).toBe('no_base');
      for (const o of [org, otherOrg]) await db().insert(companyBuildings).values({ organizationId: o.id, type: 'parking', x: 8, y: 7, level: 1 }).onConflictDoNothing();
      expect(await code(voteXmasBase(db(), owner.userId, org.id, DAY))).toBe('own_base');
      expect(await code(voteXmasBase(db(), voter.userId, org.id, DAY))).toBe('ok');
      expect(await code(voteXmasBase(db(), voter.userId, otherOrg.id, DAY))).toBe('voted_today');
      const v = await xmasBaseVotes(db(), DAY, voter.userId);
      expect(v.today).toBe(org.id);
      expect(v.ranking.find((r) => r.orgId === org.id)?.votes).toBe(1);
      // A new day, a new vote.
      expect(await code(voteXmasBase(db(), voter.userId, org.id, new Date(DAY.getTime() + 86_400_000)))).toBe('ok');
    } finally {
      await db().delete(jobState).where(like(jobState.key, 'xmas-base-vote:%'));
    }
  });
});
