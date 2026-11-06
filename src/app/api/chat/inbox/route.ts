import { getDb } from '@/server/db/client';
import { membershipOf } from '@/server/game/membership';
import { chatUnread } from '@/server/game/chat-reads';
import { conversations } from '@/server/game/messages';
import { handler } from '@/server/http';
import { playerAlliance } from '@/server/game/alliances';
import { cafeCity } from '@/server/game/meet';
import { featureFor } from '@/server/features';

export const dynamic = 'force-dynamic';

/** Private conversations (with unread counts), new messages in the channels and whether the player has a company chat. */
export const GET = handler({ perMinute: 120 }, async ({ user }) => {
  const db = getDb();
  const [list, member, unread, alliance, projects] = await Promise.all([conversations(db, user.id), membershipOf(db, user.id), chatUnread(db, user.id), playerAlliance(db, user.id), featureFor(db, user.id, 'region_projects')]);
  // 1.2.7: the café of the city where the player's truck stands.
  const cafe = (await featureFor(db, user.id, 'city_cafe')) ? await cafeCity(db, user.id) : null;
  return { conversations: list, company: member ? member.company.name : null, alliance: alliance?.name ?? null, me: user.id, meName: user.username, unread, projects, cafe: cafe ? { name: cafe.nameBg } : null };
});
