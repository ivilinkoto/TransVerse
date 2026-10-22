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
  | 'client_bonus'
  | 'holiday_reward'
  | 'fines'
  | 'insurance'
  | 'transfer_out'
  | 'transfer_in'
  | 'convoy_bonus'
  | 'hire_commission'
  | 'mentor_reward'
  | 'roadside_help'
  | 'roadside_paid'
  | 'crossings'
  | 'freight_escrow'
  | 'branch_bonus'
  | 'loan'
  | 'shared_load_bonus'
  | 'rally_prize'
  | 'oversize'
  | 'night_bonus'
  | 'perfect_bonus'
  | 'insurance_payout'
  | 'lease'
  | 'member_bonus';

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
  holiday_reward: 'Празнични награди',
  fines: 'Глоби',
  insurance: 'Застраховки',
  transfer_out: 'Изпратени пари',
  transfer_in: 'Получени пари',
  convoy_bonus: 'Бонус за конвой',
  hire_commission: 'Комисиони към компании за възложени курсове',
  mentor_reward: 'Награди за наставничество',
  roadside_help: 'Помощ на пътя (хонорари)',
  roadside_paid: 'Платена пътна помощ',
  crossings: 'Фериботи и влакове',
  freight_escrow: 'Борса между играчите (депозити)',
  branch_bonus: 'Бонус от филиал',
  loan: 'Кредит (отпускане и вноски)',
  shared_load_bonus: 'Бонус за общ товар',
  rally_prize: 'Награди от ралито',
  oversize: 'Разрешителни и придружаване (извънгабаритни)',
  night_bonus: 'Бонус „Нощна смяна“',
  perfect_bonus: 'Бонус за перфектна серия',
  insurance_payout: 'Обезщетения от застраховки',
  lease: 'Лизинг на камиони',
  member_bonus: 'Премии от компанията',
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

export type TreasuryCategory = 'member_contribution' | 'deposit' | 'company_upgrade' | 'dissolution' | 'admin_adjustment' | 'company_mission' | 'company_licence' | 'tender_deposit' | 'tender_bonus' | 'season_prize' | 'hire_commission' | 'company_project' | 'company_battle' | 'member_bonus' | 'company_build' | 'company_decor' | 'company_land' | 'company_fleet' | 'discord_activity' | 'ship_call' | 'factory' | 'company_branch' | 'company_trailer' | 'fuel_station' | 'alliance' | 'company_contract' | 'academy' | 'division';

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
  hire_commission: 'Комисиони от възложени курсове',
  company_project: 'Фирмени проекти',
  company_battle: 'Битки на компаниите',
  member_bonus: 'Премии за членове',
  company_build: 'Строежи на участъка',
  company_decor: 'Украса на участъка',
  company_land: 'Земя за участъка',
  company_fleet: 'Фирмени камиони',
  discord_activity: 'Най-активна компания в Discord',
  ship_call: 'Кораб пристига — първо място',
  factory: 'Фабрика (суровини и продажби)',
  company_branch: 'Филиали',
  company_trailer: 'Фирмени ремаркета (покупки и бонус от курсовете)',
  fuel_station: 'Бензиностанция',
  alliance: 'Съюз (цел и битка)',
  company_contract: 'Договори за превоз с други компании',
  academy: 'Фирмена академия',
  division: 'Награди от дивизията',
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
