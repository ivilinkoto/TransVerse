import { and, eq, gt, inArray, like, sql } from 'drizzle-orm';
import { autoTarget, DEFAULT_REWARDS, type EventRewards } from '@/lib/game/events';
import { BADGES, QUEST_BADGE_COINS, type HalloweenQuest } from '@/lib/game/halloween';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { deliveries, globalEvents, seasonalQuests, userBadges } from '@/server/db/schema';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { announce } from './events';
import { post } from './finance';
import { notify } from './notify';

/**
 * What every holiday (Halloween, Christmas) shares: quests with progress and
 * rewards, a badge for all of them, and a community event created once by
 * the worker. Each holiday describes itself with a HolidayDef.
 */
export interface HolidayDef {
  /** Prefix of quest keys and of reward idempotency keys, e.g. 'halloween-2026'. */
  key: string;
  /** Short name in ledger descriptions ("Хелуин", "Коледа"). */
  label: string;
  quests: HalloweenQuest[];
  badge: string;
  /** The holiday's page (notification link). */
  href: string;
  /** Text of the "all quests" notification. */
  allDone: string;
  /** Content dates (Sofia) and the community event. */
  isActive: (now: Date) => boolean;
  eventWindow: () => { startsAt: Date; endsAt: Date };
  eventTemplate: string;
  eventName: string;
  eventDescription: string;
  contractShare: number;
}

const questKey = (def: HolidayDef, id: string) => `${def.key}:${id}`;

/** Adds to a quest, never beyond its target (claimed quests no longer move). */
export async function addHolidayProgress(tx: Tx, def: HolidayDef, userId: string, questId: string, inc: number) {
  const quest = def.quests.find((q) => q.id === questId);
  if (!quest || inc <= 0) return;
  await tx
    .insert(seasonalQuests)
    .values({ userId, quest: questKey(def, questId), progress: Math.min(quest.target, inc) })
    .onConflictDoUpdate({
      target: [seasonalQuests.userId, seasonalQuests.quest],
      set: { progress: sql`least(${quest.target}, ${seasonalQuests.progress} + ${inc})`, updatedAt: new Date() },
      setWhere: sql`${seasonalQuests.claimedAt} is null`,
    });
}

export async function hasBadge(db: DbOrTx, userId: string, badge: string) {
  const [row] = await db.select({ badge: userBadges.badge }).from(userBadges).where(and(eq(userBadges.userId, userId), eq(userBadges.badge, badge)));
  return !!row;
}

/** The player's quests of a holiday with progress, plus the badge. */
export async function holidayState(db: DbOrTx, def: HolidayDef, userId: string) {
  const rows = await db.select().from(seasonalQuests).where(and(eq(seasonalQuests.userId, userId), like(seasonalQuests.quest, `${def.key}:%`)));
  const quests = def.quests.map((q) => {
    const r = rows.find((x) => x.quest === questKey(def, q.id));
    return { ...q, progress: r?.progress ?? 0, claimed: !!r?.claimedAt, done: (r?.progress ?? 0) >= q.target };
  });
  return { quests, badge: await hasBadge(db, userId, def.badge) };
}

/** Takes a quest's reward (up to a week after the event); the last one also gives the badge. */
export async function claimHolidayQuest(db: Database, def: HolidayDef, userId: string, questId: string, now = new Date()) {
  const quest = def.quests.find((q) => q.id === questId);
  if (!quest) fail('unknown_quest', 'Непозната мисия.');
  if (now.getTime() > def.eventWindow().endsAt.getTime() + 7 * 86_400_000 && !def.isActive(now)) fail('season_over', `Мисиите за ${def.label} приключиха.`);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(seasonalQuests).where(and(eq(seasonalQuests.userId, userId), eq(seasonalQuests.quest, questKey(def, quest!.id)))).for('update');
    if (!row || row.progress < quest!.target) fail('not_done', 'Мисията още не е изпълнена.');
    if (row!.claimedAt) fail('already_claimed', 'Наградата вече е взета.');
    await tx.update(seasonalQuests).set({ claimedAt: now }).where(and(eq(seasonalQuests.userId, userId), eq(seasonalQuests.quest, row!.quest)));
    const key = `holiday:${def.key}:${userId}:${quest!.id}`;
    if (quest!.coins) await postCoins(tx, userId, { amount: quest!.coins, reason: 'holiday_reward', description: `${def.label}: ${quest!.title}`, idempotencyKey: `${key}:coins` });
    if (quest!.cents) {
      const account = await companyForUser(tx, userId);
      await post(tx, account.id, [{ category: 'holiday_reward', amountCents: quest!.cents, description: `${def.label}: ${quest!.title}`, idempotencyKey: `${key}:money` }]);
    }
    const claimed = await tx
      .select({ quest: seasonalQuests.quest })
      .from(seasonalQuests)
      .where(and(eq(seasonalQuests.userId, userId), inArray(seasonalQuests.quest, def.quests.map((q) => questKey(def, q.id))), sql`${seasonalQuests.claimedAt} is not null`));
    let badge = false;
    if (claimed.length === def.quests.length) {
      const inserted = await tx.insert(userBadges).values({ userId, badge: def.badge }).onConflictDoNothing().returning();
      if (inserted.length) {
        badge = true;
        await postCoins(tx, userId, { amount: QUEST_BADGE_COINS, reason: 'holiday_reward', description: `Значка „${BADGES[def.badge]!.label}“`, idempotencyKey: `holiday:${def.key}:${userId}:badge` });
        await notify(tx, userId, 'achievement', `Значка „${BADGES[def.badge]!.label}“`, `${def.allDone} +${QUEST_BADGE_COINS} TC и значка завинаги в профила ти.`, def.href);
      }
    }
    return { badge };
  });
}

/** The holiday rewards: a bigger share for everyone and ТрансКоин for the top places. */
export const HOLIDAY_EVENT_REWARDS: EventRewards = {
  participant: { cents: 2_000_00, xp: 400, coins: 20 },
  top: DEFAULT_REWARDS.top.map((r) => ({ ...r, coins: r.coins + 50 })),
};

/** Worker: creates (and announces) a holiday's community event once, during the holiday. */
export async function ensureHolidayEvent(db: Database, def: HolidayDef, now = new Date()) {
  const window = def.eventWindow();
  if (!def.isActive(now) || now >= window.endsAt) return null;
  const [existing] = await db.select({ id: globalEvents.id }).from(globalEvents).where(eq(globalEvents.template, def.eventTemplate)).limit(1);
  if (existing) return null;
  // Target from the recent pace: about the share of holiday loads among last week's deliveries.
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(deliveries).where(and(eq(deliveries.status, 'completed'), gt(deliveries.completedAt, new Date(now.getTime() - 7 * 86_400_000))));
  const hours = (window.endsAt.getTime() - Math.max(now.getTime(), window.startsAt.getTime())) / 3_600_000;
  const target = autoTarget('holiday', n * def.contractShare, 7 * 24, hours);
  return db.transaction(async (tx) => {
    const [e] = await tx
      .insert(globalEvents)
      .values({
        name: def.eventName,
        description: def.eventDescription,
        metric: 'holiday',
        cargoType: null,
        countryCode: null,
        target,
        minContribution: 1,
        rewards: HOLIDAY_EVENT_REWARDS,
        startsAt: window.startsAt < now ? now : window.startsAt,
        endsAt: window.endsAt,
        template: def.eventTemplate,
      })
      .returning();
    await announce(tx, e!, now);
    return e!;
  });
}
