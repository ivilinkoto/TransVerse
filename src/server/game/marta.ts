import { and, eq, or } from 'drizzle-orm';
import { isMarta, MARTA, MARTA_QUESTS, martaEventWindow, martaIncrements } from '@/lib/game/marta';
import { seededRandom } from '@/lib/game/road-events';
import { sofiaDate } from '@/lib/game/together';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, cityMarkets, friendships, martenitsas, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { fail } from './errors';
import { addHolidayProgress, claimHolidayQuest, ensureHolidayEvent, holidayState, type HolidayDef } from './holiday';
import { notify } from './notify';

export const MARTA_DEF: HolidayDef = {
  key: MARTA.key,
  label: 'Баба Марта',
  quests: MARTA_QUESTS,
  badge: MARTA.badge,
  href: '/game/marta',
  allDone: 'Изпълни всички мисии на Баба Марта.',
  isActive: isMarta,
  eventWindow: martaEventWindow,
  eventTemplate: MARTA.eventTemplate,
  eventName: 'Пролетта идва',
  eventDescription: 'Мартенички, цветя и разсад трябва да стигнат навсякъде до 8 март. Брои се всеки пролетен товар (с етикета „Баба Марта“ на борсата). Всички участници печелят, а най-добрите — VIP и ТрансКоин.',
  contractShare: MARTA.contractShare,
};

export async function recordMartaDelivery(tx: Tx, userId: string, facts: { holiday: boolean; loadedKm: number }) {
  for (const [id, n] of Object.entries(martaIncrements(facts))) await addHolidayProgress(tx, MARTA_DEF, userId, id, n);
}

export const martaState = (db: DbOrTx, userId: string) => holidayState(db, MARTA_DEF, userId);
export const claimMartaQuest = (db: Database, userId: string, questId: string, now = new Date()) => claimHolidayQuest(db, MARTA_DEF, userId, questId, now);
export const ensureMartaEvent = (db: Database, now = new Date()) => ensureHolidayEvent(db, MARTA_DEF, now);

async function released(db: DbOrTx, userId: string, now: Date) {
  if (!(await featureFor(db, userId, 'marta', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  if (!isMarta(now)) fail('not_in_season', 'Баба Марта е от 1 до 31 март.');
}

/** A martenitsa for a friend: once per friend a year; it counts for the quest. */
export async function giveMartenitsa(db: Database, userId: string, friendId: string, now = new Date()) {
  await released(db, userId, now);
  if (friendId === userId) fail('self', 'Мартеничката е за приятел.');
  return db.transaction(async (tx) => {
    const [f] = await tx.select({ id: friendships.id }).from(friendships).where(and(eq(friendships.status, 'accepted'), or(and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, friendId)), and(eq(friendships.requesterId, friendId), eq(friendships.addresseeId, userId)))));
    if (!f) fail('not_friends', 'Мартеничка се подарява на приятел.');
    const [row] = await tx.insert(martenitsas).values({ fromUserId: userId, toUserId: friendId, year: MARTA.year, createdAt: now }).onConflictDoNothing().returning();
    if (!row) fail('already_given', 'Вече си му подарил мартеничка тази година.', 409);
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    await addHolidayProgress(tx, MARTA_DEF, userId, 'm_gift', 1);
    await notify(tx, friendId, 'success', `${me!.username} ти върза мартеничка 🔴⚪`, 'Честита Баба Марта! Бъди здрав и пътувай спокойно.', '/game/marta');
    return row;
  });
}

/** Martenitsas the player got this year (shown on their page). */
export async function martenitsasOf(db: DbOrTx, userId: string) {
  return db.select({ from: users.username, at: martenitsas.createdAt }).from(martenitsas).innerJoin(users, eq(users.id, martenitsas.fromUserId)).where(and(eq(martenitsas.toUserId, userId), eq(martenitsas.year, MARTA.year)));
}

/** The stork of the day: a real city of the market, the same for everyone (by the date). */
export async function storkOfDay(db: DbOrTx, now: Date) {
  const day = sofiaDate(now);
  const hubs = await db.selectDistinct({ id: cities.id, name: cities.nameBg, lat: cities.lat, lon: cities.lon }).from(cityMarkets).innerJoin(cities, eq(cities.id, cityMarkets.cityId)).orderBy(cities.id);
  if (!hubs.length) return null;
  const r = seededRandom(`stork:${day}`)();
  return { ...hubs[Math.floor(r * hubs.length)]!, day };
}

/** The player spotted the stork on the map: ТрансКоин once a day and the quest. */
export async function spotStork(db: Database, userId: string, now = new Date()) {
  await released(db, userId, now);
  const stork = await storkOfDay(db, now);
  if (!stork) fail('no_stork', 'Щъркелът още не е долетял.');
  return db.transaction(async (tx) => {
    const fresh = await postCoins(tx, userId, { amount: MARTA.storkCoins, reason: 'holiday_reward', description: `Щъркел над ${stork!.name}`, idempotencyKey: `stork:${userId}:${stork!.day}` });
    if (!fresh) fail('already_spotted', 'Днешния щъркел вече го видя — утре ще е над друг град.', 409);
    await addHolidayProgress(tx, MARTA_DEF, userId, 'm_stork', 1);
    return { city: stork!.name, coins: MARTA.storkCoins };
  });
}

