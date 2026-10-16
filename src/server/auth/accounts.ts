import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { createIndependent } from '@/server/game/company';
import { fail } from '@/server/game/errors';
import { logActivity } from '@/server/game/notify';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Невалиден имейл адрес.').max(254),
  username: z
    .string()
    .trim()
    .min(3, 'Потребителското име трябва да е поне 3 символа.')
    .max(20, 'Потребителското име трябва да е до 20 символа.')
    .regex(/^[\p{L}\p{N}_.-]+$/u, 'Само букви, цифри, точка, тире и долна черта.'),
  password: z.string().min(10, 'Паролата трябва да е поне 10 символа.').max(200),
  /** Real Bulgarian city where the player's rented truck waits. */
  startCityId: z.coerce.number().int().positive(),
});

export const companyNameSchema = z.string().trim().min(3, 'Името на компанията трябва да е поне 3 символа.').max(40, 'До 40 символа.');

export const loginSchema = z.object({
  login: z.string().trim().min(1, 'Въведете имейл или потребителско име.').max(254),
  password: z.string().min(1, 'Въведете парола.').max(200),
});

export async function register(db: Database, raw: z.infer<typeof registerSchema>) {
  const input = { ...raw, email: raw.email.trim().toLowerCase(), username: raw.username.trim() };
  const passwordHash = await hashPassword(input.password);
  try {
    return await registerTx(db, input, passwordHash);
  } catch (error) {
    // Two simultaneous sign-ups with the same name: the unique index decides.
    if ((error as { cause?: { code?: string } }).cause?.code === '23505' || (error as { code?: string }).code === '23505') {
      fail('already_registered', 'Имейлът или потребителското име вече са заети.', 409);
    }
    throw error;
  }
}

function registerTx(db: Database, input: z.infer<typeof registerSchema>, passwordHash: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ email: users.email, username: users.username })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email} or lower(${users.username}) = lower(${input.username})`);
    if (existing) {
      if (existing.email.toLowerCase() === input.email) fail('email_taken', 'Този имейл вече е регистриран.', 409);
      fail('username_taken', 'Това потребителско име е заето.', 409);
    }
    const [user] = await tx.insert(users).values({ email: input.email, username: input.username, passwordHash }).returning({ id: users.id });
    await createIndependent(tx, { userId: user!.id, username: input.username, startCityId: input.startCityId });
    await logActivity(tx, user!.id, 'registered');
    return user!.id;
  });
}

export async function authenticate(db: Database, input: z.infer<typeof loginSchema>): Promise<string> {
  const login = input.login.toLowerCase();
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash, bannedAt: users.bannedAt, banReason: users.banReason })
    .from(users)
    .where(sql`lower(${users.email}) = ${login} or lower(${users.username}) = ${login}`);
  const ok = user ? await verifyPassword(user.passwordHash, input.password) : await verifyAgainstDummy(input.password);
  if (!user || !ok) fail('invalid_credentials', 'Грешен имейл/потребител или парола.', 401);
  if (user!.bannedAt) fail('banned', `Профилът е блокиран${user!.banReason ? `: ${user!.banReason}` : ''}. Свържете се с поддръжката.`, 403);
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user!.id));
  await logActivity(db, user!.id, 'login');
  return user!.id;
}
