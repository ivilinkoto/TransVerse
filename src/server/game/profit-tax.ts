/**
 * 1.3.2.1 „Честна монета“: the weekly profit tax (rules in src/lib/game/profit-tax.ts).
 * The worker charges last week's tax once per account (a key per account and
 * week), never below a zero balance.
 */
import { and, eq, gte, lt, notInArray, sql } from 'drizzle-orm';
import { PROFIT_TAX, profitTaxCents } from '@/lib/game/profit-tax';
import { weekEndsAt, weekKey } from '@/lib/game/leagues';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, jobState, ledgerEntries } from '@/server/db/schema';
import { post } from './finance';
import { notify } from './notify';
import { money } from '@/lib/format';
import { t } from '@/i18n/t';

const weekStart = (key: string) => new Date(weekEndsAt(key).getTime() - 7 * 86_400_000);

/** One account's profit in a week (cents). */
export async function weekProfit(db: DbOrTx, companyId: string, key: string) {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)::bigint` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.companyId, companyId), gte(ledgerEntries.createdAt, weekStart(key)), lt(ledgerEntries.createdAt, weekEndsAt(key)), notInArray(ledgerEntries.category, [...PROFIT_TAX.excluded])));
  return Number(row?.n ?? 0);
}

/** This week so far: the profit and the tax it would make (the finance page). */
export async function taxThisWeek(db: DbOrTx, companyId: string, now = new Date()) {
  const key = weekKey(now);
  const profit = await weekProfit(db, companyId, key);
  return { profit, tax: profitTaxCents(profit), endsAt: weekEndsAt(key), live: key >= PROFIT_TAX.firstWeek };
}

/** Worker: last week's tax for every account whose profit is over the free bracket. */
export async function chargeProfitTax(db: Database, now = new Date()) {
  const key = weekKey(new Date(now.getTime() - 7 * 86_400_000));
  if (key < PROFIT_TAX.firstWeek) return 0;
  // Once a week: the run marks the week as done (each charge is idempotent anyway).
  const done = `profit-tax-week:${key}`;
  if ((await db.select({ k: jobState.key }).from(jobState).where(eq(jobState.key, done))).length) return 0;
  const free = (PROFIT_TAX.brackets[1]?.from ?? 0) * 100;
  const rows = await db
    .select({ companyId: ledgerEntries.companyId, profit: sql<number>`sum(${ledgerEntries.amountCents})::bigint` })
    .from(ledgerEntries)
    .where(and(gte(ledgerEntries.createdAt, weekStart(key)), lt(ledgerEntries.createdAt, weekEndsAt(key)), notInArray(ledgerEntries.category, [...PROFIT_TAX.excluded])))
    .groupBy(ledgerEntries.companyId)
    .having(sql`sum(${ledgerEntries.amountCents}) > ${free}`);
  let charged = 0;
  for (const r of rows) {
    const profit = Number(r.profit);
    const ok = await db.transaction(async (tx) => {
      const [acc] = await tx.select({ id: companies.id, ownerId: companies.ownerId, balance: companies.balanceCents }).from(companies).where(eq(companies.id, r.companyId)).for('update');
      if (!acc) return false;
      const tax = Math.min(profitTaxCents(profit), Math.max(0, acc.balance));
      if (tax <= 0) return false;
      const paid = await post(tx, acc.id, [{ category: 'profit_tax', amountCents: -tax, description: t('Данък върху печалбата за седмицата ({0})', money(profit)), idempotencyKey: `profit-tax:${acc.id}:${key}` }]);
      if (!paid) return false;
      await notify(tx, acc.ownerId, 'info', () => t('🧾 Данък върху печалбата: {0}', money(tax)), () => t('Печалбата ти за миналата седмица е {0}. Данъкът е прогресивен: до 150 000 лв. е 0%.', money(profit)), '/game/finance');
      return true;
    });
    if (ok) charged++;
  }
  await db.insert(jobState).values({ key: done, value: { charged, at: now.toISOString() }, updatedAt: now }).onConflictDoNothing();
  return charged;
}
