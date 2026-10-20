import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// As released (before the date these are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true, featureDate: () => new Date('2026-01-01T00:00:00Z') }));
import { unreadLabel, UNREAD_CAP } from '@/lib/game/social';
import { closeDb } from '@/server/db/client';
import { chatMessages, companyMessages, notifications, organizations } from '@/server/db/schema';
import { companyChat, sendChatMessage } from '@/server/game/chat';
import { chatUnread, companyKey, markChannelRead } from '@/server/game/chat-reads';
import { GameError } from '@/server/game/errors';
import { joinCompany, updateSettings } from '@/server/game/membership';
import { channelFeed, conversation, postToChannel, sendDirectMessage } from '@/server/game/messages';
import { blockUser } from '@/server/game/moderation';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const repliedTo = async (userId: string) => db().select().from(notifications).where(and(eq(notifications.userId, userId), like(notifications.title, '%ти отговори%')));

describe('replies', () => {
  it('a reply in a world channel quotes the original and tells its author', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const first = await postToChannel(db(), a.userId, 'global', 'Някой кара ли към Варна днес?');
    const answer = await postToChannel(db(), b.userId, 'global', 'Аз, след час.', first);
    const feed = await channelFeed(db(), 'global', first - 1);
    expect(feed.find((m) => m.id === answer)!.reply).toEqual({ id: first, username: a.username, body: 'Някой кара ли към Варна днес?' });
    expect(await repliedTo(a.userId)).toHaveLength(1);
    // Not across channels.
    expect(await code(postToChannel(db(), b.userId, 'trade', 'Продавам ремарке', first))).toBe('reply_not_found');
    // Answering oneself tells nobody.
    await postToChannel(db(), a.userId, 'global', 'Добре, благодаря!', answer);
    await postToChannel(db(), a.userId, 'global', 'И още нещо', first);
    expect(await repliedTo(a.userId)).toHaveLength(1);
  });

  it('company and private replies stay inside the company and the conversation', async () => {
    const owner = await playerWithCompany('Sofia');
    const other = await playerWithCompany('Sofia');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const member = await newPlayer();
    await joinCompany(db(), member.userId, org!.id);
    const q = await sendChatMessage(db(), owner.userId, 'Кой поема материалите?');
    const a = await sendChatMessage(db(), member.userId, 'Аз!', q);
    expect((await companyChat(db(), owner.userId)).messages.find((m) => m.id === a)!.reply).toMatchObject({ id: q, username: owner.username });
    expect(await repliedTo(owner.userId)).toHaveLength(1);
    const foreign = await sendChatMessage(db(), other.userId, 'Нашият чат');
    expect(await code(sendChatMessage(db(), member.userId, 'Здрасти', foreign))).toBe('reply_not_found');

    const dm1 = await sendDirectMessage(db(), owner.userId, member.userId, 'Утре в 8?');
    const dm2 = await sendDirectMessage(db(), member.userId, owner.userId, 'Да', new Date(), dm1);
    expect((await conversation(db(), owner.userId, member.userId)).find((m) => m.id === dm2)!.reply).toMatchObject({ id: dm1 });
    expect(await code(sendDirectMessage(db(), other.userId, owner.userId, 'Хей', new Date(), dm1))).toBe('reply_not_found');
  });
});

describe('unread messages', () => {
  it('counts new company messages (not your own, not deleted, not from blocked players) until you read them', async () => {
    const owner = await playerWithCompany('Sofia');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const a = await newPlayer();
    const b = await newPlayer();
    await joinCompany(db(), a.userId, org!.id);
    await joinCompany(db(), b.userId, org!.id);
    await sendChatMessage(db(), a.userId, 'Едно');
    const two = await sendChatMessage(db(), a.userId, 'Две');
    await sendChatMessage(db(), b.userId, 'Три');
    await sendChatMessage(db(), owner.userId, 'Мое');
    expect((await chatUnread(db(), owner.userId)).company).toBe(3);
    await db().update(companyMessages).set({ deletedAt: new Date() }).where(eq(companyMessages.id, two));
    await blockUser(db(), owner.userId, b.userId);
    expect((await chatUnread(db(), owner.userId)).company).toBe(1);
    const last = (await companyChat(db(), owner.userId)).messages.at(-1)!.id;
    await markChannelRead(db(), owner.userId, companyKey(org!.id), last);
    expect((await chatUnread(db(), owner.userId)).company).toBe(0);
    // Reading never goes backwards.
    await markChannelRead(db(), owner.userId, companyKey(org!.id), 1);
    expect((await chatUnread(db(), owner.userId)).company).toBe(0);
    await sendChatMessage(db(), a.userId, 'Ново');
    expect((await chatUnread(db(), owner.userId)).company).toBe(1);
  });

  it('a busy channel shows "99+"', async () => {
    const reader = await newPlayer();
    const writer = await newPlayer();
    await db().insert(chatMessages).values(Array.from({ length: UNREAD_CAP + 5 }, (_, i) => ({ channel: 'trade', userId: writer.userId, body: `Обява ${i}` })));
    const n = (await chatUnread(db(), reader.userId)).trade;
    expect(n).toBe(UNREAD_CAP);
    expect(unreadLabel(n)).toBe('99+');
    expect(unreadLabel(99)).toBe('99');
  });
});
