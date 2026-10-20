import { getDb } from '@/server/db/client';
import { membershipOf } from '@/server/game/membership';
import { chatUnread } from '@/server/game/chat-reads';
import { conversations } from '@/server/game/messages';
import { handler } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Private conversations (with unread counts), new messages in the channels and whether the player has a company chat. */
export const GET = handler({ perMinute: 120 }, async ({ user }) => {
  const db = getDb();
  const [list, member, unread] = await Promise.all([conversations(db, user.id), membershipOf(db, user.id), chatUnread(db, user.id)]);
  return { conversations: list, company: member ? member.company.name : null, me: user.id, meName: user.username, unread };
});
