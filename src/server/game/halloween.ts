import { and, eq, gt, inArray, like, sql } from 'drizzle-orm';
import { autoTarget, DEFAULT_REWARDS, type EventRewards } from '@/lib/game/events';
import { BADGES, HALLOWEEN, HALLOWEEN_QUESTS, QUEST_BADGE_COINS, halloweenEventWindow, isHalloween, questIncrements, type QuestFacts } from '@/lib/game/halloween';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { deliveries, globalEvents, seasonalQuests, userBadges } from '@/server/db/schema';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { announce } from './events';
import { post } from './finance';
import { notify } from './notify';

const questKey = (id: string) => `${HALLOWEEN.key}:${id}`;

/** Adds to a quest, never beyond its target (claimed quests no longer move). */
async function addQuestProgress(tx: Tx, userId: string, questId: string, inc: number) {
  const quest = HALLOWEEN_QUESTS.find((q) => q.id === questId);
  if (!quest || inc <= 0) return;
  await tx
    .insert(seasonalQuests)
    .values({ userId, quest: questKey(questId), progress: Math.min(quest.target, inc) })
    .onConflictDoUpdate({
      target: [seasonalQuests.userId, seasonalQuests.quest],
      set: { progress: sql`least(${quest.target}, ${seasonalQuests.progress} + ${inc})`, updatedAt: new Date() },
      setWhere: sql`${seasonalQuests.claimedAt} is null`,
    });
}

/** A finished delivery during Halloween (called from the settlement). */
export async function recordHalloweenDelivery(tx: Tx, userId: string, facts: QuestFacts) {
  const inc = questIncrements(facts);
  for (const [id, n] of Object.entries(inc)) await addQuestProgress(tx, userId, id, n);
}

/** The ghost truck appeared on the player's trip: a few ТрансКоин and the quest. */
export async function meetGhostTruck(tx: Tx, userId: string, deliveryId: string) {
  await postCoins(tx, userId, { amount: HALLOWEEN.ghostCoins, reason: 'holiday_reward', description: 'Призрачният камион', idempotencyKey: `delivery:${deliveryId}:ghost` });
  await addQuestProgress(tx, userId, 'h_ghost', 1);
}

export async function hasBadge(db: DbOrTx, userId: string, badge: string) {
  const [row] = await db.select({ badge: userBadges.badge }).from(userBadges).where(and(eq(userBadges.userId, userId), eq(userBadges.badge, badge)));
  return !!row;
}

export async function badgesOf(db: DbOrTx, userId: string) {
  const rows = await db.select().from(userBadges).where(eq(userBadges.userId, userId));
  return rows.filter((r) => BADGES[r.badge]).map((r) => ({ id: r.badge, ...BADGES[r.badge]!, awardedAt: r.awardedAt }));
}

/** The player's Halloween quests with progress, plus the badge. */
export async function halloweenState(db: DbOrTx, userId: string) {
  const rows = await db.select().from(seasonalQuests).where(and(eq(seasonalQuests.userId, userId), like(seasonalQuests.quest, `${HALLOWEEN.key}:%`)));
  const quests = HALLOWEEN_QUESTS.map((q) => {
    const r = rows.find((x) => x.quest === questKey(q.id));
    return { ...q, progress: r?.progress ?? 0, claimed: !!r?.claimedAt, done: (r?.progress ?? 0) >= q.target };
  });
  return { quests, badge: await hasBadge(db, userId, HALLOWEEN.badge) };
}

/** Takes a quest's reward; the last one also gives the badge. */
export async function claimHalloweenQuest(db: Database, userId: string, questId: string, now = new Date()) {
  const quest = HALLOWEEN_QUESTS.find((q) => q.id === questId);
  if (!quest) fail('unknown_quest', 'Непозната мисия.');
  // Rewards can be taken a few days after the holiday too.
  if (now.getTime() > halloweenEventWindow().endsAt.getTime() + 7 * 86_400_000) fail('season_over', 'Хелуинските мисии приключиха.');
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(seasonalQuests).where(and(eq(seasonalQuests.userId, userId), eq(seasonalQuests.quest, questKey(quest!.id)))).for('update');
    if (!row || row.progress < quest!.target) fail('not_done', 'Мисията още не е изпълнена.');
    if (row!.claimedAt) fail('already_claimed', 'Наградата вече е взета.');
    await tx.update(seasonalQuests).set({ claimedAt: now }).where(and(eq(seasonalQuests.userId, userId), eq(seasonalQuests.quest, row!.quest)));
    const key = `holiday:${HALLOWEEN.key}:${userId}:${quest!.id}`;
    if (quest!.coins) await postCoins(tx, userId, { amount: quest!.coins, reason: 'holiday_reward', description: `Хелуин: ${quest!.title}`, idempotencyKey: `${key}:coins` });
    if (quest!.cents) {
      const account = await companyForUser(tx, userId);
      await post(tx, account.id, [{ category: 'holiday_reward', amountCents: quest!.cents, description: `Хелуин: ${quest!.title}`, idempotencyKey: `${key}:money` }]);
    }
    const claimed = await tx
      .select({ quest: seasonalQuests.quest })
      .from(seasonalQuests)
      .where(and(eq(seasonalQuests.userId, userId), inArray(seasonalQuests.quest, HALLOWEEN_QUESTS.map((q) => questKey(q.id))), sql`${seasonalQuests.claimedAt} is not null`));
    let badge = false;
    if (claimed.length === HALLOWEEN_QUESTS.length) {
      const inserted = await tx.insert(userBadges).values({ userId, badge: HALLOWEEN.badge }).onConflictDoNothing().returning();
      if (inserted.length) {
        badge = true;
        await postCoins(tx, userId, { amount: QUEST_BADGE_COINS, reason: 'holiday_reward', description: `Значка „${BADGES[HALLOWEEN.badge]!.label}“`, idempotencyKey: `holiday:${HALLOWEEN.key}:${userId}:badge` });
        await notify(tx, userId, 'achievement', `Значка „${BADGES[HALLOWEEN.badge]!.label}“`, `Изпълни всички хелуински мисии. +${QUEST_BADGE_COINS} TC и значка завинаги в профила ти.`, '/game/halloween');
      }
    }
    return { badge };
  });
}

/** The holiday rewards: a bigger share for everyone and ТрансКоин for the top places. */
export const HALLOWEEN_EVENT_REWARDS: EventRewards = {
  participant: { cents: 2_000_00, xp: 400, coins: 20 },
  top: DEFAULT_REWARDS.top.map((r) => ({ ...r, coins: r.coins + 50 })),
};

/** Worker: creates (and announces) the Halloween community event once, during the holiday. */
export async function ensureHalloweenEvent(db: Database, now = new Date()) {
  const window = halloweenEventWindow();
  if (!isHalloween(now) || now >= window.endsAt) return null;
  const [existing] = await db.select({ id: globalEvents.id }).from(globalEvents).where(eq(globalEvents.template, HALLOWEEN.eventTemplate)).limit(1);
  if (existing) return null;
  // Target from the recent pace: about the share of holiday loads among last week's deliveries.
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(deliveries).where(and(eq(deliveries.status, 'completed'), gt(deliveries.completedAt, new Date(now.getTime() - 7 * 86_400_000))));
  const hours = (window.endsAt.getTime() - Math.max(now.getTime(), window.startsAt.getTime())) / 3_600_000;
  const target = autoTarget('holiday', n * HALLOWEEN.contractShare, 7 * 24, hours);
  return db.transaction(async (tx) => {
    const [e] = await tx
      .insert(globalEvents)
      .values({
        name: 'Нощта на тиквите',
        description: 'Тикви, сладкиши, костюми и фенери трябва да стигнат навреме за празника. Брои се всяка празнична поръчка (с оранжевия етикет „Хелуин“ на борсата). Всички участници печелят, а най-добрите — VIP и ТрансКоин.',
        metric: 'holiday',
        cargoType: null,
        countryCode: null,
        target,
        minContribution: 1,
        rewards: HALLOWEEN_EVENT_REWARDS,
        startsAt: window.startsAt < now ? now : window.startsAt,
        endsAt: window.endsAt,
        template: HALLOWEEN.eventTemplate,
      })
      .returning();
    await announce(tx, e!, now);
    return e!;
  });
}
