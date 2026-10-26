import { and, desc, eq, or, sql } from 'drizzle-orm';
import { memberCapacity, type UpgradeLevels } from '@/lib/game/company';
import { levelProgress, reputationTier } from '@/lib/game/progression';
import { isOnline, lastSeenLabel } from '@/lib/game/social';
import { isVip } from '@/lib/game/vip';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, companyApplications, companyInvites, companyMembers, friendships, organizations, userBlocks, users, haulerRatings } from '@/server/db/schema';
import { badgesOf } from './halloween';
import { assertNotBlocked } from './moderation';
import { fail } from './errors';
import { queueRoles } from '@/server/discord/outbox';
import { can, entryRank, memberCount, membershipOf, notifyMembers, requirePermission } from './membership';
import { logActivity, notify } from './notify';
import { t, tx } from '@/i18n/t';

const MAX_FRIENDS = 200;

async function userByName(db: DbOrTx, username: string) {
  const [u] = await db.select().from(users).where(sql`lower(${users.username}) = lower(${username})`);
  return u ?? null;
}

async function pairRow(db: DbOrTx, a: string, b: string) {
  const [row] = await db
    .select()
    .from(friendships)
    .where(or(and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)), and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a))));
  return row ?? null;
}

export type Relation = 'self' | 'friends' | 'sent' | 'received' | 'none';

/** Everything the player card shows, plus what the viewer can do with this player. */
export async function playerCard(db: DbOrTx, viewerId: string, username: string, now = new Date()) {
  const u = await userByName(db, username);
  if (!u || u.bannedAt) return null;
  const [account] = await db.select().from(companies).where(eq(companies.ownerId, u.id));
  const m = await membershipOf(db, u.id);
  const pair = u.id === viewerId ? null : await pairRow(db, viewerId, u.id);
  const relation: Relation = u.id === viewerId ? 'self' : !pair ? 'none' : pair.status === 'accepted' ? 'friends' : pair.requesterId === viewerId ? 'sent' : 'received';
  const viewerM = u.id === viewerId ? null : await membershipOf(db, viewerId);
  const [invited] = viewerM && !m ? await db.select({ id: companyInvites.id }).from(companyInvites).where(and(eq(companyInvites.companyId, viewerM.company.id), eq(companyInvites.userId, u.id), eq(companyInvites.status, 'pending'))) : [];
  const [blockRow] = u.id === viewerId ? [] : await db.select({ x: userBlocks.blockerId }).from(userBlocks).where(and(eq(userBlocks.blockerId, viewerId), eq(userBlocks.blockedId, u.id)));
  const [{ friends = 0 } = {}] = await db.select({ friends: sql<number>`count(*)::int` }).from(friendships).where(and(eq(friendships.status, 'accepted'), or(eq(friendships.requesterId, u.id), eq(friendships.addresseeId, u.id))));
  // v1.4: stars from the goods owners this player hauled for (the freight exchange).
  const [hauler] = await db.select({ stars: sql<number | null>`avg(${haulerRatings.stars})::float`, count: sql<number>`count(${haulerRatings.stars})::int` }).from(haulerRatings).where(eq(haulerRatings.haulerUserId, u.id));
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    avatarVersion: u.avatarVersion,
    leagueTier: u.leagueTier,
    badges: (await badgesOf(db, u.id)).map((b) => ({ id: b.id, label: b.label, description: b.description })),
    vip: isVip(u.vipUntil, now),
    level: u.level,
    levelShare: levelProgress(u.xp).share,
    online: isOnline(u.lastSeenAt, now),
    lastSeen: lastSeenLabel(u.lastSeenAt, now),
    memberSince: u.createdAt.toISOString(),
    reputation: account?.reputation ?? 0,
    reputationTier: tx(reputationTier(account?.reputation ?? 0).label),
    deliveries: account?.deliveries ?? 0,
    kind: account?.kind ?? 'independent',
    company: m ? { id: m.company.id, name: m.company.name, tag: m.company.tag, color: m.company.color, rank: m.rank.name } : null,
    friends,
    relation,
    friendshipId: pair?.id ?? null,
    /** The viewer can invite this player to their company. */
    canInvite: !!viewerM && !m && can(viewerM.rank, 'recruit') && !invited,
    invited: !!invited,
    /** The viewer has blocked this player. */
    blocked: !!blockRow,
    hauler: hauler?.count ? { stars: Math.round((hauler.stars ?? 0) * 10) / 10, count: hauler.count } : null,
  };
}
export type PlayerCard = NonNullable<Awaited<ReturnType<typeof playerCard>>>;

// ── Friends ───────────────────────────────────────────────────────────────

export async function sendFriendRequest(db: Database, userId: string, targetId: string) {
  if (userId === targetId) fail('self', t('Не можеш да добавиш себе си.'));
  await assertNotBlocked(db, userId, targetId);
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id, username: users.username, bannedAt: users.bannedAt }).from(users).where(eq(users.id, targetId));
    if (!target || target.bannedAt) fail('player_not_found', t('Играчът не е намерен.'), 404);
    const existing = await pairRow(tx, userId, targetId);
    if (existing?.status === 'accepted') fail('already_friends', t('Вече сте приятели.'), 409);
    // They already asked us: accept instead of sending a second request.
    if (existing && existing.requesterId === targetId) return respond(tx, userId, existing.id, true);
    if (existing) fail('already_sent', t('Поканата вече е изпратена.'), 409);
    const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(friendships).where(or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)));
    if (n >= MAX_FRIENDS) fail('too_many_friends', t('Можеш да имаш до {0} приятели и покани.', MAX_FRIENDS));
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    await tx.insert(friendships).values({ requesterId: userId, addresseeId: targetId });
    await notify(tx, targetId, 'info', () => t('Покана за приятелство'), () => t('{0} иска да сте приятели.', me!.username), '/game/profile#friends');
    return 'sent' as const;
  });
}

async function respond(tx: DbOrTx, userId: string, friendshipId: string, accept: boolean) {
  const [row] = await tx.select().from(friendships).where(and(eq(friendships.id, friendshipId), eq(friendships.addresseeId, userId), eq(friendships.status, 'pending')));
  if (!row) fail('request_not_found', t('Поканата не е намерена.'), 404);
  if (!accept) {
    await tx.delete(friendships).where(eq(friendships.id, row!.id));
    return 'declined' as const;
  }
  await tx.update(friendships).set({ status: 'accepted', respondedAt: new Date() }).where(eq(friendships.id, row!.id));
  const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
  await notify(tx, row!.requesterId, 'success', () => t('Нов приятел'), () => t('{0} прие поканата ти за приятелство.', me!.username), '/game/profile#friends');
  return 'accepted' as const;
}

export async function respondFriendRequest(db: Database, userId: string, friendshipId: string, accept: boolean) {
  return db.transaction((tx) => respond(tx, userId, friendshipId, accept));
}

/** Removes a friend, or withdraws a request the player sent. */
export async function removeFriend(db: Database, userId: string, otherId: string) {
  const row = await pairRow(db, userId, otherId);
  if (!row) fail('not_friends', t('Не сте приятели.'), 404);
  await db.delete(friendships).where(eq(friendships.id, row!.id));
}

/** Friends with their online status, and pending requests both ways. */
export async function friendsOf(db: DbOrTx, userId: string, now = new Date()) {
  const rows = await db
    .select({ f: friendships, other: { id: users.id, username: users.username, role: users.role, level: users.level, lastSeenAt: users.lastSeenAt, vipUntil: users.vipUntil, avatarVersion: users.avatarVersion } })
    .from(friendships)
    .innerJoin(users, sql`${users.id} = case when ${friendships.requesterId} = ${userId} then ${friendships.addresseeId} else ${friendships.requesterId} end`)
    .where(or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)))
    .orderBy(desc(users.lastSeenAt));
  const view = (r: (typeof rows)[number]) => ({ friendshipId: r.f.id, ...r.other, vip: isVip(r.other.vipUntil, now), online: isOnline(r.other.lastSeenAt, now), lastSeen: lastSeenLabel(r.other.lastSeenAt, now) });
  return {
    friends: rows.filter((r) => r.f.status === 'accepted').map(view),
    received: rows.filter((r) => r.f.status === 'pending' && r.f.addresseeId === userId).map(view),
    sent: rows.filter((r) => r.f.status === 'pending' && r.f.requesterId === userId).map(view),
  };
}

// ── Company invites ───────────────────────────────────────────────────────

/** A member with the "recruit" right invites a player who is not in a company. */
export async function inviteToCompany(db: Database, actorId: string, targetId: string) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'recruit');
    const [target] = await tx.select({ id: users.id, username: users.username, bannedAt: users.bannedAt }).from(users).where(eq(users.id, targetId));
    if (!target || target.bannedAt) fail('player_not_found', t('Играчът не е намерен.'), 404);
    await assertNotBlocked(tx, actorId, targetId);
    if (await membershipOf(tx, targetId)) fail('already_member', t('Играчът вече е в компания.'), 409);
    if ((await memberCount(tx, actor.company.id)) >= memberCapacity(actor.company.upgrades as UpgradeLevels)) fail('company_full', t('Компанията няма свободни места.'));
    const inserted = await tx.insert(companyInvites).values({ companyId: actor.company.id, userId: targetId, invitedBy: actorId }).onConflictDoNothing().returning({ id: companyInvites.id });
    if (!inserted.length) fail('already_invited', t('Играчът вече е поканен.'), 409);
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, actorId));
    await notify(tx, targetId, 'info', () => t('Покана от „{0}“', actor.company.name), () => t('{0} те кани да се присъединиш към компанията.', me!.username), '/game/profile#invites');
    await logActivity(tx, actorId, 'company_invite_sent', { companyId: actor.company.id, targetId });
    return inserted[0]!.id;
  });
}

/** The invited player accepts (joins, whatever the recruitment mode) or declines. */
export async function respondCompanyInvite(db: Database, userId: string, inviteId: string, accept: boolean) {
  return db.transaction(async (tx) => {
    const [invite] = await tx.select().from(companyInvites).where(and(eq(companyInvites.id, inviteId), eq(companyInvites.userId, userId), eq(companyInvites.status, 'pending'))).for('update');
    if (!invite) fail('invite_not_found', t('Поканата не е намерена или вече е отговорена.'), 404);
    const [company] = await tx.select().from(organizations).where(eq(organizations.id, invite!.companyId)).for('update');
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    if (!accept) {
      await tx.update(companyInvites).set({ status: 'declined', decidedAt: new Date() }).where(eq(companyInvites.id, invite!.id));
      if (invite!.invitedBy) await notify(tx, invite!.invitedBy, 'info', () => t('Поканата е отказана'), () => t('{0} отказа поканата за „{1}“.', me!.username, company!.name), '/game/company/members');
      return 'declined' as const;
    }
    if (await membershipOf(tx, userId)) fail('already_member', t('Вече членуваш в компания. Първо я напусни.'), 409);
    if ((await memberCount(tx, company!.id)) >= memberCapacity(company!.upgrades as UpgradeLevels)) fail('company_full', t('Компанията вече няма свободни места.'));
    const rank = await entryRank(tx, company!.id);
    await tx.insert(companyMembers).values({ userId, companyId: company!.id, rankId: rank.id, firstTripBonus: true });
    await queueRoles(tx, userId);
    await tx.update(companyInvites).set({ status: 'accepted', decidedAt: new Date() }).where(eq(companyInvites.id, invite!.id));
    // Other invites and applications are no longer needed.
    await tx.update(companyInvites).set({ status: 'cancelled', decidedAt: new Date() }).where(and(eq(companyInvites.userId, userId), eq(companyInvites.status, 'pending')));
    await tx.update(companyApplications).set({ status: 'withdrawn', decidedAt: new Date() }).where(and(eq(companyApplications.userId, userId), eq(companyApplications.status, 'pending')));
    await logActivity(tx, userId, 'company_joined', { companyId: company!.id, invite: invite!.id });
    await notifyMembers(tx, company!.id, 'recruit', () => t('Нов член'), () => t('{0} прие поканата и се присъедини към „{1}“.', me!.username, company!.name), '/game/company/members');
    return 'joined' as const;
  });
}

/** Pending invites for a player (shown on their profile). */
export async function myCompanyInvites(db: DbOrTx, userId: string) {
  return db
    .select({ id: companyInvites.id, createdAt: companyInvites.createdAt, company: { id: organizations.id, name: organizations.name, tag: organizations.tag, color: organizations.color, level: organizations.companyLevel }, by: users.username })
    .from(companyInvites)
    .innerJoin(organizations, eq(organizations.id, companyInvites.companyId))
    .leftJoin(users, eq(users.id, companyInvites.invitedBy))
    .where(and(eq(companyInvites.userId, userId), eq(companyInvites.status, 'pending')))
    .orderBy(desc(companyInvites.createdAt));
}
