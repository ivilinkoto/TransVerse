import { and, eq, ne } from 'drizzle-orm';
import { DISCORD_FRAMES } from '@/lib/game/together';
import type { Database } from '@/server/db/client';
import { discordMembers, userBadges, users } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { fail } from '@/server/game/errors';
import { logActivity, notify } from '@/server/game/notify';
import { discord } from './api';
import { appUrl, discordConfig } from './config';
import { enqueue } from './outbox';
import { t } from '@/i18n/t';

/** ТрансКоин for linking Discord (once per player). */
export const DISCORD_LINK_COINS = 10;
export const discordRedirectUri = () => `${appUrl()}/api/discord/callback`;

export function discordAuthorizeUrl(state: string) {
  const q = new URLSearchParams({ client_id: discordConfig().appId, redirect_uri: discordRedirectUri(), response_type: 'code', scope: 'identify guilds.join', state, prompt: 'none' });
  return `https://discord.com/oauth2/authorize?${q}`;
}

/** Exchanges the code from Discord for the player's Discord account (and joins them to the server). */
export async function discordAccountFromCode(code: string) {
  const cfg = discordConfig();
  const token = await discord<{ access_token: string }>('POST', '/oauth2/token', undefined, { form: { client_id: cfg.appId, client_secret: cfg.clientSecret, grant_type: 'authorization_code', code, redirect_uri: discordRedirectUri() } });
  const me = await discord<{ id: string; username: string; global_name?: string | null }>('GET', '/users/@me', undefined, { auth: `Bearer ${token.access_token}` });
  // Into the TransVerse server (nothing happens when already a member).
  if (cfg.bot) await discord('PUT', `/guilds/${cfg.guildId}/members/${me.id}`, { access_token: token.access_token }).catch((e) => console.warn('[discord] join failed', (e as Error).message));
  return { id: me.id, name: me.global_name || me.username };
}

/** Links a Discord account to the player: one game account per Discord account; a reward the first time. */
export async function linkDiscord(db: Database, userId: string, account: { id: string; name: string }, now = new Date()) {
  return db.transaction(async (tx) => {
    const [other] = await tx.select({ id: users.id }).from(users).where(and(eq(users.discordId, account.id), ne(users.id, userId)));
    if (other) fail('discord_taken', t('Този Discord акаунт вече е свързан с друг профил в играта.'));
    await tx.update(users).set({ discordId: account.id, discordName: account.name.slice(0, 60), discordLinkedAt: now }).where(eq(users.id, userId));
    const badge = await tx.insert(userBadges).values({ userId, badge: 'discord', awardedAt: now }).onConflictDoNothing().returning({ badge: userBadges.badge });
    if (badge.length) {
      await postCoins(tx, userId, { amount: DISCORD_LINK_COINS, reason: 'discord_link', description: t('Свързан Discord'), idempotencyKey: `discord-link:${userId}` });
      await notify(tx, userId, 'success', () => t('Discord е свързан!'), () => t('+{0} ТрансКоин и значка „Discord шофьор“.', DISCORD_LINK_COINS), '/game/settings#discord');
    }
    // The frames for the level the member already has in the server.
    const [member] = await tx.select({ level: discordMembers.level }).from(discordMembers).where(eq(discordMembers.discordUserId, account.id));
    const frames = DISCORD_FRAMES.filter((f) => (member?.level ?? 0) >= f.level);
    if (frames.length) await tx.insert(userBadges).values(frames.map((f) => ({ userId, badge: f.badge, awardedAt: now }))).onConflictDoNothing();
    await logActivity(tx, userId, 'discord_linked', { discordId: account.id });
    // Roles in the server follow at once.
    await enqueue(tx, `roles:${userId}:${now.getTime()}`, `job:roles`, { userId });
  });
}

/** Unlinks Discord; the bot takes its roles back from that Discord account. */
export async function unlinkDiscord(db: Database, userId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ discordId: users.discordId }).from(users).where(eq(users.id, userId));
    if (!u?.discordId) return;
    await tx.update(users).set({ discordId: null, discordName: null, discordLinkedAt: null, discordPrefs: {} }).where(eq(users.id, userId));
    await enqueue(tx, `strip:${u.discordId}:${now.getTime()}`, 'job:strip', { discordId: u.discordId });
    await logActivity(tx, userId, 'discord_unlinked', {});
  });
}

/** Which game notifications also come as Discord direct messages (push categories, opt-in). */
export async function setDiscordPrefs(db: Database, userId: string, prefs: Record<string, boolean>) {
  const [u] = await db.select({ discordId: users.discordId }).from(users).where(eq(users.id, userId));
  if (!u?.discordId) fail('discord_not_linked', t('Първо свържи Discord.'));
  await db.update(users).set({ discordPrefs: prefs }).where(eq(users.id, userId));
}
