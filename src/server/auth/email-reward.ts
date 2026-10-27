import { and, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database, Tx } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { notify } from '@/server/game/notify';
import { featureFor } from '@/server/features';
import { t } from '@/i18n/t';

/** 1.1.3: ТрансКоин for a confirmed e-mail address — once per account. */
export const EMAIL_REWARD_COINS = 10;

/** Pays the reward if not paid yet (inside the transaction that confirms the address). */
export async function rewardVerifiedEmail(tx: Tx, userId: string, now = new Date()) {
  if (!(await featureFor(tx, userId, 'email_reward', now))) return false;
  const paid = await postCoins(tx, userId, { amount: EMAIL_REWARD_COINS, reason: 'email_verified', description: t('Потвърден имейл'), idempotencyKey: `email-verified:${userId}` });
  if (paid) await notify(tx, userId, 'success', () => t('Имейлът е потвърден'), () => t('+{0} ТрансКоин — благодарим! Вече можеш да си върнеш профила и да пазаруваш.', EMAIL_REWARD_COINS), '/game/shop');
  return paid;
}

/**
 * The players who confirmed their address before the reward existed get it too
 * (the worker runs this once when the release goes live; the key keeps it once per account).
 */
export async function rewardEarlierVerified(db: Database, now: Date) {
  const rows = await db.select({ id: users.id }).from(users).where(and(isNotNull(users.emailVerifiedAt), isNull(users.bannedAt), sql`not exists (select 1 from coin_entries e where e.idempotency_key = 'email-verified:' || ${users.id}::text)`)).limit(5000);
  let paid = 0;
  for (const r of rows) if (await db.transaction((tx) => rewardVerifiedEmail(tx, r.id, now))) paid++;
  return paid;
}
