import { and, count, eq, gt, inArray, isNull } from 'drizzle-orm';
import { dailyState } from '@/lib/game/daily';
import { money } from '@/lib/format';
import type { DbOrTx } from '@/server/db/client';
import { cities, contracts, fines, hitchhikers, vehicles } from '@/server/db/schema';
import { claimableCount } from './missions';
import { t } from '@/i18n/t';

export interface NextStep {
  emoji: string;
  text: string;
  href: string;
  action: string;
}

/**
 * v1.9 "Какво да правя сега?": up to three concrete things for the player
 * right now — the game says what to do instead of the player having to know
 * every page.
 */
export async function nextSteps(db: DbOrTx, user: { id: string; loginStreak: number; dailyClaimKey: string | null }, companyId: string, now: Date): Promise<NextStep[]> {
  const out: NextStep[] = [];
  const [fine] = await db.select({ amount: fines.amountCents }).from(fines).where(and(eq(fines.companyId, companyId), eq(fines.status, 'unpaid'))).limit(1);
  if (fine) out.push({ emoji: '👮', text: t('Имаш неплатена глоба ({0}) — плати или обжалвай.', money(fine.amount)), href: '/game/finance', action: t('Към глобите') });
  const [rider] = await db.select({ id: hitchhikers.id }).from(hitchhikers).where(and(eq(hitchhikers.userId, user.id), eq(hitchhikers.status, 'waiting'), gt(hitchhikers.waitUntil, now))).limit(1);
  if (rider) out.push({ emoji: '👋', text: t('Някой маха на пътя и чака да го вземеш.'), href: '/game/road', action: t('Виж') });
  // Idle trucks with a driver: how many loads wait in their city.
  const idle = await db
    .select({ plate: vehicles.plate, cityId: vehicles.cityId, city: cities.nameBg })
    .from(vehicles)
    .innerJoin(cities, eq(cities.id, vehicles.cityId))
    .where(and(eq(vehicles.companyId, companyId), eq(vehicles.status, 'idle'), isNull(vehicles.soldAt)))
    .limit(5);
  if (idle.length) {
    const loads = await db
      .select({ cityId: contracts.originCityId, n: count() })
      .from(contracts)
      .where(and(eq(contracts.status, 'open'), eq(contracts.shady, false), gt(contracts.expiresAt, now), inArray(contracts.originCityId, idle.map((v) => v.cityId)), isNull(contracts.tenderId), isNull(contracts.rallyId), isNull(contracts.factoryOrgId), isNull(contracts.branchOrgId)))
      .groupBy(contracts.originCityId);
    const best = idle.map((v) => ({ ...v, n: loads.find((l) => l.cityId === v.cityId)?.n ?? 0 })).sort((a, b) => b.n - a.n)[0]!;
    out.push(
      best.n > 0
        ? { emoji: '🚛', text: t('{0} — в {1} чакат {2} поръчки.', idle.length === 1 ? t('Камионът {0} стои', best.plate) : t('{0} камиона стоят', idle.length), best.city, best.n), href: `/game/contracts?from=${best.cityId}`, action: t('Избери товар') }
        : { emoji: '🚛', text: t('Камионът {0} стои в {1}. Виж борсата за товар наблизо.', best.plate, best.city), href: '/game/contracts', action: t('Към борсата') },
    );
  }
  const rewards = await claimableCount(db, user.id);
  if (rewards > 0) out.push({ emoji: '🎁', text: t('{0} {1} да ги вземеш от мисиите.', rewards, rewards === 1 ? t('награда чака') : t('награди чакат')), href: '/game/missions', action: t('Вземи') });
  if (!dailyState(user.loginStreak, user.dailyClaimKey, now).claimedToday) out.push({ emoji: '📅', text: t('Дневната награда не е взета.'), href: '/game#daily', action: t('Вземи') });
  return out.slice(0, 3);
}
