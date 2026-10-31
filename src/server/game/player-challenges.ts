import { and, asc, count, desc, eq, gt, isNotNull, lte, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { challengeEntries, cities, companies, playerChallenges, userBadges, users } from '@/server/db/schema';
import { t } from '@/i18n/t';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { offerInterview } from './interviews';
import { notify } from './notify';

/**
 * 1.1.4.2 „Предизвикателства от играчите“: a player puts up a prize for the
 * fastest loaded run on a lane. Others join and drive it; when it ends the
 * fastest gets the prize (back to the creator when nobody drove), and a
 * popular challenge (5+ players) brings its creator ТрансКоин.
 */
export const PLAYER_CHALLENGE = { minPrizeCents: 200_00, maxPrizeCents: 20_000_00, maxDays: 7, maxOpen: 2, popular: 5, creatorCoins: 10 };

export async function createChallenge(db: Database, userId: string, input: { title: string; originCityId: number; destCityId: number; days: number; prizeCents: number; soloOnly: boolean }, now = new Date()) {
  const title = input.title.trim().slice(0, 60);
  if (title.length < 3) fail('bad_title', t('Дай име на предизвикателството.'));
  if (input.originCityId === input.destCityId) fail('same_city', t('Изберете два различни града.'));
  if (input.prizeCents < PLAYER_CHALLENGE.minPrizeCents || input.prizeCents > PLAYER_CHALLENGE.maxPrizeCents) fail('bad_prize', t('Наградата е между {0} и {1} лв.', PLAYER_CHALLENGE.minPrizeCents / 100, PLAYER_CHALLENGE.maxPrizeCents / 100));
  const days = Math.min(PLAYER_CHALLENGE.maxDays, Math.max(1, Math.round(input.days)));
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(playerChallenges).where(and(eq(playerChallenges.creatorId, userId), eq(playerChallenges.status, 'open')));
    if (n >= PLAYER_CHALLENGE.maxOpen) fail('challenges_full', t('Най-много {0} отворени предизвикателства.', PLAYER_CHALLENGE.maxOpen));
    const [row] = await tx
      .insert(playerChallenges)
      .values({ creatorId: userId, title, originCityId: input.originCityId, destCityId: input.destCityId, soloOnly: input.soloOnly, prizeCents: Math.round(input.prizeCents), endsAt: new Date(now.getTime() + days * 86_400_000), createdAt: now })
      .returning();
    await post(tx, company.id, [{ category: 'player_challenge', amountCents: -row!.prizeCents, description: t('Награда за „{0}“', title), idempotencyKey: `pchallenge:${row!.id}` }], { requireFunds: true });
    return row!;
  });
}

export async function joinChallenge(db: DbOrTx, userId: string, id: string, now = new Date()) {
  const [c] = await db.select().from(playerChallenges).where(eq(playerChallenges.id, id));
  if (!c || c.status !== 'open' || c.endsAt <= now) fail('challenge_closed', t('Предизвикателството е приключило.'), 409);
  if (c!.creatorId === userId) fail('own_challenge', t('Това е твоето предизвикателство.'));
  await db.insert(challengeEntries).values({ challengeId: id, userId }).onConflictDoNothing();
}

export async function openChallenges(db: DbOrTx, userId: string, now = new Date()) {
  const origin = alias(cities, 'origin');
  const dest = alias(cities, 'dest');
  const rows = await db
    .select({ id: playerChallenges.id, title: playerChallenges.title, creator: users.username, creatorId: playerChallenges.creatorId, from: origin.nameBg, to: dest.nameBg, originCityId: playerChallenges.originCityId, destCityId: playerChallenges.destCityId, soloOnly: playerChallenges.soloOnly, prizeCents: playerChallenges.prizeCents, endsAt: playerChallenges.endsAt, players: sql<number>`(select count(*)::int from ${challengeEntries} where ${challengeEntries.challengeId} = ${playerChallenges.id})`, joined: sql<boolean>`exists(select 1 from ${challengeEntries} where ${challengeEntries.challengeId} = ${playerChallenges.id} and ${challengeEntries.userId} = ${userId})` })
    .from(playerChallenges)
    .innerJoin(users, eq(users.id, playerChallenges.creatorId))
    .innerJoin(origin, eq(origin.id, playerChallenges.originCityId))
    .innerJoin(dest, eq(dest.id, playerChallenges.destCityId))
    .where(and(eq(playerChallenges.status, 'open'), gt(playerChallenges.endsAt, now)))
    .orderBy(desc(playerChallenges.prizeCents))
    .limit(30);
  return rows;
}

export async function challengeBoard(db: DbOrTx, id: string) {
  return db
    .select({ username: users.username, minutes: challengeEntries.minutes })
    .from(challengeEntries)
    .innerJoin(users, eq(users.id, challengeEntries.userId))
    .where(and(eq(challengeEntries.challengeId, id), isNotNull(challengeEntries.minutes)))
    .orderBy(asc(challengeEntries.minutes))
    .limit(10);
}

/** After a delivery: a run on the lane of a challenge the player joined (the best time counts). */
export async function recordChallengeRun(tx: Tx, userId: string, lane: { originCityId: number; destCityId: number }, run: { minutes: number; solo: boolean; deliveryId: string }, now: Date) {
  const open = await tx
    .select({ id: playerChallenges.id, soloOnly: playerChallenges.soloOnly })
    .from(playerChallenges)
    .innerJoin(challengeEntries, and(eq(challengeEntries.challengeId, playerChallenges.id), eq(challengeEntries.userId, userId)))
    .where(and(eq(playerChallenges.status, 'open'), gt(playerChallenges.endsAt, now), eq(playerChallenges.originCityId, lane.originCityId), eq(playerChallenges.destCityId, lane.destCityId)));
  for (const c of open) {
    if (c.soloOnly && !run.solo) continue;
    await tx
      .update(challengeEntries)
      .set({ minutes: run.minutes, deliveryId: run.deliveryId })
      .where(and(eq(challengeEntries.challengeId, c.id), eq(challengeEntries.userId, userId), sql`(${challengeEntries.minutes} is null or ${challengeEntries.minutes} > ${run.minutes})`));
  }
  return open.length;
}

/** Worker: challenges past their end pay the fastest (or go back to the creator). */
export async function settlePlayerChallenges(db: Database, now = new Date()) {
  const due = await db.select().from(playerChallenges).where(and(eq(playerChallenges.status, 'open'), lte(playerChallenges.endsAt, now))).limit(50);
  for (const c of due) {
    await db.transaction(async (tx) => {
      const [best] = await tx.select({ userId: challengeEntries.userId }).from(challengeEntries).where(and(eq(challengeEntries.challengeId, c.id), isNotNull(challengeEntries.minutes))).orderBy(asc(challengeEntries.minutes)).limit(1);
      const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(challengeEntries).where(and(eq(challengeEntries.challengeId, c.id), ne(challengeEntries.userId, c.creatorId)));
      const winnerId = best?.userId ?? c.creatorId;
      const [wc] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, winnerId));
      if (wc) await post(tx, wc.id, [{ category: 'player_challenge', amountCents: c.prizeCents, description: best ? t('Победа: „{0}“', c.title) : t('Върната награда: „{0}“', c.title), idempotencyKey: `pchallenge-end:${c.id}` }]);
      if (best) {
        await tx.insert(userBadges).values({ userId: best.userId, badge: 'challenge-winner', awardedAt: now }).onConflictDoNothing();
        await notify(tx, best.userId, 'achievement', () => t('🏆 Спечели „{0}“', c.title), () => t('+{0} лв. — най-бързият курс.', Math.round(c.prizeCents / 100)), '/game/player-challenges');
        await offerInterview(tx, best.userId, 'challenge', now);
      }
      if (n >= PLAYER_CHALLENGE.popular) await postCoins(tx, c.creatorId, { amount: PLAYER_CHALLENGE.creatorCoins, reason: 'challenge', description: t('Популярно предизвикателство: „{0}“', c.title), idempotencyKey: `pchallenge-popular:${c.id}` });
      await tx.update(playerChallenges).set({ status: 'settled', winnerId: best?.userId ?? null }).where(eq(playerChallenges.id, c.id));
    });
  }
  return due.length;
}
