import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { users } from '@/server/db/schema';

const g = globalThis as unknown as { tvSeen?: Map<string, number> };

/** Records that the player is in the game, at most once a minute per player and process. */
export async function touchLastSeen(db: DbOrTx, userId: string, force = false) {
  g.tvSeen ??= new Map();
  const now = Date.now();
  if (!force && now - (g.tvSeen.get(userId) ?? 0) < 60_000) return;
  g.tvSeen.set(userId, now);
  await db.update(users).set({ lastSeenAt: new Date(now) }).where(eq(users.id, userId));
}
