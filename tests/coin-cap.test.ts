import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { COIN_CAP, capWeekStart, coinsAsMoney, moneyForCoins, paidInMoney, rewardCoins, splitByCap, TC_REWARDS } from '@/lib/game/coin-cap';
import { PASS_REWARDS, PASS_REWARDS_CN, PASS_REWARDS_V2 } from '@/lib/game/season-pass';
import { taperCoins } from '@/lib/game/coin-taper';
import { closeDb } from '@/server/db/client';
import { companies, ledgerEntries, notifications, users } from '@/server/db/schema';
import { earnedThisWeek, postCoins } from '@/server/game/coins';
import { post } from '@/server/game/finance';
import { soldToday } from '@/server/game/item-trade';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;
const balance = async (userId: string) => (await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.ownerId, userId)))[0]!.b;

describe('1.3.2.1 „Честна монета“: a weekly cap on earned ТрансКоин', () => {
  it('splits a reward at the cap; the week starts on Monday (Sofia)', () => {
    expect(splitByCap(60, 0)).toEqual({ coins: 60, over: 0 });
    expect(splitByCap(60, 70)).toEqual({ coins: 30, over: 30 });
    expect(splitByCap(10, 150)).toEqual({ coins: 0, over: 10 });
    expect(capWeekStart(new Date('2026-11-25T12:00:00+02:00')).toISOString()).toBe(new Date('2026-11-23T00:00:00+02:00').toISOString());
  });

  it('pays rewards in TC up to the cap and the rest in game money; bought TC never count', async () => {
    const p = await newPlayer();
    const at = new Date();
    // The taper (1.2.6) applies first; a reward of 200 is over the cap either way.
    const tc0 = await coins(p.userId), lv0 = await balance(p.userId);
    await db().transaction((tx) => postCoins(tx, p.userId, { amount: 20, reason: 'purchase', description: 'test', idempotencyKey: `cap-buy:${p.userId}`, at }));
    expect(await coins(p.userId)).toBe(tc0 + 20);
    expect(await earnedThisWeek(db(), p.userId, at)).toBe(0);
    await db().transaction((tx) => postCoins(tx, p.userId, { amount: 200, reason: 'season_pass', description: 'тест', idempotencyKey: `cap-a:${p.userId}`, at }));
    expect(await coins(p.userId)).toBe(tc0 + 20 + COIN_CAP.weekly);
    expect(await earnedThisWeek(db(), p.userId, at)).toBe(COIN_CAP.weekly);
    const lv1 = await balance(p.userId);
    expect(lv1).toBeGreaterThan(lv0);
    expect((lv1 - lv0) % COIN_CAP.centsPerCoin).toBe(0);
    // Over the cap: all in money, and the notice comes once.
    await db().transaction((tx) => postCoins(tx, p.userId, { amount: 50, reason: 'giveaway', description: 'тест', idempotencyKey: `cap-b:${p.userId}`, at }));
    expect(await coins(p.userId)).toBe(tc0 + 20 + COIN_CAP.weekly);
    expect(await balance(p.userId)).toBe(lv1 + taperCoins(50, at, 'giveaway') * COIN_CAP.centsPerCoin);
    expect(await db().select().from(notifications).where(and(eq(notifications.userId, p.userId), like(notifications.title, '%таван%')))).toHaveLength(1);
    expect(await db().select().from(ledgerEntries).where(like(ledgerEntries.idempotencyKey, `cap-%:${p.userId}:over-cap`))).toHaveLength(2);
    // A new week: room again.
    const next = new Date(capWeekStart(at).getTime() + 8 * 86_400_000);
    await db().transaction((tx) => postCoins(tx, p.userId, { amount: 10, reason: 'season_pass', description: 'тест', idempotencyKey: `cap-c:${p.userId}`, at: next }));
    expect(await coins(p.userId)).toBeGreaterThan(tc0 + 20 + COIN_CAP.weekly);
  });

  it('every reward is paid in game money, not TC; only the bought pass line, the team\'s giveaways and a share of a friend\'s purchase keep TC', async () => {
    expect(TC_REWARDS).toEqual(['season_pass', 'giveaway', 'referral_purchase']);
    for (const r of ['daily_reward', 'challenge', 'weekly_goal', 'items', 'item_sale', 'holiday_reward', 'mentor_reward', 'discord_level', 'event_reward', 'league_reward', 'referral_reward', 'email_verified', 'discord_link', 'quiz', 'photo_contest']) expect(paidInMoney(r), r).toBe(true);
    expect(rewardCoins('league_reward', 20)).toBe(coinsAsMoney(20));
    expect(rewardCoins('season_pass', 20)).toBe('20 TC');
    // The free line of the pass gives money, not TC.
    for (const row of [...PASS_REWARDS_V2, ...PASS_REWARDS_CN]) expect(row.free?.coins ?? 0, `free ${row.level}`).toBe(0);
    for (const row of PASS_REWARDS) expect(row.free?.coins ?? 0).toBe(0);
    for (const r of ['purchase', 'promo', 'admin_grant', 'gift_received', ...TC_REWARDS]) expect(paidInMoney(r), r).toBe(false);
    const p = await newPlayer();
    const at = new Date();
    const tc0 = await coins(p.userId), lv0 = await balance(p.userId);
    await db().transaction((tx) => postCoins(tx, p.userId, { amount: 25, reason: 'daily_reward', description: 'Дневна награда', idempotencyKey: `money-a:${p.userId}`, at }));
    expect(await coins(p.userId)).toBe(tc0);
    expect(await balance(p.userId)).toBe(lv0 + moneyForCoins(25));
    expect(await earnedThisWeek(db(), p.userId, at)).toBe(0);
  });
});

describe('1.3.3: item sales paid in money count towards the daily cap', () => {
  it('a sale paid in money (ledger) counts like one paid in TC', async () => {
    const p = await newPlayer();
    const now = new Date();
    expect(await soldToday(db(), p.userId, now)).toBe(0);
    const [acc] = await db().select({ id: companies.id }).from(companies).where(eq(companies.ownerId, p.userId));
    await db().transaction((tx) => post(tx, acc!.id, [{ category: 'bonus', amountCents: moneyForCoins(8), description: 'Продадени: тест', idempotencyKey: `sell:${p.userId}:test:1:money` }]));
    expect(await soldToday(db(), p.userId, now)).toBe(8);
  });
});
