import { and, eq, gte, sql } from 'drizzle-orm';
import type { Tx } from '@/server/db/client';
import { companies, contracts, deliveries, userBadges } from '@/server/db/schema';
import { BUDITELI, buditeliBadge } from '@/lib/game/buditeli';
import { postCoins } from './coins';
import { notify } from './notify';
import { t } from '@/i18n/t';

/**
 * 1.1.4, Ден на будителите: after a delivery of the holiday's books, the third
 * one this year brings the badge of the year and ТрансКоин (once).
 */
export async function recordBuditeliDelivery(tx: Tx, userId: string, completedAt: Date) {
  const year = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', year: 'numeric' }).format(completedAt));
  const from = new Date(Date.UTC(year, 9, 25));
  const [{ n = 0 } = {}] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed'), eq(contracts.holiday, 'buditeli'), gte(deliveries.completedAt, from)));
  if (n < BUDITELI.forBadge) return false;
  const badge = buditeliBadge(year);
  const [fresh] = await tx.insert(userBadges).values({ userId, badge, awardedAt: completedAt }).onConflictDoNothing().returning({ badge: userBadges.badge });
  if (!fresh) return false;
  await postCoins(tx, userId, { amount: BUDITELI.coins, reason: 'holiday_reward', description: t('Ден на народните будители'), idempotencyKey: `buditeli:${year}:${userId}` });
  await notify(tx, userId, 'achievement', () => t('Значка „Будител {0}“', year), () => t('{0} товара книги и учебни пособия в Деня на будителите — +{1} ТрансКоин. Честит празник!', BUDITELI.forBadge, BUDITELI.coins), '/game/progress');
  return true;
}
