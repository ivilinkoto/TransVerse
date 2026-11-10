import { and, eq, isNull, lt } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { vehicles } from '@/server/db/schema';
import { inventoryBadge, weeklyChest } from './item-trade';
import { nextSteps, type NextStep } from './next-steps';
import { winterTrekView } from './winter-trek';
import { mascotView } from './mascot';
import { skillsView } from './skills';
import { featureFor } from '@/server/features';
import { DAILY_ROUTE } from '@/lib/game/daily-route';
import { sofiaDay } from '@/lib/game/shop-v2';
import { jobState } from '@/server/db/schema';
import { t, tx } from '@/i18n/t';

export interface NowItem extends NextStep {
  /** hot = go and earn, gold = take a reward, warn = fix something, info = the rest. */
  tone: 'hot' | 'gold' | 'warn' | 'info';
}

const TONE: Record<string, NowItem['tone']> = { '🚛': 'hot', '🎁': 'gold', '📅': 'gold', '👮': 'warn', '👋': 'info' };

/**
 * 1.2.2 „Сега“: everything the player can do right now, one line and one button
 * each, in the order that matters — the start of the new Начало. Built on
 * „Какво да правя сега?“ plus repairs, cases, presents and the weekly chest.
 */
export async function nowList(db: DbOrTx, user: { id: string; loginStreak: number; dailyClaimKey: string | null; uiPrefs?: { inventorySeenAt?: string } | null }, companyId: string, now: Date, features: { inventory_menu?: boolean; item_chests?: boolean }): Promise<NowItem[]> {
  const steps = await nextSteps(db, user, companyId, now, 10);
  const out: NowItem[] = steps.map((s) => ({ ...s, tone: TONE[s.emoji] ?? 'info' }));
  const worn = await db.select({ id: vehicles.id, plate: vehicles.plate, condition: vehicles.condition }).from(vehicles).where(and(eq(vehicles.companyId, companyId), eq(vehicles.status, 'idle'), isNull(vehicles.soldAt), lt(vehicles.condition, 50))).limit(3);
  for (const v of worn) out.push({ emoji: '🔧', text: t('{0} е на {1}% — ремонтирай го преди следващия курс.', v.plate, Math.round(v.condition)), href: `/game/garage#v-${v.id}`, action: t('Ремонт'), tone: 'warn' });
  if (features.inventory_menu) {
    const inv = await inventoryBadge(db, user.id, user.uiPrefs?.inventorySeenAt, now);
    if (inv.caseReady) out.push({ emoji: '📦', text: t('Имаш неотворен кейс.'), href: '/game/inventory', action: t('Отвори'), tone: 'gold' });
    else if (inv.fresh > 0) out.push({ emoji: '🎒', text: t('Нови неща в инвентара: {0}.', inv.fresh), href: '/game/inventory', action: t('Виж'), tone: 'gold' });
  }
  if (features.item_chests) {
    const w = await weeklyChest(db, user.id, now);
    if (w.tier && !w.claimed && !w.next) out.push({ emoji: '🧰', text: t('Седмичният сандък е готов.'), href: '/game/inventory', action: t('Вземи'), tone: 'gold' });
  }
  // 1.3 „Зимен поход“: today's step while it is not done.
  const trek = await winterTrekView(db, user.id, now);
  const step = trek?.steps.find((s) => s.state === 'current');
  if (step) out.push({ emoji: '❄️', text: t('Зимен поход, стъпка {0}: {1} ({2}/{3}).', step.index + 1, tx(step.label), step.progress, step.target), href: '/game/missions', action: t('Виж'), tone: 'info' });
  // 1.3 „Талисман“: an invitation to take one, or a sad one waiting for a trip.
  if (await featureFor(db, user.id, 'mascot', now)) {
    const pet = await mascotView(db, user.id, now);
    if (!pet) out.push({ emoji: '🐾', text: t('Вземи си талисман за кабината — расте с курсовете и носи бонус.'), href: '/game/mascot', action: t('Избери'), tone: 'info' });
    else if (pet.sad) out.push({ emoji: '🐾', text: t('{0} е тъжен — един курс ще го зарадва.', tx(pet.name)), href: '/game/mascot', action: t('Виж'), tone: 'warn' });
  }
  // 1.3 „Умения на шофьора“: free points waiting.
  if (await featureFor(db, user.id, 'driver_skills', now)) {
    const sk = await skillsView(db, user.id);
    if (sk.free > 0) out.push({ emoji: '🌳', text: t('Имаш {0} свободни точки за умения.', sk.free), href: '/game/skills', action: t('Научи'), tone: 'gold' });
  }
  // 1.3 „Пътят на деня“: today's puzzle while it is not finished.
  if (await featureFor(db, user.id, 'daily_route', now)) {
    const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, `daily-route:${sofiaDay(now)}:${user.id}`));
    const tries = (row?.value as { tries: { pct: number }[] } | undefined)?.tries ?? [];
    if (tries.length < DAILY_ROUTE.tries && !tries.some((x) => x.pct >= 100)) out.push({ emoji: '🧭', text: tries.length ? t('Пътят на деня: остават {0} опита.', DAILY_ROUTE.tries - tries.length) : t('Нов „Път на деня“ — подреди 6 града в най-краткия път.'), href: '/game/daily-route', action: t('Играй'), tone: 'info' });
  }
  const order: NowItem['tone'][] = ['hot', 'gold', 'warn', 'info'];
  return out.sort((a, b) => order.indexOf(a.tone) - order.indexOf(b.tone)).slice(0, 6);
}
