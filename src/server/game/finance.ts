import { eq, sql } from 'drizzle-orm';
import type { Tx } from '@/server/db/client';
import { companies, ledgerEntries, organizations, treasuryEntries } from '@/server/db/schema';
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
  | 'admin_adjustment'
  | 'company_bonus'
  | 'company_contribution'
  | 'member_contributions'
  | 'company_upgrade'
  | 'treasury_deposit'
  | 'company_dissolution'
  | 'licences'
  | 'mission_reward'
  | 'event_reward'
  | 'daily_reward'
  | 'road_events'
  | 'market_fee'
  | 'referral_reward'
  | 'reputation_bonus'
  | 'trade_purchase'
  | 'trade_sale'
  | 'league_reward'
  | 'season_pass'
  | 'client_bonus';

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
  company_bonus: 'Бонус от компанията',
  company_contribution: 'Вноска към компанията',
  member_contributions: 'Вноски от членове',
  company_upgrade: 'Развитие на компанията',
  treasury_deposit: 'Внесени в касата на компанията',
  company_dissolution: 'Остатък от касата при закриване',
  licences: 'Лицензи',
  mission_reward: 'Награди от мисии',
  event_reward: 'Награди от ивенти',
  daily_reward: 'Дневни награди',
  road_events: 'Пътни инциденти',
  market_fee: 'Такса на пазара за употребявана техника',
  referral_reward: 'Награди за поканени приятели',
  reputation_bonus: 'Бонус за репутация',
  trade_purchase: 'Покупка на стоки',
  trade_sale: 'Продажба на стоки',
  league_reward: 'Награди от лигата',
  season_pass: 'Сезонен пропуск',
  client_bonus: 'Бонуси от договори с клиенти',
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

// ── Company treasury ─────────────────────────────────────────────────────

export type TreasuryCategory = 'member_contribution' | 'deposit' | 'company_upgrade' | 'dissolution' | 'admin_adjustment' | 'company_mission' | 'company_licence' | 'tender_deposit' | 'tender_bonus' | 'season_prize';

export const TREASURY_LABELS: Record<TreasuryCategory, string> = {
  member_contribution: 'Вноска от курс',
  deposit: 'Внесени от член',
  company_upgrade: 'Развитие на компанията',
  dissolution: 'Закриване на компанията',
  admin_adjustment: 'Корекция от администратор',
  company_mission: 'Фирмени мисии',
  company_licence: 'Лицензи на компанията',
  tender_deposit: 'Депозити за търгове',
  tender_bonus: 'Бонуси от търгове',
  season_prize: 'Сезонни награди',
};

export interface TreasuryPosting {
  category: TreasuryCategory;
  amountCents: number;
  description: string;
  idempotencyKey: string;
  actorUserId?: string | null;
  refType?: string;
  refId?: string;
}

/**
 * The only way company (treasury) money moves — the same guarantees as `post()`:
 * row lock, exactly-once postings, balance updated in the same transaction.
 */
export async function postTreasury(tx: Tx, organizationId: string, postings: TreasuryPosting[], options: { requireFunds?: boolean } = {}): Promise<number> {
  const [org] = await tx.select({ balance: organizations.treasuryCents }).from(organizations).where(eq(organizations.id, organizationId)).for('update');
  if (!org) fail('company_not_found', 'Компанията не е намерена.', 404);
  let balance = org!.balance;
  const total = postings.reduce((s, p) => s + p.amountCents, 0);
  if (options.requireFunds && total < 0 && balance + total < 0) fail('insufficient_treasury', 'В касата на компанията няма достатъчно средства.');

  let applied = 0;
  for (const p of postings) {
    if (!Number.isSafeInteger(p.amountCents)) throw new Error(`Invalid amount ${p.amountCents}`);
    const next = balance + p.amountCents;
    const inserted = await tx
      .insert(treasuryEntries)
      .values({ organizationId, category: p.category, amountCents: p.amountCents, balanceAfterCents: next, description: p.description, actorUserId: p.actorUserId ?? null, idempotencyKey: p.idempotencyKey, refType: p.refType, refId: p.refId })
      .onConflictDoNothing({ target: treasuryEntries.idempotencyKey })
      .returning({ id: treasuryEntries.id });
    if (inserted.length) {
      balance = next;
      applied++;
    }
  }
  if (applied) await tx.update(organizations).set({ treasuryCents: sql`${balance}` }).where(eq(organizations.id, organizationId));
  return applied;
}
