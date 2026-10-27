import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { recordAudit, requireAdminRole } from '@/server/admin';
import { announce } from '@/server/discord/outbox';
import { fail } from '@/server/game/errors';
import { featureLive } from '@/lib/game/features';
import { t } from '@/i18n/t';

/**
 * 1.1.3: one message from the team on top of every game page (maintenance,
 * an event starting, a known problem). Administrators set and clear it from the
 * admin panel; it ends by itself after the chosen hours.
 */
const KEY = 'setting:broadcast-banner';

export const BROADCAST_TONES = ['info', 'warning'] as const;

export const broadcastSchema = z.object({
  text: z.string().trim().max(240, 'До 240 знака.'),
  tone: z.enum(BROADCAST_TONES).default('info'),
  hours: z.coerce.number().int().min(1).max(24 * 14).default(24),
  /** 1.1.3: shown from this time (ISO; empty = now), for `hours` from then. */
  startsAt: z.string().datetime({ offset: true }).optional().or(z.literal('')),
  /** 1.1.3: also posted in the Discord announcements when it starts. */
  discord: z.boolean().default(false),
});

export interface Broadcast {
  text: string;
  tone: (typeof BROADCAST_TONES)[number];
  /** When it was set — players hide one message, the next one shows again. */
  setAt: string;
  /** From when players see it (1.1.3; older messages: from `setAt`). */
  startsAt: string;
  until: string;
  discord: boolean;
  /** The Discord post went out. */
  posted?: boolean;
}

function parse(value: unknown): Broadcast | null {
  const v = value as Partial<Broadcast> | null;
  if (!v || typeof v.text !== 'string' || !v.text || typeof v.until !== 'string' || typeof v.setAt !== 'string') return null;
  return { text: v.text, tone: v.tone === 'warning' ? 'warning' : 'info', setAt: v.setAt, startsAt: v.startsAt ?? v.setAt, until: v.until, discord: !!v.discord, posted: !!v.posted };
}

/** The message as set (scheduled, showing or over), for the admin panel. */
export async function storedBroadcast(db: DbOrTx): Promise<Broadcast | null> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, KEY));
  return parse(row?.value);
}

/** The message players see now (none when cleared, not started yet or expired). */
export async function activeBroadcast(db: DbOrTx, now: Date): Promise<Broadcast | null> {
  const b = await storedBroadcast(db);
  return b && new Date(b.startsAt) <= now && new Date(b.until) > now ? b : null;
}

/** Worker: posts a started message in the Discord announcements once (when asked for). */
export async function postBroadcastToDiscord(db: DbOrTx, now: Date) {
  const b = await activeBroadcast(db, now);
  if (!b || !b.discord || b.posted || !featureLive('discord_bot', now)) return false;
  await announce(db, `broadcast:${b.setAt}`, 'updates', { embeds: [{ title: b.tone === 'warning' ? '⚠️ TransVerse' : '📣 TransVerse', description: b.text, color: b.tone === 'warning' ? 0xf6c343 : 0x22d3ee }] }, now);
  await db.update(jobState).set({ value: { ...b, posted: true }, updatedAt: now }).where(eq(jobState.key, KEY));
  return true;
}

/** Sets the message (empty text clears it). Administrators only; audited. */
export async function setBroadcast(db: DbOrTx, actor: { id: string; role: string }, input: z.input<typeof broadcastSchema>, now: Date) {
  requireAdminRole(actor);
  const { text, tone, hours, startsAt, discord } = broadcastSchema.parse(input);
  const start = startsAt ? new Date(startsAt) : now;
  if (start.getTime() > now.getTime() + 30 * 86_400_000) fail('too_far', t('Най-много 30 дни напред.'));
  const from = start < now ? now : start;
  const value = text ? { text, tone, setAt: now.toISOString(), startsAt: from.toISOString(), until: new Date(from.getTime() + hours * 3_600_000).toISOString(), discord } : {};
  await db.insert(jobState).values({ key: KEY, value }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: now } });
  await recordAudit(db, actor.id, 'broadcast_banner', null, text ? { text, tone, hours, startsAt: from.toISOString(), discord } : { cleared: true });
  return text ? (value as Broadcast) : null;
}
