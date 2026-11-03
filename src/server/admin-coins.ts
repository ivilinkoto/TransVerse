import { and, desc, eq, gte, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '@/server/db/client';
import { coinEntries, users } from '@/server/db/schema';

/**
 * 1.2.1 for the team: where ТрансКоин come from and where they go — every entry
 * of the ТрансКоин ledger with filters, totals by reason, the biggest gainers and
 * entries worth a second look (large amounts that are not purchases).
 */
export const COIN_WATCH = {
  /** One entry this big (and not a purchase) is flagged. */
  bigEntry: 500,
  /** More than this many ТрансКоин in a day from play (not purchases) is flagged. */
  bigDay: 1000,
} as const;

export interface CoinFilter {
  username?: string;
  reason?: string;
  days: number;
  /** Only entries of at least this size (in or out). */
  min?: number;
}

const actor = alias(users, 'actor');

export async function coinMovement(db: DbOrTx, f: CoinFilter, now = new Date()) {
  const since = new Date(now.getTime() - f.days * 86_400_000);
  const [player] = f.username ? await db.select({ id: users.id, username: users.username, coins: users.coins }).from(users).where(sql`lower(${users.username}) = lower(${f.username})`) : [];
  const where = and(
    gte(coinEntries.createdAt, since),
    lte(coinEntries.createdAt, now),
    f.username ? eq(coinEntries.userId, player?.id ?? '00000000-0000-0000-0000-000000000000') : undefined,
    f.reason ? eq(coinEntries.reason, f.reason) : undefined,
    f.min ? or(gte(coinEntries.amount, f.min), lte(coinEntries.amount, -f.min)) : undefined,
  );
  const [entries, byReason, gainers, flagged] = await Promise.all([
    db
      .select({ id: coinEntries.id, at: coinEntries.createdAt, username: users.username, userId: coinEntries.userId, amount: coinEntries.amount, balanceAfter: coinEntries.balanceAfter, reason: coinEntries.reason, description: coinEntries.description, actor: actor.username })
      .from(coinEntries)
      .innerJoin(users, eq(users.id, coinEntries.userId))
      .leftJoin(actor, eq(actor.id, coinEntries.actorUserId))
      .where(where)
      .orderBy(desc(coinEntries.createdAt))
      .limit(200),
    db
      .select({ reason: coinEntries.reason, in: sql<number>`coalesce(sum(case when ${coinEntries.amount} > 0 then ${coinEntries.amount} else 0 end), 0)::int`, out: sql<number>`coalesce(sum(case when ${coinEntries.amount} < 0 then -${coinEntries.amount} else 0 end), 0)::int`, n: sql<number>`count(*)::int` })
      .from(coinEntries)
      .where(where)
      .groupBy(coinEntries.reason)
      .orderBy(desc(sql`sum(abs(${coinEntries.amount}))`)),
    db
      .select({ username: users.username, userId: coinEntries.userId, gained: sql<number>`sum(${coinEntries.amount})::int`, coins: users.coins })
      .from(coinEntries)
      .innerJoin(users, eq(users.id, coinEntries.userId))
      .where(and(where, sql`${coinEntries.reason} <> 'purchase'`))
      .groupBy(coinEntries.userId, users.username, users.coins)
      .orderBy(desc(sql`sum(${coinEntries.amount})`))
      .limit(15),
    // Worth a second look: a big single entry that was not paid for, or a player who got a lot from play in one day.
    db.execute<{ username: string; user_id: string; day: string; total: number; biggest: number }>(sql`
      select u.username, e.user_id, to_char(date_trunc('day', e.created_at at time zone 'Europe/Sofia'), 'YYYY-MM-DD') as day,
             sum(e.amount)::int as total, max(e.amount)::int as biggest
      from coin_entries e join users u on u.id = e.user_id
      where e.created_at >= ${since} and e.amount > 0 and e.reason not in ('purchase', 'payment_refund')
      group by u.username, e.user_id, day
      having sum(e.amount) > ${COIN_WATCH.bigDay} or max(e.amount) >= ${COIN_WATCH.bigEntry}
      order by day desc, total desc
      limit 30`),
  ]);
  const totalIn = byReason.reduce((s, r) => s + r.in, 0);
  const totalOut = byReason.reduce((s, r) => s + r.out, 0);
  return { player: player ?? null, entries, byReason, gainers, flagged: flagged.rows, totalIn, totalOut, since };
}
