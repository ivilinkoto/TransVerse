import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/server/db/client';
import { sessions, users } from '@/server/db/schema';
import { fail } from '@/server/game/errors';
import { logActivity } from '@/server/game/notify';
import { hashPassword, verifyPassword } from './password';

export const passwordSchema = z.object({
  current: z.string().min(1, 'Въведете текущата парола.').max(200),
  next: z.string().min(10, 'Новата парола трябва да е поне 10 символа.').max(200),
});

/** Changes the password and signs out every other session. */
export async function changePassword(db: Database, userId: string, sessionId: string | null, input: z.infer<typeof passwordSchema>) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !(await verifyPassword(user.passwordHash, input.current))) fail('invalid_password', 'Текущата парола е грешна.', 400);
  await db.update(users).set({ passwordHash: await hashPassword(input.next) }).where(eq(users.id, userId));
  await db.delete(sessions).where(sessionId ? and(eq(sessions.userId, userId), ne(sessions.id, sessionId)) : eq(sessions.userId, userId));
  await logActivity(db, userId, 'password_changed');
}
