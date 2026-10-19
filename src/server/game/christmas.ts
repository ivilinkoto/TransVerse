import { CHRISTMAS, CHRISTMAS_QUESTS, christmasEventWindow, christmasIncrements, isChristmas } from '@/lib/game/christmas';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { addHolidayProgress, claimHolidayQuest, ensureHolidayEvent, holidayState, type HolidayDef } from './holiday';

export const CHRISTMAS_DEF: HolidayDef = {
  key: CHRISTMAS.key,
  label: 'Коледа',
  quests: CHRISTMAS_QUESTS,
  badge: CHRISTMAS.badge,
  href: '/game/christmas',
  allDone: 'Изпълни всички коледни мисии.',
  isActive: isChristmas,
  eventWindow: christmasEventWindow,
  eventTemplate: CHRISTMAS.eventTemplate,
  eventName: 'Коледна треска',
  eventDescription: 'Подаръци, елхи, козунаци и мандарини трябва да стигнат до Бъдни вечер. Брои се всяка коледна поръчка (с червения етикет „Коледа“ на борсата). Всички участници печелят, а най-добрите — VIP и ТрансКоин.',
  contractShare: CHRISTMAS.contractShare,
};

/** A finished delivery during Christmas (called from the settlement). */
export async function recordChristmasDelivery(tx: Tx, userId: string, facts: { holiday: boolean; loadedKm: number; arrivedAt: Date }) {
  for (const [id, n] of Object.entries(christmasIncrements(facts))) await addHolidayProgress(tx, CHRISTMAS_DEF, userId, id, n);
}

/** The player helped someone on the road during Christmas. */
export async function recordChristmasHelp(tx: Tx, userId: string, now: Date) {
  if (isChristmas(now)) await addHolidayProgress(tx, CHRISTMAS_DEF, userId, 'c_help', 1);
}

export const christmasState = (db: DbOrTx, userId: string) => holidayState(db, CHRISTMAS_DEF, userId);
export const claimChristmasQuest = (db: Database, userId: string, questId: string, now = new Date()) => claimHolidayQuest(db, CHRISTMAS_DEF, userId, questId, now);
export const ensureChristmasEvent = (db: Database, now = new Date()) => ensureHolidayEvent(db, CHRISTMAS_DEF, now);
