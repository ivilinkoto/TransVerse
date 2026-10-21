import { and, asc, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import { isVip } from '@/lib/game/vip';
import { isStaff } from '@/server/auth/roles';
import type { Database } from '@/server/db/client';
import { companyMembers, companyRanks, jobState, organizations, userBadges, users } from '@/server/db/schema';
import { discord, DiscordError } from './api';
import { BADGE_ROLES, COMPANY_CATEGORY, discordConfig } from './config';
import { ensureRole, forgetGuild, gameRole, guild, managedRoleIds, verifiedRole } from './guild';
import { layoutCategory, layoutState } from './layout';
import { enqueue } from './outbox';

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const HISTORY = 1n << 16n;
const EMBED = 1n << 14n;
const ATTACH = 1n << 15n;
const WEBHOOKS = 1n << 29n;
const CONNECT = 1n << 20n;
const SPEAK = 1n << 21n;
const allow = (...bits: bigint[]) => bits.reduce((a, b) => a | b, 0n).toString();

/** Company roles the bot made (they are "managed" too: given and taken by the bot only). */
async function companyRoleIds(db: Database) {
  const rows = await db.select({ id: organizations.discordRoleId }).from(organizations).where(isNotNull(organizations.discordRoleId));
  return rows.map((r) => r.id!);
}

/** The roles a linked player should have: linked, level, VIP, company owner and their company's role. */
async function desiredRoles(db: Database, userId: string, now: Date) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u?.discordId || u.bannedAt) return null;
  const [m] = await db
    .select({ org: organizations, isOwner: companyRanks.isOwner })
    .from(companyMembers)
    .innerJoin(organizations, eq(organizations.id, companyMembers.companyId))
    .innerJoin(companyRanks, eq(companyRanks.id, companyMembers.rankId))
    .where(eq(companyMembers.userId, userId));
  const want = [await gameRole('linked')];
  if (u.level >= 10) want.push(await gameRole('level10'));
  if (u.level >= 20) want.push(await gameRole('level20'));
  if (isVip(u.vipUntil, now)) want.push(await gameRole('vip'));
  if (m?.isOwner) want.push(await gameRole('owner'));
  if (isStaff(u.role)) want.push(await gameRole('staff'));
  if (m?.org.discordChannel && m.org.discordRoleId) want.push(m.org.discordRoleId);
  // Special badges from the game are roles too (v1.3).
  const badges = await db.select({ badge: userBadges.badge }).from(userBadges).where(eq(userBadges.userId, userId));
  for (const { badge } of badges) {
    const role = BADGE_ROLES[badge];
    if (role) want.push(await ensureRole(role.name, role.color));
  }
  return { discordId: u.discordId, want: new Set(want) };
}

/** Gives and takes the bot's roles of one linked player (only roles the bot manages). */
export async function syncUserRoles(db: Database, userId: string, now = new Date()) {
  if (!discordConfig().bot) return;
  const d = await desiredRoles(db, userId, now);
  if (!d) return;
  const { guildId } = discordConfig();
  let member: { roles: string[] };
  try {
    member = await discord<{ roles: string[] }>('GET', `/guilds/${guildId}/members/${d.discordId}`);
  } catch (error) {
    if (error instanceof DiscordError && error.status === 404) return; // not in the server
    throw error;
  }
  const managed = await managedRoleIds(await companyRoleIds(db));
  for (const id of d.want) if (!member.roles.includes(id)) await discord('PUT', `/guilds/${guildId}/members/${d.discordId}/roles/${id}`);
  // Linked players pass the new members' check by themselves (the role is never taken away here).
  if ((await layoutState(db)).settings?.verification) {
    const verified = await verifiedRole();
    if (!member.roles.includes(verified)) await discord('PUT', `/guilds/${guildId}/members/${d.discordId}/roles/${verified}`);
  }
  for (const id of member.roles) if (managed.has(id) && !d.want.has(id)) await discord('DELETE', `/guilds/${guildId}/members/${d.discordId}/roles/${id}`);
}

/** After unlinking: every role the bot gave goes. */
export async function stripRoles(discordId: string) {
  const { guildId } = discordConfig();
  let member: { roles: string[] };
  try {
    member = await discord<{ roles: string[] }>('GET', `/guilds/${guildId}/members/${discordId}`);
  } catch (error) {
    if (error instanceof DiscordError && error.status === 404) return;
    throw error;
  }
  const { roles } = await guild();
  const managed = await managedRoleIds();
  const companyRoles = new Set(roles.filter((r) => r.name.startsWith('Компания · ')).map((r) => r.id));
  for (const id of member.roles) if (managed.has(id) || companyRoles.has(id)) await discord('DELETE', `/guilds/${guildId}/members/${discordId}/roles/${id}`);
}

/** Worker: walks through the linked players a page at a time, so roles follow levels, VIP and companies. */
export async function syncAllRoles(db: Database, now = new Date(), page = 40) {
  if (!discordConfig().bot) return 0;
  const [state] = await db.select().from(jobState).where(eq(jobState.key, 'discord-roles-cursor'));
  const after = (state?.value as { id?: string } | undefined)?.id ?? '00000000-0000-0000-0000-000000000000';
  const rows = await db.select({ id: users.id }).from(users).where(and(isNotNull(users.discordId), isNull(users.bannedAt), gt(users.id, after))).orderBy(asc(users.id)).limit(page);
  for (const r of rows) {
    try {
      await syncUserRoles(db, r.id, now);
    } catch (error) {
      console.warn('[discord] roles failed', (error as Error).message);
    }
  }
  const next = rows.length < page ? '00000000-0000-0000-0000-000000000000' : rows.at(-1)!.id;
  await db.insert(jobState).values({ key: 'discord-roles-cursor', value: { id: next } }).onConflictDoUpdate({ target: jobState.key, set: { value: { id: next }, updatedAt: now } });
  return rows.length;
}

const channelName = (name: string) => `🚚┃${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'компания'}`;

/**
 * A company's private channel in the server (category "Компании"): its own
 * role sees it, nobody else. Made when the owner turns it on, removed when
 * turned off. The chat bridge writes through the channel's webhook.
 */
export async function ensureCompanyChannel(db: Database, organizationId: string) {
  const { guildId } = discordConfig();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  if (!org) return;
  if (!org.discordChannel) {
    if (org.discordChannelId) await discord('DELETE', `/channels/${org.discordChannelId}`).catch(() => undefined);
    if (org.discordVoiceId) await discord('DELETE', `/channels/${org.discordVoiceId}`).catch(() => undefined);
    if (org.discordRoleId) await discord('DELETE', `/guilds/${guildId}/roles/${org.discordRoleId}`).catch(() => undefined);
    await db.update(organizations).set({ discordChannelId: null, discordVoiceId: null, discordRoleId: null, discordWebhook: null }).where(eq(organizations.id, org.id));
    forgetGuild();
    return;
  }
  const color = org.liveryColor ? parseInt(org.liveryColor.slice(1), 16) : 0x2f7bff;
  const roleId = org.discordRoleId ?? (await ensureRole(`Компания · ${org.name}`.slice(0, 100), color));
  const g = await guild(true);
  let categoryId = await layoutCategory(db, 'компании', COMPANY_CATEGORY);
  if (!categoryId) categoryId = (await discord<{ id: string }>('POST', `/guilds/${guildId}/channels`, { name: COMPANY_CATEGORY, type: 4 })).id;
  let channelId = org.discordChannelId && g.channels.some((c) => c.id === org.discordChannelId) ? org.discordChannelId : null;
  const overwrites = [
    { id: guildId, type: 0, deny: allow(VIEW) },
    { id: roleId, type: 0, allow: allow(VIEW, SEND, HISTORY, EMBED, ATTACH) },
    { id: g.botId, type: 1, allow: allow(VIEW, SEND, HISTORY, EMBED, WEBHOOKS) },
  ];
  if (!channelId) {
    const ch = await discord<{ id: string }>('POST', `/guilds/${guildId}/channels`, { name: channelName(org.name), type: 0, parent_id: categoryId, topic: `Чатът на „${org.name}“ — свързан с чата в TransVerse.`, permission_overwrites: overwrites });
    channelId = ch.id;
  } else {
    await discord('PATCH', `/channels/${channelId}`, { name: channelName(org.name), permission_overwrites: overwrites });
  }
  let webhook = org.discordWebhook;
  if (!webhook || org.discordChannelId !== channelId) {
    const hook = await discord<{ id: string; token: string }>('POST', `/channels/${channelId}/webhooks`, { name: 'TransVerse' });
    webhook = `${hook.id}/${hook.token}`;
  }
  // The company's voice channel next to it (same people).
  const voiceOverwrites = [
    { id: guildId, type: 0, deny: allow(VIEW) },
    { id: roleId, type: 0, allow: allow(VIEW, CONNECT, SPEAK) },
    { id: g.botId, type: 1, allow: allow(VIEW, CONNECT) },
  ];
  let voiceId = org.discordVoiceId && g.channels.some((c) => c.id === org.discordVoiceId) ? org.discordVoiceId : null;
  if (!voiceId) voiceId = (await discord<{ id: string }>('POST', `/guilds/${guildId}/channels`, { name: `🔊 ${org.name}`.slice(0, 100), type: 2, parent_id: categoryId, permission_overwrites: voiceOverwrites })).id;
  else await discord('PATCH', `/channels/${voiceId}`, { name: `🔊 ${org.name}`.slice(0, 100), permission_overwrites: voiceOverwrites });
  await db.update(organizations).set({ discordRoleId: roleId, discordChannelId: channelId, discordVoiceId: voiceId, discordWebhook: webhook }).where(eq(organizations.id, org.id));
  forgetGuild();
  // Linked members get the company role now.
  const members = await db.select({ id: users.id }).from(companyMembers).innerJoin(users, eq(users.id, companyMembers.userId)).where(and(eq(companyMembers.companyId, org.id), isNotNull(users.discordId)));
  for (const m of members) await enqueue(db, `roles:${m.id}:${Date.now()}`, 'job:roles', { userId: m.id });
}
