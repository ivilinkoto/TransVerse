import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { companyChat } from '@/server/game/chat';
import { companyKey, markChannelRead } from '@/server/game/chat-reads';
import { membershipOf } from '@/server/game/membership';
import { handler } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Company chat messages for members (`after` = only newer ones). */
export const GET = handler({ perMinute: 60, schema: z.object({ after: z.coerce.number().int().min(0).optional() }) }, async ({ user, input }) => {
  const db = getDb();
  const chat = await companyChat(db, user.id, input.after ?? 0);
  const m = await membershipOf(db, user.id);
  // Reading the company chat page counts as reading the chat.
  if (m) await markChannelRead(db, user.id, companyKey(m.company.id), chat.messages.at(-1)?.id ?? 0);
  return chat;
});
