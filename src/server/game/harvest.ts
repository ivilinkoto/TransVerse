/** „Гроздобер“ (the autumn season): harvest loads delivered on time; ten in a season — a badge and ТрансКоин. */
import { and, eq, sql } from 'drizzle-orm';
import { HARVEST } from '@/lib/game/city-growth';
import { featureLive } from '@/lib/game/features';
import { BADGES } from '@/lib/game/halloween';
import type { DbOrTx, Tx } from '@/server/db/client';
import { harvestProgress, userBadges } from '@/server/db/schema';
import { postCoins } from './coins';
import { notify } from './notify';
import { t } from '@/i18n/t';

/** Гроздобер: a harvest load on time counts; ten in a season — a badge and ТрансКоин (once). */
export async function harvestDelivered(tx: Tx, userId: string, holiday: string | null, late: boolean, at: Date) {
  if (holiday !== 'harvest' || late || !featureLive('harvest', at)) return;
  const year = at.getUTCFullYear();
  const [p] = await tx.insert(harvestProgress).values({ userId, year, loads: 1 }).onConflictDoUpdate({ target: [harvestProgress.userId, harvestProgress.year], set: { loads: sql`${harvestProgress.loads} + 1` } }).returning();
  if (!p || p.rewarded || p.loads < HARVEST.loadsForBadge) return;
  const [won] = await tx.update(harvestProgress).set({ rewarded: true }).where(and(eq(harvestProgress.userId, userId), eq(harvestProgress.year, year), eq(harvestProgress.rewarded, false))).returning();
  if (!won) return;
  await postCoins(tx, userId, { amount: HARVEST.coins, reason: 'harvest', description: t('Гроздобер {0}: {1} есенни товара', year, HARVEST.loadsForBadge), idempotencyKey: `harvest:${year}:${userId}` });
  await tx.insert(userBadges).values({ userId, badge: HARVEST.badge, awardedAt: at }).onConflictDoNothing();
  await notify(tx, userId, 'achievement', () => t('Значка: {0} 🍇', BADGES[HARVEST.badge]?.label ?? t('Гроздобер')), () => t('{0} есенни товара навреме: +{1} TC.', HARVEST.loadsForBadge, HARVEST.coins), '/game/progress');
}

export async function harvestOf(db: DbOrTx, userId: string, now: Date) {
  const [p] = await db.select().from(harvestProgress).where(and(eq(harvestProgress.userId, userId), eq(harvestProgress.year, now.getUTCFullYear())));
  return { loads: p?.loads ?? 0, rewarded: !!p?.rewarded };
}
