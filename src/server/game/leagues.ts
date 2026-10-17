import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { LEAGUE_GROUP_SIZE, LEAGUE_TIERS, TOP_TIER, leaguePrize, outcomeFor, weekEndsAt, weekKey } from '@/lib/game/leagues';
import { isOnline } from '@/lib/game/social';
import { isVip } from '@/lib/game/vip';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, leagueGroups, leagueMembers, users } from '@/server/db/schema';
import { postCoins } from './coins';
import { post } from './finance';
import { notify } from './notify';

/** Adds a delivery's season points to the player's league week, placing them in a group on their first delivery. */
export async function addLeaguePoints(tx: Tx, userId: string, points: number, now = new Date()) {
  const week = weekKey(now);
  const updated = await tx
    .update(leagueMembers)
    .set({ points: sql`${leagueMembers.points} + ${points}`, deliveries: sql`${leagueMembers.deliveries} + 1` })
    .where(and(eq(leagueMembers.weekKey, week), eq(leagueMembers.userId, userId)))
    .returning({ groupId: leagueMembers.groupId });
  if (updated.length) return;
  const [u] = await tx.select({ tier: users.leagueTier }).from(users).where(eq(users.id, userId));
  const tier = Math.min(TOP_TIER, Math.max(0, u?.tier ?? 0));
  // One player at a time fills the groups of a tier, so none gets more than 20.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`league:${week}:${tier}`}))`);
  const [open] = await tx
    .select({ id: leagueGroups.id })
    .from(leagueGroups)
    .where(and(eq(leagueGroups.weekKey, week), eq(leagueGroups.tier, tier), sql`(select count(*) from ${leagueMembers} m where m.group_id = ${leagueGroups.id}) < ${LEAGUE_GROUP_SIZE}`))
    .orderBy(asc(leagueGroups.createdAt))
    .limit(1);
  const groupId = open?.id ?? (await tx.insert(leagueGroups).values({ weekKey: week, tier }).returning({ id: leagueGroups.id }))[0]!.id;
  await tx.insert(leagueMembers).values({ weekKey: week, userId, groupId, tier, points, deliveries: 1 }).onConflictDoNothing();
}

/** Worker: closes the groups of finished weeks — places, moves up or down, prizes. */
export async function settleLeagues(db: Database, now = new Date()): Promise<number> {
  const current = weekKey(now);
  const due = await db.select().from(leagueGroups).where(and(isNull(leagueGroups.settledAt), lt(leagueGroups.weekKey, current))).limit(50);
  for (const g of due) {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(leagueGroups).where(and(eq(leagueGroups.id, g.id), isNull(leagueGroups.settledAt))).for('update', { skipLocked: true });
      if (!locked) return;
      const members = await tx.select().from(leagueMembers).where(eq(leagueMembers.groupId, g.id)).orderBy(desc(leagueMembers.points), desc(leagueMembers.deliveries), asc(leagueMembers.joinedAt));
      const n = members.length;
      for (const [i, m] of members.entries()) {
        const rank = i + 1;
        const outcome = outcomeFor(g.tier, rank, n);
        await tx.update(leagueMembers).set({ finalRank: rank, outcome }).where(and(eq(leagueMembers.weekKey, m.weekKey), eq(leagueMembers.userId, m.userId)));
        const nextTier = outcome === 'up' ? g.tier + 1 : outcome === 'down' ? g.tier - 1 : g.tier;
        await tx.update(users).set({ leagueTier: nextTier }).where(eq(users.id, m.userId));
        const prize = leaguePrize(g.tier, rank);
        const key = `league:${g.weekKey}:${m.userId}`;
        if (prize) {
          const [acct] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, m.userId));
          if (acct) await post(tx, acct.id, [{ category: 'league_reward', amountCents: prize.cents, description: `Лига ${LEAGUE_TIERS[g.tier]!.name}: ${rank}. място`, idempotencyKey: `${key}:cents` }]);
          await postCoins(tx, m.userId, { amount: prize.coins, reason: 'league_reward', description: `Лига ${LEAGUE_TIERS[g.tier]!.name}: ${rank}. място`, idempotencyKey: `${key}:coins` });
        }
        const move = outcome === 'up' ? `Качваш се в ${LEAGUE_TIERS[nextTier]!.name}!` : outcome === 'down' ? `Слизаш в ${LEAGUE_TIERS[nextTier]!.name}.` : `Оставаш в ${LEAGUE_TIERS[g.tier]!.name}.`;
        await notify(tx, m.userId, prize || outcome === 'up' ? 'achievement' : 'info', `Седмичната лига приключи: ${rank}. място`, `${move}${prize ? ` Награда: ${(prize.cents / 100).toLocaleString('bg-BG')} € и ${prize.coins} TC.` : ''}`, '/game/league');
      }
      await tx.update(leagueGroups).set({ settledAt: now }).where(eq(leagueGroups.id, g.id));
    });
  }
  return due.length;
}

/** The player's group this week (or why they are not in one yet). */
export async function leagueView(db: DbOrTx, userId: string, now = new Date()) {
  const week = weekKey(now);
  const [u] = await db.select({ tier: users.leagueTier }).from(users).where(eq(users.id, userId));
  const [me] = await db.select().from(leagueMembers).where(and(eq(leagueMembers.weekKey, week), eq(leagueMembers.userId, userId)));
  const [last] = await db.select().from(leagueMembers).where(and(eq(leagueMembers.userId, userId), sql`${leagueMembers.finalRank} is not null`)).orderBy(desc(leagueMembers.weekKey)).limit(1);
  const tier = me?.tier ?? u?.tier ?? 0;
  const rows = me
    ? await db
        .select({ userId: leagueMembers.userId, points: leagueMembers.points, deliveries: leagueMembers.deliveries, username: users.username, role: users.role, vipUntil: users.vipUntil, lastSeenAt: users.lastSeenAt, level: users.level, avatarVersion: users.avatarVersion })
        .from(leagueMembers)
        .innerJoin(users, eq(users.id, leagueMembers.userId))
        .where(eq(leagueMembers.groupId, me.groupId))
        .orderBy(desc(leagueMembers.points), desc(leagueMembers.deliveries), asc(leagueMembers.joinedAt))
    : [];
  return {
    week,
    endsAt: weekEndsAt(week),
    tier,
    joined: !!me,
    last: last ?? null,
    members: rows.map((r, i) => ({ ...r, rank: i + 1, vip: isVip(r.vipUntil, now), online: isOnline(r.lastSeenAt, now), me: r.userId === userId, outcome: outcomeFor(tier, i + 1, rows.length) })),
  };
}
