import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';

/**
 * The game economy for administrators (v1.4): the money in the game (players,
 * treasuries, ТрансКоин), how much came in and went out in the last week and
 * the week before (the change of the money supply is the "inflation" of the
 * game), the average pay of a delivery and the richest players. Game data.
 */
export async function economyOverview(db: DbOrTx, now = new Date()) {
  const week = new Date(now.getTime() - 7 * 86_400_000);
  const prev = new Date(now.getTime() - 14 * 86_400_000);
  const { rows: [supply] } = await db.execute<{ players: string; treasuries: string; coins: string; accounts: number }>(sql`
    select (select coalesce(sum(balance_cents), 0) from companies) as players,
           (select coalesce(sum(treasury_cents), 0) from organizations) as treasuries,
           (select coalesce(sum(coins), 0) from users) as coins,
           (select count(*)::int from companies) as accounts`);
  const { rows: flows } = await db.execute<{ category: string; income: string; spent: string }>(sql`
    select category, coalesce(sum(amount_cents) filter (where amount_cents > 0), 0) as income, coalesce(-sum(amount_cents) filter (where amount_cents < 0), 0) as spent
    from ledger_entries where created_at >= ${week} group by category order by abs(sum(amount_cents)) desc`);
  const { rows: [net] } = await db.execute<{ this_week: string; last_week: string }>(sql`
    select coalesce(sum(amount_cents) filter (where created_at >= ${week}), 0) as this_week,
           coalesce(sum(amount_cents) filter (where created_at >= ${prev} and created_at < ${week}), 0) as last_week
    from ledger_entries where created_at >= ${prev}`);
  const { rows: [pay] } = await db.execute<{ this_week: string | null; last_week: string | null; trips: number }>(sql`
    select avg(payout_cents) filter (where completed_at >= ${week}) as this_week,
           avg(payout_cents) filter (where completed_at >= ${prev} and completed_at < ${week}) as last_week,
           (count(*) filter (where completed_at >= ${week}))::int as trips
    from deliveries where status = 'completed' and completed_at >= ${prev}`);
  const { rows: richest } = await db.execute<{ username: string; balance: string; deliveries: number }>(sql`
    select u.username, c.balance_cents as balance, c.deliveries from companies c join users u on u.id = c.owner_id order by c.balance_cents desc limit 10`);
  const players = Number(supply!.players);
  const treasuries = Number(supply!.treasuries);
  const total = players + treasuries;
  const netWeek = Number(net!.this_week);
  return {
    players,
    treasuries,
    total,
    coins: Number(supply!.coins),
    accounts: supply!.accounts,
    netWeek,
    netLastWeek: Number(net!.last_week),
    /** Growth of the players' money in the last week, relative to what was there before it. */
    inflation: total - netWeek > 0 ? netWeek / (total - netWeek) : 0,
    avgPay: pay!.this_week == null ? null : Math.round(Number(pay!.this_week)),
    avgPayLastWeek: pay!.last_week == null ? null : Math.round(Number(pay!.last_week)),
    trips: pay!.trips,
    flows: flows.map((f) => ({ category: f.category, income: Number(f.income), spent: Number(f.spent) })),
    richest: richest.map((r) => ({ username: r.username, balance: Number(r.balance), deliveries: r.deliveries })),
  };
}

export const FRAUD = {
  /** A transfer this big (or this many to one player in a week) is worth a look. */
  bigTransferCents: 50_000_00,
  manyTransfers: 5,
  /** Money this fast (net in 24 h, not from freight) is worth a look. */
  fastMoneyCents: 200_000_00,
} as const;

/**
 * Signals for the staff (never automatic punishment): accounts from the same
 * network (signup IP hash), transfers between them, big or repeated transfers
 * and money that came fast and not from freight.
 */
export async function fraudSignals(db: DbOrTx, now = new Date()) {
  const week = new Date(now.getTime() - 7 * 86_400_000);
  const day = new Date(now.getTime() - 86_400_000);
  const { rows: networks } = await db.execute<{ hash: string; users: string[]; n: number }>(sql`
    select signup_ip_hash as hash, array_agg(username order by created_at) as users, count(*)::int as n
    from users where signup_ip_hash is not null and banned_at is null group by signup_ip_hash having count(*) > 1 order by count(*) desc limit 20`);
  const { rows: sameNetwork } = await db.execute<{ from_name: string; to_name: string; amount: string; n: number }>(sql`
    select f.username as from_name, t.username as to_name, sum(m.amount_cents) as amount, count(*)::int as n
    from money_transfers m join users f on f.id = m.from_user_id join users t on t.id = m.to_user_id
    where m.created_at >= ${week} and f.signup_ip_hash is not null and f.signup_ip_hash = t.signup_ip_hash
    group by f.username, t.username order by sum(m.amount_cents) desc limit 20`);
  const { rows: transfers } = await db.execute<{ from_name: string; to_name: string; amount: string; n: number }>(sql`
    select f.username as from_name, t.username as to_name, sum(m.amount_cents) as amount, count(*)::int as n
    from money_transfers m join users f on f.id = m.from_user_id join users t on t.id = m.to_user_id
    where m.created_at >= ${week}
    group by f.username, t.username
    having sum(m.amount_cents) >= ${FRAUD.bigTransferCents} or count(*) >= ${FRAUD.manyTransfers}
    order by sum(m.amount_cents) desc limit 20`);
  const { rows: fast } = await db.execute<{ username: string; net: string; freight: string; other: string }>(sql`
    select u.username, sum(l.amount_cents) as net,
           coalesce(sum(l.amount_cents) filter (where l.category in ('freight', 'bonus')), 0) as freight,
           coalesce(sum(l.amount_cents) filter (where l.amount_cents > 0 and l.category not in ('freight', 'bonus')), 0) as other
    from ledger_entries l join companies c on c.id = l.company_id join users u on u.id = c.owner_id
    where l.created_at >= ${day}
    group by u.username
    having sum(l.amount_cents) >= ${FRAUD.fastMoneyCents}
    order by sum(l.amount_cents) desc limit 20`);
  return {
    networks: networks.map((n) => ({ hash: n.hash.slice(0, 8), users: n.users, n: n.n })),
    sameNetwork: sameNetwork.map((r) => ({ from: r.from_name, to: r.to_name, amount: Number(r.amount), n: r.n })),
    transfers: transfers.map((r) => ({ from: r.from_name, to: r.to_name, amount: Number(r.amount), n: r.n })),
    fast: fast.map((r) => ({ username: r.username, net: Number(r.net), freight: Number(r.freight), other: Number(r.other) })),
  };
}
