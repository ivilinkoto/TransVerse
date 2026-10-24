import { and, eq, isNull } from 'drizzle-orm';
import { featureDate, featureLive } from '@/lib/game/features';
import { isStaff } from '@/server/auth/roles';
import type { Database } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { runAction, type GameAction } from '@/server/game/actions';
import { GameError } from '@/server/game/errors';
import { discord } from './api';
import { appUrl, discordConfig } from './config';
import { say, type MessageData, type Response } from './ui';
import { t, intlLocale } from '@/i18n/t';

export interface Interaction {
  id?: string;
  token?: string;
  type: number;
  guild_id?: string;
  channel_id?: string;
  data?: {
    name?: string;
    options?: { name: string; type?: number; value: string | number | boolean }[];
    custom_id?: string;
    component_type?: number;
    values?: string[];
    components?: { components: { custom_id: string; value: string }[] }[];
    resolved?: { users?: Record<string, { id: string; username: string; global_name?: string | null; bot?: boolean }> };
  };
  member?: { user?: { id: string; username?: string; global_name?: string | null }; roles?: string[]; permissions?: string };
  user?: { id: string; username?: string; global_name?: string | null };
  /** The language of the user's Discord client (e.g. "en-US", "ru", "bg"). */
  locale?: string;
  message?: { id: string; embeds?: unknown[] };
}

/** What a handler gives back: the response now, and optionally work to finish after it (deferred answers). */
export interface Answer {
  response: Response;
  later?: () => Promise<void>;
}
export const answer = (response: Response, later?: () => Promise<void>): Answer => ({ response, ...(later ? { later } : {}) });

export interface Ctx {
  db: Database;
  i: Interaction;
  discordId: string;
  discordName: string;
  /** The linked game account (null when not linked or banned). */
  me: typeof users.$inferSelect | null;
  /** The member's permissions in the channel (Discord bit field). */
  perms: bigint;
  now: Date;
}

export const PERM = { admin: 1n << 3n, manageGuild: 1n << 5n, ban: 1n << 2n, manageMessages: 1n << 13n, moderate: 1n << 40n };
export const hasPerm = (ctx: Ctx, bit: bigint) => (ctx.perms & PERM.admin) !== 0n || (ctx.perms & bit) !== 0n;

export async function makeCtx(db: Database, i: Interaction, now = new Date()): Promise<Ctx> {
  const u = i.member?.user ?? i.user;
  const discordId = u?.id ?? '';
  const [me] = discordId ? await db.select().from(users).where(and(eq(users.discordId, discordId), isNull(users.bannedAt))) : [];
  return { db, i, discordId, discordName: u?.global_name || u?.username || 'Discord', me: me ?? null, perms: BigInt(i.member?.permissions ?? '0'), now };
}

export const linkHint = () => t('Свържи акаунта си от **Настройки → Discord** в играта: {0}/game/settings#discord', appUrl());

/** Stops a handler with an answer to the player (caught by the dispatcher). */
export class Stop extends Error {
  constructor(public answer: Answer) {
    super('stop');
  }
}
export const stop = (content: string): never => {
  throw new Stop(answer(say(content)));
};

/** The linked account, or a hint how to link. */
export function linked(ctx: Ctx) {
  if (!ctx.me) stop(t('Не знам кой си в играта. {0}', linkHint()));
  return ctx.me!;
}

/** Game features from Discord follow the release like in the game (staff first). */
export function released(ctx: Ctx) {
  const me = linked(ctx);
  if (!featureLive('discord_bot', ctx.now, isStaff(me.role))) {
    const at = featureDate('discord_bot');
    stop(t('Това тръгва с обновлението{0}. 🚚', at ? t(' на {0}', at.toLocaleDateString(intlLocale(), { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long' })) : ''));
  }
  return me;
}

/**
 * A player command from Discord: exactly the same as from the game (runAction),
 * as the linked player. Game errors become a short answer only they see.
 */
export async function act<T = Record<string, unknown>>(ctx: Ctx, input: GameAction, opts: { gated?: boolean } = {}): Promise<T> {
  // Support tickets are not new: they work before the release too.
  const me = opts.gated === false ? linked(ctx) : released(ctx);
  try {
    return (await runAction(ctx.db, { id: me.id, role: me.role, username: me.username }, input, async () => `discord:${ctx.discordId}`)) as T;
  } catch (error) {
    if (error instanceof GameError) stop(`⚠️ ${error.message}`);
    throw error;
  }
}

/** Replaces the deferred answer ("thinking…") with the real one. */
export async function editOriginal(i: Interaction, data: MessageData) {
  await discord('PATCH', `/webhooks/${discordConfig().appId}/${i.token}/messages/@original`, { allowed_mentions: { parse: [] }, ...data });
}

/** A string option of a slash command. */
export const opt = (i: Interaction, name: string) => {
  const o = i.data?.options?.find((x) => x.name === name);
  return o === undefined ? undefined : String(o.value);
};
/** The value of a modal field. */
export const field = (i: Interaction, id: string) => i.data?.components?.flatMap((r) => r.components).find((c) => c.custom_id === id)?.value ?? '';
