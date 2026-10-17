import { eq, sql } from 'drizzle-orm';
import { sniffImage } from '@/lib/game/company';
import type { Database, DbOrTx } from '@/server/db/client';
import { userAvatars, users } from '@/server/db/schema';
import { fail } from './errors';
import { logActivity } from './notify';

/** The browser resizes to 256×256 before uploading; this is a safety cap. */
export const AVATAR_MAX_BYTES = 200 * 1024;

export async function setAvatar(db: Database, userId: string, bytes: Uint8Array) {
  if (bytes.length > AVATAR_MAX_BYTES) fail('too_large', `Снимката е твърде голяма (най-много ${AVATAR_MAX_BYTES / 1024} KB).`);
  const mime = sniffImage(bytes);
  if (!mime) fail('bad_image', 'Позволени са само PNG, JPEG и WebP изображения.');
  const data = Buffer.from(bytes);
  await db.transaction(async (tx) => {
    await tx.insert(userAvatars).values({ userId, mime: mime!, data }).onConflictDoUpdate({ target: userAvatars.userId, set: { mime: mime!, data, updatedAt: new Date() } });
    await tx.update(users).set({ avatarVersion: sql`${users.avatarVersion} + 1` }).where(eq(users.id, userId));
    await logActivity(tx, userId, 'avatar_uploaded', { bytes: bytes.length });
  });
}

export async function removeAvatar(db: Database, userId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(userAvatars).where(eq(userAvatars.userId, userId));
    await tx.update(users).set({ avatarVersion: 0 }).where(eq(users.id, userId));
  });
}

export async function getAvatar(db: DbOrTx, userId: string) {
  const [row] = await db.select().from(userAvatars).where(eq(userAvatars.userId, userId));
  return row ?? null;
}
