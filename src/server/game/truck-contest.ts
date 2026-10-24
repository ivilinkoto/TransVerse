import { and, desc, eq, sql } from 'drizzle-orm';
import { recordMonth } from '@/lib/game/community';
import { featureLive } from '@/lib/game/features';
import { BADGES } from '@/lib/game/halloween';
import { TRUCK_CONTEST, type TruckLook } from '@/lib/game/truck-contest';
import type { Database, DbOrTx } from '@/server/db/client';
import { jobState, truckContestEntries, truckContestVotes, userBadges, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { appUrl } from '@/server/discord/config';
import { announce } from '@/server/discord/outbox';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { notify } from './notify';
import { fleetView } from './queries';

const previousMonth = (at: Date) => {
  const [y, m] = recordMonth(at).split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** The player enters one of their own trucks for this month (once a month). */
export async function enterTruck(db: Database, userId: string, vehicleId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'truck_contest', now))) fail('not_released', '„Камион на месеца“ идва с обновление 1.8.');
  const account = await companyForUser(db, userId);
  const v = (await fleetView(db, account.id)).vehicles.find((x) => x.id === vehicleId);
  if (!v) fail('not_found', 'Няма такъв камион.', 404);
  if (v!.ownership === 'rented') fail('rented', 'Само собствен камион може да участва.');
  const look: TruckLook = { modelId: v!.modelId, trailerModelId: v!.trailer?.modelId ?? null, color: v!.color, livery: v!.livery ?? null, cosmetics: v!.cosmetics ?? null, trailerUpgrades: v!.trailer?.upgrades ?? [], trailerLogo: v!.trailer?.logo ?? null, trailerCosmetics: v!.trailer?.cosmetics ?? null };
  const [row] = await db
    .insert(truckContestEntries)
    .values({ month: recordMonth(now), userId, vehicleId, look: look as unknown as Record<string, unknown>, title: `${v!.plate} · ${v!.model.name}${v!.trailer ? ` + ${v!.trailer.model.name}` : ''}`, createdAt: now })
    .onConflictDoNothing()
    .returning();
  if (!row) fail('already_entered', 'Този месец вече имаш камион в конкурса.');
  return { id: row!.id };
}

/** A vote for someone else's truck (three a month). */
export async function voteTruck(db: Database, userId: string, entryId: number, now = new Date()) {
  if (!(await featureFor(db, userId, 'truck_contest', now))) fail('not_released', '„Камион на месеца“ идва с обновление 1.8.');
  const month = recordMonth(now);
  const [e] = await db.select().from(truckContestEntries).where(eq(truckContestEntries.id, entryId));
  if (!e || e.month !== month) fail('not_found', 'Няма такъв камион в конкурса този месец.', 404);
  if (e!.userId === userId) fail('own_entry', 'Не можеш да гласуваш за своя камион.');
  return db.transaction(async (tx) => {
    const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(truckContestVotes).where(and(eq(truckContestVotes.month, month), eq(truckContestVotes.voterId, userId)));
    if (n >= TRUCK_CONTEST.votes) fail('no_votes', `Имаш ${TRUCK_CONTEST.votes} гласа на месец — вече ги даде.`);
    const [v] = await tx.insert(truckContestVotes).values({ month, voterId: userId, entryId, createdAt: now }).onConflictDoNothing().returning();
    if (!v) fail('already_voted', 'Вече гласува за този камион.');
    await tx.update(truckContestEntries).set({ votes: sql`${truckContestEntries.votes} + 1` }).where(eq(truckContestEntries.id, entryId));
    return { votesLeft: TRUCK_CONTEST.votes - n - 1 };
  });
}

/** This month's entries (most votes first), the player's votes left, and last month's winners. */
export async function truckContestView(db: DbOrTx, userId: string, now = new Date()) {
  const month = recordMonth(now);
  const entries = await db
    .select({ id: truckContestEntries.id, userId: truckContestEntries.userId, username: users.username, title: truckContestEntries.title, look: truckContestEntries.look, votes: truckContestEntries.votes })
    .from(truckContestEntries)
    .innerJoin(users, eq(users.id, truckContestEntries.userId))
    .where(eq(truckContestEntries.month, month))
    .orderBy(desc(truckContestEntries.votes), truckContestEntries.id);
  const mine = await db.select({ entryId: truckContestVotes.entryId }).from(truckContestVotes).where(and(eq(truckContestVotes.month, month), eq(truckContestVotes.voterId, userId)));
  return {
    month,
    entries: entries.map((e) => ({ ...e, look: e.look as unknown as TruckLook, mine: e.userId === userId, voted: mine.some((m) => m.entryId === e.id) })),
    votesLeft: TRUCK_CONTEST.votes - mine.length,
    entered: entries.some((e) => e.userId === userId),
    last: await lastWinners(db, now),
  };
}

/** Last month's winners (once settled). */
export async function lastWinners(db: DbOrTx, now = new Date()) {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, `truck-contest:${previousMonth(now)}`));
  return (row?.value as { month: string; winners: { username: string; title: string; votes: number; look: TruckLook }[] } | undefined) ?? null;
}

/** After the month: the top three with enough votes win; once. */
export async function settleTruckContest(db: Database, now = new Date()) {
  if (!featureLive('truck_contest', now)) return null;
  const month = previousMonth(now);
  const key = `truck-contest:${month}`;
  const [done] = await db.select({ key: jobState.key }).from(jobState).where(eq(jobState.key, key));
  if (done) return null;
  const top = await db
    .select({ id: truckContestEntries.id, userId: truckContestEntries.userId, username: users.username, title: truckContestEntries.title, look: truckContestEntries.look, votes: truckContestEntries.votes })
    .from(truckContestEntries)
    .innerJoin(users, eq(users.id, truckContestEntries.userId))
    .where(and(eq(truckContestEntries.month, month), sql`${truckContestEntries.votes} >= ${TRUCK_CONTEST.minVotes}`))
    .orderBy(desc(truckContestEntries.votes), truckContestEntries.id)
    .limit(TRUCK_CONTEST.prizes.length);
  return db.transaction(async (tx) => {
    const [first] = await tx.insert(jobState).values({ key, value: { month, winners: top.map((t) => ({ username: t.username, title: t.title, votes: t.votes, look: t.look })) } }).onConflictDoNothing().returning();
    if (!first) return null;
    for (const [i, t] of top.entries()) {
      const coins = TRUCK_CONTEST.prizes[i]!;
      await postCoins(tx, t.userId, { amount: coins, reason: 'truck_contest', description: `Камион на месеца ${month}: ${i + 1}. място`, idempotencyKey: `truck-contest:${month}:${t.userId}` });
      if (i === 0) await tx.insert(userBadges).values({ userId: t.userId, badge: TRUCK_CONTEST.badge, awardedAt: now }).onConflictDoNothing();
      await notify(tx, t.userId, 'achievement', `Камион на месеца: ${i + 1}. място! 🏆`, `${t.title} — ${t.votes} гласа. Награда: ${coins} TC${i === 0 ? ` и значка „${BADGES[TRUCK_CONTEST.badge]?.label ?? ''}“` : ''}.`, '/game/truck-contest');
    }
    if (top.length && featureLive('discord_bot', now)) {
      await announce(tx, key, 'rankings', {
        embeds: [{ title: `🚛 Камион на месеца · ${month}`, url: `${appUrl()}/game/truck-contest`, color: 0xf6c343, description: top.map((t, i) => `**${i + 1}.** ${t.username} · ${t.title} · ${t.votes} гласа`).join('\n'), footer: { text: 'TransVerse · игрови данни' } }],
      }, now);
    }
    return { month, winners: top.length };
  });
}
