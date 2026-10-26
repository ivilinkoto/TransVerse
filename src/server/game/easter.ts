import { and, eq, or, sql } from 'drizzle-orm';
import { EASTER, EASTER_QUESTS, easterEventWindow, easterIncrements, isEaster } from '@/lib/game/easter';
import { BADGES } from '@/lib/game/halloween';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { eggFights, friendships, userBadges, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { fail } from './errors';
import { addHolidayProgress, claimHolidayQuest, ensureHolidayEvent, holidayState, type HolidayDef } from './holiday';
import { notify } from './notify';
import { rand } from './random';
import { t } from '@/i18n/t';

export const EASTER_DEF: HolidayDef = {
  key: EASTER.key,
  label: 'Великден',
  quests: EASTER_QUESTS,
  badge: EASTER.badge,
  href: '/game/easter',
  allDone: 'Изпълни всички великденски мисии.',
  isActive: isEaster,
  eventWindow: easterEventWindow,
  eventTemplate: EASTER.eventTemplate,
  eventName: 'Великденски рейс',
  eventDescription: 'Козунаци, яйца и празнична трапеза трябва да стигнат навсякъде до Великден. Брои се всеки великденски товар (етикет „Великден“). Всички участници печелят, а най-добрите — VIP и ТрансКоин.',
  contractShare: EASTER.contractShare,
};

export async function recordEasterDelivery(tx: Tx, userId: string, facts: { holiday: boolean; loadedKm: number; arrivedAt: Date }) {
  for (const [id, n] of Object.entries(easterIncrements(facts))) await addHolidayProgress(tx, EASTER_DEF, userId, id, n);
}

export const easterState = (db: DbOrTx, userId: string) => holidayState(db, EASTER_DEF, userId);
export const claimEasterQuest = (db: Database, userId: string, questId: string, now = new Date()) => claimHolidayQuest(db, EASTER_DEF, userId, questId, now);
export const ensureEasterEvent = (db: Database, now = new Date()) => ensureHolidayEvent(db, EASTER_DEF, now);

/**
 * An egg fight with a friend (once per pair a year): the stronger egg is
 * random. Nothing is staked; the winner gets ТрансКоин from the game, and
 * the badge "Най-здравото яйце" after five wins.
 */
export async function eggFight(db: Database, userId: string, friendId: string, now = new Date(), random = rand) {
  if (!(await featureFor(db, userId, 'easter', now))) fail('not_released', t('Това идва със следващото обновление.'), 403);
  if (!isEaster(now)) fail('not_in_season', t('Яйчените битки са около Великден.'));
  if (friendId === userId) fail('self', t('Чукни се с приятел.'));
  return db.transaction(async (tx) => {
    const [f] = await tx.select({ id: friendships.id }).from(friendships).where(and(eq(friendships.status, 'accepted'), or(and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, friendId)), and(eq(friendships.requesterId, friendId), eq(friendships.addresseeId, userId)))));
    if (!f) fail('not_friends', t('Яйчена битка — само с приятел.'));
    const winnerId = random() < 0.5 ? userId : friendId;
    const [low, high] = [userId, friendId].sort();
    const [row] = await tx.insert(eggFights).values({ userA: low!, userB: high!, year: EASTER.year, winnerId, createdAt: now }).onConflictDoNothing().returning();
    if (!row) fail('already', t('Вече се чукнахте тази година.'), 409);
    await postCoins(tx, winnerId, { amount: EASTER.eggCoins, reason: 'holiday_reward', description: t('Спечелена яйчена битка'), idempotencyKey: `egg:${row!.id}` });
    await addHolidayProgress(tx, EASTER_DEF, winnerId, 'e_egg', 1);
    const [{ wins } = { wins: 0 }] = await tx.select({ wins: sql<number>`count(*)::int` }).from(eggFights).where(eq(eggFights.winnerId, winnerId));
    if (wins >= EASTER.eggBadgeWins) await tx.insert(userBadges).values({ userId: winnerId, badge: EASTER.eggBadge }).onConflictDoNothing();
    const names = await tx.select({ id: users.id, username: users.username }).from(users).where(or(eq(users.id, userId), eq(users.id, friendId)));
    const name = (id: string) => names.find((n) => n.id === id)?.username ?? '';
    const loser = winnerId === userId ? friendId : userId;
    await notify(tx, winnerId, 'success', () => t('Твоето яйце издържа! 🥚'), () => t('Спечели яйчената битка с {0} — +{1} TC. Христос воскресе!', name(loser), EASTER.eggCoins), '/game/easter');
    await notify(tx, loser, 'info', () => t('{0} спечели яйчената битка 🥚', name(winnerId)), () => t('Догодина ще е твоят ред. Христос воскресе!'), '/game/easter');
    return { won: winnerId === userId, badge: BADGES[EASTER.eggBadge]?.label };
  });
}
