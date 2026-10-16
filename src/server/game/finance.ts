import { eq, sql } from 'drizzle-orm';
import type { Tx } from '@/server/db/client';
import { companies, ledgerEntries } from '@/server/db/schema';
import { fail } from './errors';

export type LedgerCategory =
  | 'starting_capital'
  | 'freight'
  | 'bonus'
  | 'penalty'
  | 'fuel'
  | 'tolls'
  | 'maintenance'
  | 'repairs'
  | 'salaries'
  | 'severance'
  | 'vehicle_purchase'
  | 'vehicle_sale'
  | 'upgrades'
  | 'depots'
  | 'achievement_reward'
  | 'rental'
  | 'company_founding'
  | 'tutorial_reward'
  | 'admin_adjustment';

export const LEDGER_LABELS: Record<LedgerCategory, string> = {
  starting_capital: 'Начален капитал',
  freight: 'Възнаграждения за курсове',
  bonus: 'Бонус за точност',
  penalty: 'Неустойка',
  fuel: 'Гориво',
  tolls: 'Пътни такси',
  maintenance: 'Поддръжка',
  repairs: 'Ремонти',
  salaries: 'Заплати',
  severance: 'Обезщетения',
  vehicle_purchase: 'Покупка на техника',
  vehicle_sale: 'Продажба на техника',
  upgrades: 'Подобрения',
  depots: 'Депа',
  achievement_reward: 'Награди',
  rental: 'Наем на техника',
  company_founding: 'Регистрация на компания',
  tutorial_reward: 'Награда от обучението',
  admin_adjustment: 'Корекция от администратор',
};

export interface Posting {
  category: LedgerCategory;
  amountCents: number;
  description: string;
  /** Unique per cause; a repeated posting with the same key is ignored. */
  idempotencyKey: string;
  refType?: string;
  refId?: string;
}

/**
 * The only way money moves. Locks the company row, writes every posting to the
 * ledger exactly once (idempotency key) and updates the balance in the same
 * database transaction. Returns how many postings were applied.
 */
export async function post(tx: Tx, companyId: string, postings: Posting[], options: { requireFunds?: boolean } = {}): Promise<number> {
  const [company] = await tx.select({ balance: companies.balanceCents }).from(companies).where(eq(companies.id, companyId)).for('update');
  if (!company) fail('company_not_found', 'Компанията не е намерена.', 404);
  let balance = company!.balance;

  const total = postings.reduce((s, p) => s + p.amountCents, 0);
  if (options.requireFunds && total < 0 && balance + total < 0) fail('insufficient_funds', 'Нямате достатъчно средства.');

  let applied = 0;
  for (const p of postings) {
    if (!Number.isSafeInteger(p.amountCents)) throw new Error(`Invalid amount ${p.amountCents}`);
    const next = balance + p.amountCents;
    const inserted = await tx
      .insert(ledgerEntries)
      .values({ companyId, category: p.category, amountCents: p.amountCents, balanceAfterCents: next, description: p.description, idempotencyKey: p.idempotencyKey, refType: p.refType, refId: p.refId })
      .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
      .returning({ id: ledgerEntries.id });
    if (inserted.length) {
      balance = next;
      applied++;
    }
  }
  if (applied) await tx.update(companies).set({ balanceCents: sql`${balance}` }).where(eq(companies.id, companyId));
  return applied;
}
