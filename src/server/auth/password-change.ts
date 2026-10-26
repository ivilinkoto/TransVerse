import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/server/db/client';
import { sessions, users } from '@/server/db/schema';
import { fail } from '@/server/game/errors';
import { logActivity } from '@/server/game/notify';
import { hashPassword, verifyPassword } from './password';
import { t } from '@/i18n/t';

export const passwordSchema = z.object({
  current: z.string().min(1, 'Въведете текущата парола.').max(200),
  next: z.string().min(6, 'Новата парола трябва да е поне 6 символа.').max(200),
});

/** Changes the password and signs out every other session. */
export async function changePassword(db: Database, userId: string, sessionId: string | null, input: z.infer<typeof passwordSchema>) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !(await verifyPassword(user.passwordHash, input.current))) fail('invalid_password', t('Текущата парола е грешна.'), 400);
  await db.update(users).set({ passwordHash: await hashPassword(input.next) }).where(eq(users.id, userId));
  await db.delete(sessions).where(sessionId ? and(eq(sessions.userId, userId), ne(sessions.id, sessionId)) : eq(sessions.userId, userId));
  await logActivity(db, userId, 'password_changed');
}

/** 1.1.2: a new e-mail address, confirmed with the password; it must be confirmed again by mail. */
export const emailChangeSchema = z.object({
  password: z.string().min(1, 'Въведете текущата парола.').max(200),
  email: z.string().trim().toLowerCase().email('Невалиден имейл адрес.').max(254),
});

export async function changeEmail(db: Database, userId: string, input: z.infer<typeof emailChangeSchema>) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) fail('invalid_password', t('Текущата парола е грешна.'), 400);
  if (user!.email.toLowerCase() === input.email) fail('same_email', t('Това вече е вашият имейл.'));
  const [taken] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`);
  if (taken) fail('already_registered', t('Този имейл вече се използва.'), 409);
  try {
    await db.update(users).set({ email: input.email, emailVerifiedAt: null }).where(eq(users.id, userId));
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === '23505' || (error as { code?: string }).code === '23505') fail('already_registered', t('Този имейл вече се използва.'), 409);
    throw error;
  }
  await logActivity(db, userId, 'email_changed', { from: user!.email, to: input.email });
}
