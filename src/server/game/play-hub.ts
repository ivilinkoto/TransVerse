/**
 * What the reward and game pages show on top: rewards waiting to be taken and what runs now.
 * Used by „Игри и награди“ (1.3.2) and by the older „Награди“ and „Състезание“ pages.
 */
import { and, eq, sql } from 'drizzle-orm';
import { dailyState } from '@/lib/game/daily';
import { isPrewinter, PREWINTER } from '@/lib/game/prewinter';
import { WEEKLY_LANE } from '@/lib/game/weekly-lane';
import { dateTime, int } from '@/lib/format';
import { achievements } from '@/server/db/schema';
import type { gameContext } from './context';
import { claimableCount } from './missions';
import { passView } from './season-pass';
import { inventoryBadge, weeklyChest } from './item-trade';
import { runningEvents } from './events';
import { bigRunOf, bigRunProgress } from './big-run';
import { currentBattle } from './battles';
import { membershipOf } from './membership';
import { monthCardOf, vipCaseReady } from './shop-v2';
import { weeklyLaneView } from './weekly-lane';
import { prewinterGoal, prewinterLoadsOf } from './prewinter';
import { t, tx } from '@/i18n/t';

export interface HubLink { href: string; emoji: string; title: string; text: string }

type Ctx = Pick<Awaited<ReturnType<typeof gameContext>>, 'db' | 'user' | 'now' | 'features'>;

/** Rewards that wait to be taken, one link each. */
export async function rewardsToTake({ db, user, now, features }: Ctx) {
  const [missions, pass, inv, week] = await Promise.all([
    claimableCount(db, user.id),
    features.truck_pass ? passView(db, user.id, now) : null,
    features.inventory_menu ? inventoryBadge(db, user.id, user.uiPrefs?.inventorySeenAt, now) : null,
    features.item_chests ? weeklyChest(db, user.id, now) : null,
  ]);
  const take: { href: string; emoji: string; text: string }[] = [];
  if (!dailyState(user.loginStreak, user.dailyClaimKey, now).claimedToday) take.push({ href: '/game#daily', emoji: '📅', text: t('Дневната награда') });
  if (missions > 0) take.push({ href: '/game/missions', emoji: '🎯', text: t('Мисии: {0} награди', missions) });
  if (pass?.claimable) take.push({ href: '/game/seasons', emoji: '🎟️', text: t('Truck Pass: {0} нива', pass.claimable) });
  if (inv?.caseReady) take.push({ href: '/game/inventory', emoji: '📦', text: t('Неотворен кейс') });
  if (week?.tier && !week.claimed) take.push({ href: '/game/inventory', emoji: '🧰', text: t('Седмичен сандък: {0}', week.trips) });
  // 1.2.3: the weekly VIP case and the ТрансКоин of the monthly card.
  if (features.shop_v2) {
    const [vipCase, card] = await Promise.all([vipCaseReady(db, user.id, user.vipUntil, now), monthCardOf(db, user.id, now)]);
    if (vipCase) take.push({ href: '/game/shop', emoji: '👑', text: t('VIP кейс на седмицата') });
    if (card.ready) take.push({ href: '/game/shop', emoji: '💳', text: t('Месечна карта: {0} TC за днес', card.coinsPerDay) });
  }
  return { take, missions, pass, inv };
}

/** What runs now: events, the Big Run, the company's battle, the contract of the week, the server goal. */
export async function liveNow({ db, user, now, features }: Ctx) {
  const m = await membershipOf(db, user.id);
  const [events, run, battle, [{ done = 0 } = {}]] = await Promise.all([
    runningEvents(db, user.id, now),
    features.big_run ? bigRunOf(db, now) : null,
    m ? currentBattle(db, m.company.id, now) : null,
    db.select({ done: sql<number>`count(*)::int` }).from(achievements).where(and(eq(achievements.userId, user.id))),
  ]);
  const runDone = run ? (await bigRunProgress(db, user.id, run)).filter(Boolean).length : 0;
  const live: HubLink[] = [];
  const running = events.filter((x) => x.event.startsAt <= now && x.event.endsAt > now);
  for (const e of running) live.push({ href: '/game/events', emoji: '🎯', title: tx(e.event.name), text: t('до {0}', dateTime(e.event.endsAt)) });
  if (run && run.legs.length) live.push({ href: '/game/big-run', emoji: '🏁', title: t('Голям рейс'), text: t('етап {0} от {1}', Math.min(runDone + 1, run.legs.length), run.legs.length) });
  if (battle && battle.status === 'active' && battle.rival) live.push({ href: '/game/company/missions', emoji: '⚔️', title: t('Битка срещу „{0}“', battle.rival.name), text: t('{0} : {1} т', Math.round(battle.ourTons), Math.round(battle.theirTons)) });
  // 1.2.3: the contract of the week.
  const lane = features.weekly_lane ? await weeklyLaneView(db, user.id, now) : null;
  if (lane?.origin && lane.dest) live.push({ href: `/game/contracts?q=${encodeURIComponent(lane.dest.name)}`, emoji: '🏁', title: t('Договор на седмицата: {0} → {1}', tx(lane.origin.name), tx(lane.dest.name)), text: lane.mine ? t('Ти си сред победителите!') : t('+30% · места: {0} от {1}', Math.max(0, WEEKLY_LANE.winners - lane.taken), WEEKLY_LANE.winners) });
  // 1.2.4: the server goal before winter.
  if (features.winter_prep && isPrewinter(now)) {
    const g = await prewinterGoal(db, now);
    const mine = await prewinterLoadsOf(db, user.id, now);
    live.push({ href: '/game/contracts', emoji: '🧂', title: t('Зареди за зимата: {0} от {1} т', int(g.tons), int(g.goal)), text: g.reached ? t('Целта е изпълнена — от 1 до 7 декември +5% на всеки товар!') : t('Твоите зимни товари навреме: {0} от {1} за значката', Math.min(mine, PREWINTER.loadsForBadge), PREWINTER.loadsForBadge) });
  }
  return { live, running, run, runDone, achievementsDone: Number(done) };
}
