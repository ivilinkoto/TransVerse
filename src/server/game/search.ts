import { and, asc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { isOnline } from '@/lib/game/social';
import { isVip } from '@/lib/game/vip';
import type { DbOrTx } from '@/server/db/client';
import { companyMembers, organizations, users } from '@/server/db/schema';

/** LIKE pattern for user text: % and _ are literal. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Finds players by name and companies by name or tag. Names that start with
 * the text come first, then the shorter ones. Banned players are not shown.
 */
export async function searchPlayers(db: DbOrTx, raw: string, now = new Date()) {
  const q = raw.trim().slice(0, 40);
  if (q.length < 2) return { players: [], companies: [] };
  const pattern = like(q);
  const starts = `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const [players, companies] = await Promise.all([
    db
      .select({ id: users.id, username: users.username, role: users.role, level: users.level, lastSeenAt: users.lastSeenAt, vipUntil: users.vipUntil, avatarVersion: users.avatarVersion, companyName: organizations.name, companyTag: organizations.tag, companyColor: organizations.color })
      .from(users)
      .leftJoin(companyMembers, eq(companyMembers.userId, users.id))
      .leftJoin(organizations, eq(organizations.id, companyMembers.companyId))
      .where(and(ilike(users.username, pattern), isNull(users.bannedAt)))
      .orderBy(sql`case when ${users.username} ilike ${starts} then 0 else 1 end`, sql`length(${users.username})`, asc(users.username))
      .limit(8),
    db
      .select({ id: organizations.id, name: organizations.name, tag: organizations.tag, color: organizations.color, members: sql<number>`(select count(*)::int from ${companyMembers} where ${companyMembers.companyId} = ${organizations.id})` })
      .from(organizations)
      .where(or(ilike(organizations.name, pattern), ilike(organizations.tag, pattern)))
      .orderBy(sql`case when ${organizations.name} ilike ${starts} or ${organizations.tag} ilike ${starts} then 0 else 1 end`, asc(organizations.name))
      .limit(5),
  ]);
  return {
    players: players.map(({ lastSeenAt, vipUntil, ...p }) => ({ ...p, online: isOnline(lastSeenAt, now), vip: isVip(vipUntil, now) })),
    companies,
  };
}

export type SearchResult = Awaited<ReturnType<typeof searchPlayers>>;
