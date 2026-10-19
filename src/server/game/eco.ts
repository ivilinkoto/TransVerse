import { eq, sql } from 'drizzle-orm';
import { ECO } from '@/lib/game/eco';
import { periodWindow } from '@/lib/game/missions';
import type { Database, DbOrTx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { post } from './finance';
import { notify } from './notify';

const WEEK = 7 * 86_400_000;

/** The week (Monday 00:00 – next Monday, Sofia) that contains `at`. */
export function ecoWeek(at: Date) {
  const w = periodWindow('weekly', at);
  return { key: w.key, from: new Date(w.endsAt.getTime() - WEEK), to: w.endsAt };
}

export interface EcoRow {
  userId: string;
  username: string;
  km: number;
  costCents: number;
  /** Cost per km, in stotinki. */
  perKm: number;
}

/** The week's ranking: own (not rented) trips, cheapest per km first, players with at least `minKm`. */
export async function ecoBoard(db: DbOrTx, week: { from: Date; to: Date }, minKm: number = ECO.minKm, limit = 20): Promise<EcoRow[]> {
  const cats = sql.join(ECO.categories.map((c) => sql`${c}`), sql`, `);
  const res = await db.execute<{ user_id: string; username: string; km: number; cost: number }>(sql`
    with trips as (
      select d.id, d.company_id, d.empty_km + d.loaded_km as km
      from deliveries d
      where d.status = 'completed' and d.completed_at >= ${week.from} and d.completed_at < ${week.to} and coalesce(d.rental_fee_cents, 0) = 0
    ), costs as (
      select l.ref_id, -sum(l.amount_cents) as cost
      from ledger_entries l
      where l.ref_type = 'delivery' and l.category in (${cats}) and l.ref_id in (select id::text from trips)
      group by l.ref_id
    )
    select u.id as user_id, u.username, sum(t.km)::float as km, coalesce(sum(c.cost), 0)::float as cost
    from trips t
    join companies co on co.id = t.company_id
    join users u on u.id = co.owner_id
    left join costs c on c.ref_id = t.id::text
    where u.banned_at is null
    group by u.id, u.username
    having sum(t.km) >= ${minKm}
    order by coalesce(sum(c.cost), 0) / nullif(sum(t.km), 0) asc
    limit ${limit}
  `);
  return res.rows.map((r) => ({ userId: r.user_id, username: r.username, km: Math.round(Number(r.km)), costCents: Math.round(Number(r.cost)), perKm: Number(r.cost) / Math.max(1, Number(r.km)) }));
}

/** Worker: once a week, pays the top three of the week that just ended. */
export async function settleEcoWeek(db: Database, now = new Date(), minKm: number = ECO.minKm) {
  const week = ecoWeek(new Date(now.getTime() - WEEK));
  const key = `eco:${week.key}`;
  let paid = 0;
  await db.transaction(async (tx) => {
    // Once per week, even with two workers.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const [done] = await tx.select().from(jobState).where(eq(jobState.key, key));
    if (done) return;
    const top = (await ecoBoard(tx, week, minKm)).slice(0, ECO.prizes.length);
    for (const [i, row] of top.entries()) {
      const prize = ECO.prizes[i]!;
      const account = await companyForUser(tx, row.userId);
      await post(tx, account.id, [{ category: 'league_reward', amountCents: prize.cents, description: `Икономичен шофьор: ${i + 1}. място (${week.key})`, idempotencyKey: `eco:${week.key}:${row.userId}` }]);
      await postCoins(tx, row.userId, { amount: prize.coins, reason: 'league_reward', description: `Икономичен шофьор: ${i + 1}. място`, idempotencyKey: `eco:${week.key}:${row.userId}:coins` });
      await notify(tx, row.userId, 'achievement', `Икономичен шофьор: ${i + 1}. място!`, `${(row.perKm / 100).toFixed(2).replace('.', ',')} лв./км за ${row.km.toLocaleString('bg-BG')} км. Награда: ${(prize.cents / 100).toLocaleString('bg-BG')} лв. и ${prize.coins} TC.`, '/game/leaderboards?tab=eco');
    }
    await tx.insert(jobState).values({ key, value: { paid: top.map((t) => t.userId) } });
    paid = top.length;
  });
  return paid;
}
