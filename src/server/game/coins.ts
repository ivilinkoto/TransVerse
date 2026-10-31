import { desc, eq, sql } from 'drizzle-orm';
import type { DbOrTx, Tx } from '@/server/db/client';
import { coinEntries, users } from '@/server/db/schema';
import { fail } from './errors';
import { t } from '@/i18n/t';

export type CoinReason = 'admin_grant' | 'admin_remove' | 'purchase' | 'shop' | 'gift_received' | 'refund' | 'event_reward' | 'payment_refund' | 'daily_reward' | 'referral_reward' | 'league_reward' | 'season_pass' | 'holiday_reward' | 'auction_reward' | 'project_reward' | 'mentor_reward' | 'weekly_goal' | 'discord_link' | 'giveaway' | 'discord_level' | 'photo_contest' | 'quiz' | 'daily_load' | 'duel' | 'livery_contest' | 'rally' | 'challenge' | 'tournament' | 'legend' | 'plate_auction' | 'postcards' | 'truck_contest' | 'humanitarian' | 'harvest' | 'story' | 'email_verified' | 'big_run' | 'mystery_client' | 'fog_pilot' | 'lost_cargo';

export const COIN_REASON_LABELS: Record<CoinReason, string> = {
  postcards: 'Картички от пътя',
  harvest: 'Гроздобер',
  story: 'Историята',
  email_verified: 'Потвърден имейл',
  truck_contest: 'Камион на месеца',
  humanitarian: 'Хуманитарен конвой',
  rally: 'Седмично рали',
  challenge: 'Евротур и предизвикателства',
  tournament: 'Пролетна купа',
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
  season_pass: 'Сезонен пропуск',
  big_run: 'Голям рейс',
  mystery_client: 'Тайният клиент',
  fog_pilot: 'Пилот в мъглата',
  lost_cargo: 'Изгубена пратка',
};

/**
 * The only way ТрансКоин move. Locks the user row, writes the entry exactly once
 * (idempotency key) and updates the balance in the same transaction. Returns
 * false when the key was already used (nothing changed).
 */
export async function postCoins(
  tx: Tx,
  userId: string,
  entry: { amount: number; reason: CoinReason; description: string; idempotencyKey: string; actorUserId?: string | null },
  options: { requireFunds?: boolean } = {},
): Promise<boolean> {
  if (!Number.isSafeInteger(entry.amount) || entry.amount === 0) throw new Error(`Invalid coin amount ${entry.amount}`);
  const [user] = await tx.select({ coins: users.coins }).from(users).where(eq(users.id, userId)).for('update');
  if (!user) fail('user_not_found', t('Потребителят не е намерен.'), 404);
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

export async function coinHistory(db: DbOrTx, userId: string, limit = 30) {
  return db.select().from(coinEntries).where(eq(coinEntries.userId, userId)).orderBy(desc(coinEntries.id)).limit(limit);
}
