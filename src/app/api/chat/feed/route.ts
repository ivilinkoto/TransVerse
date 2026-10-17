import { z } from 'zod';
import { isStaff } from '@/server/auth/roles';
import { getDb } from '@/server/db/client';
import { companyChat } from '@/server/game/chat';
import { channelFeed, conversation, markConversationRead } from '@/server/game/messages';
import { handler } from '@/server/http';

export const dynamic = 'force-dynamic';

const schema = z.object({
  /** global | trade | company | dm:<userId> */
  tab: z.string().regex(/^(global|trade|company|dm:[0-9a-f-]{36})$/, 'Непознат раздел.'),
  after: z.coerce.number().int().min(0).optional(),
});

/** Messages of one tab of the chat dock (`after` = only newer ones). Opening a private chat marks it read. */
export const GET = handler({ perMinute: 120, schema }, async ({ user, input }) => {
  const db = getDb();
  if (input.tab === 'company') {
    const c = await companyChat(db, user.id, input.after ?? 0);
    return { messages: c.messages, canModerate: c.canModerate };
  }
  if (input.tab.startsWith('dm:')) {
    const other = input.tab.slice(3);
    await markConversationRead(db, user.id, other);
    return { messages: await conversation(db, user.id, other, input.after ?? 0), canModerate: false };
  }
  return { messages: await channelFeed(db, input.tab as 'global' | 'trade', input.after ?? 0), canModerate: isStaff(user.role) };
});
