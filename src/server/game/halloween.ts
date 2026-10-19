import { eq } from 'drizzle-orm';
import { BADGES, HALLOWEEN, HALLOWEEN_QUESTS, halloweenEventWindow, isHalloween, questIncrements, type QuestFacts } from '@/lib/game/halloween';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { userBadges } from '@/server/db/schema';
import { postCoins } from './coins';
import { addHolidayProgress, claimHolidayQuest, ensureHolidayEvent, holidayState, HOLIDAY_EVENT_REWARDS, type HolidayDef } from './holiday';

export { hasBadge } from './holiday';

export const HALLOWEEN_DEF: HolidayDef = {
  key: HALLOWEEN.key,
  label: 'Хелуин',
  quests: HALLOWEEN_QUESTS,
  badge: HALLOWEEN.badge,
  href: '/game/halloween',
  allDone: 'Изпълни всички хелуински мисии.',
  isActive: isHalloween,
  eventWindow: halloweenEventWindow,
  eventTemplate: HALLOWEEN.eventTemplate,
  eventName: 'Нощта на тиквите',
  eventDescription: 'Тикви, сладкиши, костюми и фенери трябва да стигнат навреме за празника. Брои се всяка празнична поръчка (с оранжевия етикет „Хелуин“ на борсата). Всички участници печелят, а най-добрите — VIP и ТрансКоин.',
  contractShare: HALLOWEEN.contractShare,
};

/** A finished delivery during Halloween (called from the settlement). */
export async function recordHalloweenDelivery(tx: Tx, userId: string, facts: QuestFacts) {
  const inc = questIncrements(facts);
  for (const [id, n] of Object.entries(inc)) await addHolidayProgress(tx, HALLOWEEN_DEF, userId, id, n);
}

/** The ghost truck appeared on the player's trip: a few ТрансКоин and the quest. */
export async function meetGhostTruck(tx: Tx, userId: string, deliveryId: string) {
  await postCoins(tx, userId, { amount: HALLOWEEN.ghostCoins, reason: 'holiday_reward', description: 'Призрачният камион', idempotencyKey: `delivery:${deliveryId}:ghost` });
  await addHolidayProgress(tx, HALLOWEEN_DEF, userId, 'h_ghost', 1);
}

export async function badgesOf(db: DbOrTx, userId: string) {
  const rows = await db.select().from(userBadges).where(eq(userBadges.userId, userId));
  return rows.filter((r) => BADGES[r.badge]).map((r) => ({ id: r.badge, ...BADGES[r.badge]!, awardedAt: r.awardedAt }));
}

/** The player's Halloween quests with progress, plus the badge. */
export const halloweenState = (db: DbOrTx, userId: string) => holidayState(db, HALLOWEEN_DEF, userId);

/** Takes a quest's reward; the last one also gives the badge. */
export const claimHalloweenQuest = (db: Database, userId: string, questId: string, now = new Date()) => claimHolidayQuest(db, HALLOWEEN_DEF, userId, questId, now);

export const HALLOWEEN_EVENT_REWARDS = HOLIDAY_EVENT_REWARDS;

/** Worker: creates (and announces) the Halloween community event once, during the holiday. */
export const ensureHalloweenEvent = (db: Database, now = new Date()) => ensureHolidayEvent(db, HALLOWEEN_DEF, now);
