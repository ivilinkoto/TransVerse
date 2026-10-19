import { getDb } from '@/server/db/client';
import { membershipOf } from '@/server/game/membership';
import { conversations } from '@/server/game/messages';
import { handler } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Private conversations (with unread counts) and whether the player has a company chat. */
export const GET = handler({ perMinute: 120 }, async ({ user }) => {
  const db = getDb();
  const [list, member] = await Promise.all([conversations(db, user.id), membershipOf(db, user.id)]);
  return { conversations: list, company: member ? member.company.name : null, me: user.id, meName: user.username };
});
