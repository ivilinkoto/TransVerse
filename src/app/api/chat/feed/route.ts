import { z } from 'zod';
import { isStaff } from '@/server/auth/roles';
import { getDb } from '@/server/db/client';
import { companyChat } from '@/server/game/chat';
import { channelFeed, conversation, markConversationRead } from '@/server/game/messages';
import { handler } from '@/server/http';
import { blockedIds } from '@/server/game/moderation';
import { companyKey, markChannelRead } from '@/server/game/chat-reads';
import { withReactions } from '@/server/game/chat-extras';
import { membershipOf } from '@/server/game/membership';
import { allianceFeed, playerAlliance } from '@/server/game/alliances';
import { CHAT_LIFE } from '@/lib/game/chat-life';
import { featureFor } from '@/server/features';

export const dynamic = 'force-dynamic';

const schema = z.object({
  /** global | trade | company | alliance | dm:<userId> */
  tab: z.string().regex(/^(global|trade|projects|company|alliance|dm:[0-9a-f-]{36})$/, 'Непознат раздел.'),
  after: z.coerce.number().int().min(0).optional(),
});

/** Messages of one tab of the chat dock (`after` = only newer ones). Opening a tab marks it read. */
export const GET = handler({ perMinute: 120, schema }, async ({ user, input }) => {
  const db = getDb();
  // Lines of players this player blocked are hidden.
  const blocked = await blockedIds(db, user.id);
  const visible = <T extends { messages: { userId: string }[] }>(r: T) => ({ ...r, messages: r.messages.filter((m) => !blocked.has(m.userId)) });
  if (input.tab === 'company') {
    const c = await companyChat(db, user.id, input.after ?? 0);
    const m = await membershipOf(db, user.id);
    if (m) await markChannelRead(db, user.id, companyKey(m.company.id), c.messages.at(-1)?.id ?? 0);
    return visible({ messages: c.messages, canModerate: c.canModerate, canPin: c.canPin, pinned: c.pinned, online: c.online });
  }
  if (input.tab === 'alliance') {
    const a = await playerAlliance(db, user.id);
    return visible({ messages: a ? await allianceFeed(db, a.id, input.after ?? 0) : [], canModerate: isStaff(user.role) });
  }
  if (input.tab.startsWith('dm:')) {
    const other = input.tab.slice(3);
    await markConversationRead(db, user.id, other);
    return { messages: await withReactions(db, 'dm', await conversation(db, user.id, other, input.after ?? 0), user.id), canModerate: false };
  }
  const messages = await channelFeed(db, input.tab as 'global' | 'trade' | 'projects', input.after ?? 0);
  await markChannelRead(db, user.id, input.tab, messages.at(-1)?.id ?? 0);
  // 1.2.6: a new player sees „Благодаря“ under the answers to their own messages.
  const canThank = user.level <= CHAT_LIFE.newbieLevel && (await featureFor(db, user.id, 'chat_life'));
  const marked = canThank ? messages.map((m) => ({ ...m, thankable: !m.kind && m.userId !== user.id && m.reply?.username === user.username })) : messages;
  return visible({ messages: await withReactions(db, 'channel', marked, user.id), canModerate: isStaff(user.role) });
});
