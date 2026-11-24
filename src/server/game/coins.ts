import { and, desc, eq, gt, gte, notInArray, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '@/server/db/client';
import { coinEntries, companies, users } from '@/server/db/schema';
import { post } from './finance';
import { notify } from './notify';
import { capWeekStart, capped, COIN_CAP, moneyForCoins, paidInMoney, splitByCap } from '@/lib/game/coin-cap';
import { UNTAPERED_REASONS } from '@/lib/game/coin-taper';
import { fail } from './errors';
import { t } from '@/i18n/t';
import { taperCoins } from '@/lib/game/coin-taper';

export type CoinReason = 'admin_grant' | 'admin_remove' | 'purchase' | 'shop' | 'gift_received' | 'refund' | 'event_reward' | 'payment_refund' | 'daily_reward' | 'referral_reward' | 'league_reward' | 'season_pass' | 'holiday_reward' | 'auction_reward' | 'project_reward' | 'mentor_reward' | 'weekly_goal' | 'discord_link' | 'giveaway' | 'discord_level' | 'photo_contest' | 'quiz' | 'daily_load' | 'duel' | 'livery_contest' | 'rally' | 'challenge' | 'tournament' | 'legend' | 'plate_auction' | 'postcards' | 'truck_contest' | 'humanitarian' | 'harvest' | 'story' | 'email_verified' | 'big_run' | 'mystery_client' | 'fog_pilot' | 'lost_cargo' | 'items' | 'promo' | 'item_sale' | 'board_refresh' | 'winter_trek' | 'tournament_fee' | 'tournament_prize';

export const COIN_REASON_LABELS: Record<CoinReason, string> = {
  winter_trek: 'Зимен поход',
  postcards: 'Картички от пътя',
  harvest: 'Гроздобер',
  story: 'Историята',
  email_verified: 'Потвърден имейл',
  truck_contest: 'Камион на месеца',
  humanitarian: 'Хуманитарен конвой',
  rally: 'Седмично рали',
  challenge: 'Евротур и предизвикателства',
  tournament: 'Пролетна купа',
  tournament_fee: 'Вход за седмичния турнир',
  tournament_prize: 'Награда от седмичния турнир',
  legend: 'Легендарен камион и музей',
  plate_auction: 'Търг за редки номера',
  admin_grant: 'Дадени от администратор',
  admin_remove: 'Отнети от администратор',
  purchase: 'Закупени',
  shop: 'Покупка в магазина',
  gift_received: 'Подарък',
  refund: 'Възстановени',
  event_reward: 'Награда от ивент',
  holiday_reward: 'Празнична награда',
  auction_reward: 'Специален товар',
  project_reward: 'Фирмен проект',
  mentor_reward: 'Наставничество',
  weekly_goal: 'Седмична цел',
  discord_link: 'Свързан Discord',
  giveaway: 'Раздаване в Discord',
  discord_level: 'Ниво в Discord',
  photo_contest: 'Конкурс за снимки',
  quiz: 'Викторина в Discord',
  daily_load: 'Товар на деня',
  duel: 'Дуел',
  livery_contest: 'Конкурс за ливрея',
  payment_refund: 'Върнато плащане',
  daily_reward: 'Дневна награда',
  referral_reward: 'Награда за поканен приятел',
  league_reward: 'Награда от лигата',
  season_pass: 'Truck Pass',
  big_run: 'Голям рейс',
  mystery_client: 'Тайният клиент',
  fog_pilot: 'Пилот в мъглата',
  lost_cargo: 'Изгубена пратка',
  items: 'Предмети от инвентара',
  promo: 'Промокод',
  item_sale: 'Продадени предмети',
  board_refresh: 'Нови товари (обновяване)',
};

/**
 * The only way ТрансКоин move. Locks the user row, writes the entry exactly once
 * (idempotency key) and updates the balance in the same transaction. Returns
 * false when the key was already used (nothing changed).
 */
export async function postCoins(
  tx: Tx,
  userId: string,
  entry: { amount: number; reason: CoinReason; description: string; idempotencyKey: string; actorUserId?: string | null; at?: Date },
  options: { requireFunds?: boolean } = {},
): Promise<boolean> {
  if (!Number.isSafeInteger(entry.amount) || entry.amount === 0) throw new Error(`Invalid coin amount ${entry.amount}`);
  // 1.3.2.1: most rewards are paid in game money, not ТрансКоин (tests: only when they pass `at`, like the taper).
  if (entry.amount > 0 && paidInMoney(entry.reason) && (entry.at || process.env.NODE_ENV !== 'test')) {
    const [acc] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
    if (acc) await post(tx, acc.id, [{ category: 'bonus', amountCents: moneyForCoins(entry.amount), description: entry.description, idempotencyKey: `${entry.idempotencyKey}:money` }]);
    return true;
  }
  // 1.2.6: rewards pay a little less step by step (src/lib/game/coin-taper.ts). Tests see the full amounts
  // unless they pass `at`, so their expectations do not change with the calendar.
  if (entry.amount > 0 && (entry.at || process.env.NODE_ENV !== 'test')) entry = { ...entry, amount: taperCoins(entry.amount, entry.at ?? new Date(), entry.reason) };
  const [user] = await tx.select({ coins: users.coins }).from(users).where(eq(users.id, userId)).for('update');
  if (!user) fail('user_not_found', t('Потребителят не е намерен.'), 404);
  // 1.3.2.1: rewards over the weekly cap are paid in game money (tests: only when they pass `at`, like the taper).
  if (entry.amount > 0 && capped(entry.reason) && (entry.at || process.env.NODE_ENV !== 'test')) {
    const at = entry.at ?? new Date();
    const earned = await earnedThisWeek(tx, userId, at);
    const { coins, over } = splitByCap(entry.amount, earned);
    if (over > 0) {
      const [acc] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
      if (acc) await post(tx, acc.id, [{ category: 'bonus', amountCents: over * COIN_CAP.centsPerCoin, description: t('{0} TC над седмичния таван станаха пари ({1})', over, entry.description), idempotencyKey: `${entry.idempotencyKey}:over-cap` }]);
      // Once a week, when the cap is reached.
      if (earned < COIN_CAP.weekly) await notify(tx, userId, 'info', () => t('Седмичният таван от {0} TC е достигнат', COIN_CAP.weekly), () => t('До понеделник наградите в ТрансКоин се изплащат в пари ({0} лв. за 1 TC). Купените TC не се броят.', COIN_CAP.centsPerCoin / 100), '/game/shop');
      if (!coins) return true;
      entry = { ...entry, amount: coins };
    }
  }
  const next = user!.coins + entry.amount;
  if (options.requireFunds && next < 0) fail('insufficient_coins', t('Нямате достатъчно ТрансКоин.'));
  const inserted = await tx
    .insert(coinEntries)
    .values({ userId, amount: entry.amount, balanceAfter: next, reason: entry.reason, description: entry.description, actorUserId: entry.actorUserId ?? null, idempotencyKey: entry.idempotencyKey })
    .onConflictDoNothing({ target: coinEntries.idempotencyKey })
    .returning({ id: coinEntries.id });
  if (!inserted.length) return false;
  await tx.update(users).set({ coins: sql`${next}` }).where(eq(users.id, userId));
  return true;
}

/** ТрансКоин earned this week that count towards the cap (rewards and items sold to the game). */
export async function earnedThisWeek(db: DbOrTx, userId: string, now = new Date()) {
  const free = UNTAPERED_REASONS.filter((r) => r !== 'item_sale');
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${coinEntries.amount}), 0)::int` })
    .from(coinEntries)
    .where(and(eq(coinEntries.userId, userId), gt(coinEntries.amount, 0), gte(coinEntries.createdAt, capWeekStart(now)), notInArray(coinEntries.reason, [...free])));
  return row?.n ?? 0;
}

export async function coinHistory(db: DbOrTx, userId: string, limit = 30) {
  return db.select().from(coinEntries).where(eq(coinEntries.userId, userId)).orderBy(desc(coinEntries.id)).limit(limit);
}
