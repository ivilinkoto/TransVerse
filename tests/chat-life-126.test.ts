import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// The features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { CHAT_LIFE, DAILY_QUESTIONS, questionFor } from '@/lib/game/chat-life';
import { coinTaperFactor, taperCoins } from '@/lib/game/coin-taper';
import { closeDb } from '@/server/db/client';
import { chatMessages, jobState, users } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { botUserId, postDailyQuestion, postGameLine, postMoment, thankHelper } from '@/server/game/chat-life';
import { postToChannel } from '@/server/game/messages';
import { passView } from '@/server/game/season-pass';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());
const nameOf = async (id: string) => (await db().select({ username: users.username }).from(users).where(eq(users.id, id)))[0]!.username;
const coins = async (id: string) => (await db().select({ coins: users.coins }).from(users).where(eq(users.id, id)))[0]!.coins;

describe('1.2.6 coin taper', () => {
  it('steps by date; bought, gifted and promo coins are never touched', () => {
    expect(coinTaperFactor(new Date('2026-11-19T12:00:00+02:00'))).toBe(1);
    expect(coinTaperFactor(new Date('2026-11-20T10:30:00+02:00'))).toBe(0.85);
    expect(coinTaperFactor(new Date('2026-12-05T12:00:00+02:00'))).toBe(0.7);
    expect(coinTaperFactor(new Date('2027-02-01T12:00:00+02:00'))).toBe(0.6);
    const jan = new Date('2027-01-10T12:00:00+02:00');
    expect(taperCoins(100, jan)).toBe(60);
    expect(taperCoins(1, jan)).toBe(1);
    expect(taperCoins(100, jan, 'purchase')).toBe(100);
    expect(taperCoins(100, jan, 'promo')).toBe(100);
    expect(taperCoins(-50, jan)).toBe(-50);
  });

  it('postCoins pays the tapered reward when the moment is given', async () => {
    const p = await newPlayer();
    const before = await coins(p.userId);
    await db().transaction((tx) => postCoins(tx, p.userId, { amount: 100, reason: 'daily_reward', description: 'test', idempotencyKey: `taper-test:${p.userId}`, at: new Date('2026-12-05T12:00:00+02:00') }));
    expect((await coins(p.userId)) - before).toBe(70);
  });
});

describe('1.2.6 the game in the chat', () => {
  it('the question of the day: once a day from 19:00, the first answers get pass points', async () => {
    expect(DAILY_QUESTIONS).toContain(questionFor('2031-05-05'));
    const early = new Date('2031-05-05T18:00:00+03:00');
    expect(await postDailyQuestion(db(), early)).toBeNull();
    const day = new Date('2031-05-05T19:30:00+03:00');
    await db().delete(jobState).where(like(jobState.key, 'chat-question:2031-05-05'));
    expect(await postDailyQuestion(db(), day)).toBeTruthy();
    expect(await postDailyQuestion(db(), new Date(day.getTime() + 3_600_000))).toBeNull();
    // An answer counts within a few hours of the question: one asked now.
    const id = await db().transaction((tx) => postGameLine(tx, 'global', 'question', 'Въпрос?', {}, new Date()));
    const p = await newPlayer();
    const before = (await passView(db(), p.userId)).points;
    await postToChannel(db(), p.userId, 'global', 'Пловдив — Бургас!', id);
    await postToChannel(db(), p.userId, 'global', 'И още веднъж', id);
    expect((await passView(db(), p.userId)).points - before).toBe(CHAT_LIFE.questionPoints);
  });

  it('a moment: once per key and at most one every few minutes', async () => {
    const now = new Date('2031-06-01T12:00:00Z');
    await db().delete(jobState).where(inArray(jobState.key, ['chat-moment:last', 'chat-moment:t1', 'chat-moment:t2']));
    expect(await db().transaction((tx) => postMoment(tx, 't1', 'Момент 1', {}, now))).toBe(true);
    expect(await db().transaction((tx) => postMoment(tx, 't1', 'Момент 1', {}, new Date(now.getTime() + 3_600_000)))).toBe(false);
    expect(await db().transaction((tx) => postMoment(tx, 't2', 'Момент 2', {}, new Date(now.getTime() + 60_000)))).toBe(false);
    expect(await db().transaction((tx) => postMoment(tx, 't2', 'Момент 2', {}, new Date(now.getTime() + CHAT_LIFE.momentGapMinutes * 60_000 + 1)))).toBe(true);
    const bot = await botUserId(db());
    const lines = await db().select().from(chatMessages).where(and(eq(chatMessages.userId, bot), eq(chatMessages.kind, 'moment')));
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('„Благодаря“: a new player thanks whoever answered them, once per answer', async () => {
    const newbie = await newPlayer();
    const helper = await newPlayer();
    const other = await newPlayer();
    await db().update(users).set({ level: 30 }).where(eq(users.id, other.userId));
    const q = await postToChannel(db(), newbie.userId, 'global', 'Как се взима обратен товар?');
    const a = await postToChannel(db(), helper.userId, 'global', 'От „Курсове“ след доставката.', q as number);
    const before = (await passView(db(), helper.userId)).points;
    const who = { id: newbie.userId, username: await nameOf(newbie.userId) };
    expect((await thankHelper(db(), who, a as number)).points).toBe(CHAT_LIFE.thankPoints);
    await expect(thankHelper(db(), who, a as number)).rejects.toThrow();
    expect((await passView(db(), helper.userId)).points - before).toBe(CHAT_LIFE.thankPoints);
    await expect(thankHelper(db(), { id: other.userId, username: await nameOf(other.userId) }, a as number)).rejects.toThrow();
  });
});
