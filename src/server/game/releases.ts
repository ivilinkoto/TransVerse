import { eq, sql } from 'drizzle-orm';
import type { HintId } from '@/lib/game/hints';
import { compareVersions, releaseByVersion } from '@/lib/game/releases';
import type { DbOrTx } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { fail } from './errors';
import { t } from '@/i18n/t';

/** The player closed the "Какво ново" window of a version (never goes back to an older one). */
export async function markReleaseSeen(db: DbOrTx, userId: string, version: string) {
  if (!releaseByVersion(version)) fail('unknown_version', t('Непозната версия.'));
  const [u] = await db.select({ seen: users.seenVersion }).from(users).where(eq(users.id, userId));
  if (u?.seen && compareVersions(u.seen, version) >= 0) return;
  await db.update(users).set({ seenVersion: version }).where(eq(users.id, userId));
}

export async function setSeasonalTheme(db: DbOrTx, userId: string, on: boolean) {
  await db.update(users).set({ seasonalTheme: on }).where(eq(users.id, userId));
}

/** The player closed a one-time hint. */
export async function dismissHint(db: DbOrTx, userId: string, hint: HintId) {
  await db.update(users).set({ seenHints: sql`array_append(array_remove(${users.seenHints}, ${hint}), ${hint})` }).where(eq(users.id, userId));
}
