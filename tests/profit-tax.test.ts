import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { effectiveRate, PROFIT_TAX, profitTaxCents } from '@/lib/game/profit-tax';
import { weekEndsAt, weekKey } from '@/lib/game/leagues';
import { closeDb } from '@/server/db/client';
import { companies, jobState, ledgerEntries } from '@/server/db/schema';
import { post } from '@/server/game/finance';
import { chargeProfitTax, weekProfit } from '@/server/game/profit-tax';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const lv = (n: number) => n * 100;
/** The weekly run marks its week as done; the tests run it again. */
const fresh = (week: string) => db().delete(jobState).where(eq(jobState.key, `profit-tax-week:${week}`));

describe('1.3.2.1: the weekly profit tax', () => {
  it('is progressive: nothing for the small, more for the big', () => {
    expect(profitTaxCents(lv(-5_000))).toBe(0);
    expect(profitTaxCents(lv(150_000))).toBe(0);
    expect(profitTaxCents(lv(250_000))).toBe(lv(10_000));
    expect(profitTaxCents(lv(750_000))).toBe(lv(60_000));
    expect(profitTaxCents(lv(1_000_000))).toBe(lv(60_000 + 50_000));
    expect(profitTaxCents(lv(4_000_000))).toBe(lv(60_000 + 450_000 + 300_000));
    expect(effectiveRate(lv(4_000_000))).toBeLessThan(0.3);
    expect(PROFIT_TAX.excluded).toContain('transfer_in');
  });

  it('charges last week once, from the profit without transfers, never below zero', async () => {
    const p = await newPlayer();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    // A week after the first taxed one, so the tax is live.
    const lastWeek = PROFIT_TAX.firstWeek;
    const inWeek = new Date(weekEndsAt(lastWeek).getTime() - 86_400_000);
    const monday = new Date(weekEndsAt(lastWeek).getTime() + 3_600_000);
    await db().transaction((tx) => post(tx, acc!.id, [
      { category: 'freight', amountCents: lv(1_000_000), description: 'test', idempotencyKey: `tax-f:${acc!.id}` },
      { category: 'transfer_in', amountCents: lv(5_000_000), description: 'test', idempotencyKey: `tax-t:${acc!.id}` },
      { category: 'fuel', amountCents: -lv(100_000), description: 'test', idempotencyKey: `tax-u:${acc!.id}` },
    ]));
    // Put the entries inside the taxed week.
    await db().update(ledgerEntries).set({ createdAt: inWeek }).where(like(ledgerEntries.idempotencyKey, `tax-%:${acc!.id}`));
    expect(await weekProfit(db(), acc!.id, lastWeek)).toBe(lv(900_000));
    const [before] = await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.id, acc!.id));
    expect(weekKey(new Date(monday.getTime() - 7 * 86_400_000))).toBe(lastWeek);
    await fresh(lastWeek);
    await chargeProfitTax(db(), monday);
    await fresh(lastWeek);
    await chargeProfitTax(db(), monday);
    const [after] = await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.id, acc!.id));
    expect(before!.b - after!.b).toBe(profitTaxCents(lv(900_000)));
    expect(await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc!.id), eq(ledgerEntries.category, 'profit_tax')))).toHaveLength(1);
  });

  it('takes no more than the balance', async () => {
    const p = await newPlayer();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const lastWeek = PROFIT_TAX.firstWeek;
    const inWeek = new Date(weekEndsAt(lastWeek).getTime() - 86_400_000);
    await db().transaction((tx) => post(tx, acc!.id, [
      { category: 'freight', amountCents: lv(2_000_000), description: 'test', idempotencyKey: `taxb-f:${acc!.id}` },
      { category: 'transfer_out', amountCents: -lv(1_990_000), description: 'test', idempotencyKey: `taxb-t:${acc!.id}` },
    ]));
    await db().update(ledgerEntries).set({ createdAt: inWeek }).where(like(ledgerEntries.idempotencyKey, `taxb-%:${acc!.id}`));
    await fresh(lastWeek);
    await chargeProfitTax(db(), new Date(weekEndsAt(lastWeek).getTime() + 3_600_000));
    const [after] = await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.id, acc!.id));
    expect(after!.b).toBe(0);
  });
});
