import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { recordAudit, requireAdminRole } from '@/server/admin';

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
});

export interface Broadcast {
  text: string;
  tone: (typeof BROADCAST_TONES)[number];
  /** When it was set — players hide one message, the next one shows again. */
  setAt: string;
  until: string;
}

function parse(value: unknown): Broadcast | null {
  const v = value as Partial<Broadcast> | null;
  if (!v || typeof v.text !== 'string' || !v.text || typeof v.until !== 'string' || typeof v.setAt !== 'string') return null;
  return { text: v.text, tone: v.tone === 'warning' ? 'warning' : 'info', setAt: v.setAt, until: v.until };
}

/** The message players see now (none when cleared or expired). */
export async function activeBroadcast(db: DbOrTx, now: Date): Promise<Broadcast | null> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, KEY));
  const b = parse(row?.value);
  return b && new Date(b.until) > now ? b : null;
}

/** Sets the message (empty text clears it). Administrators only; audited. */
export async function setBroadcast(db: DbOrTx, actor: { id: string; role: string }, input: z.input<typeof broadcastSchema>, now: Date) {
  requireAdminRole(actor);
  const { text, tone, hours } = broadcastSchema.parse(input);
  const value = text ? { text, tone, setAt: now.toISOString(), until: new Date(now.getTime() + hours * 3_600_000).toISOString() } : {};
  await db.insert(jobState).values({ key: KEY, value }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: now } });
  await recordAudit(db, actor.id, 'broadcast_banner', null, text ? { text, tone, hours } : { cleared: true });
  return text ? (value as Broadcast) : null;
}
