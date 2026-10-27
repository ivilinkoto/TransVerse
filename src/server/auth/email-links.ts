/**
 * E-mail links: confirming the address and resetting a forgotten password.
 * Tokens are random, single-use, short-lived, and only their SHA-256 is stored.
 * "Forgot password" never reveals whether an address is registered.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, DbOrTx } from '@/server/db/client';
import { emailTokens, sessions, users } from '@/server/db/schema';
import { fail } from '@/server/game/errors';
import { logActivity } from '@/server/game/notify';
import { layoutMail, mailConfig, sendMail } from '@/server/mail';
import { hashPassword } from './password';
import { rateLimit } from './rate-limit';
import { rewardVerifiedEmail } from './email-reward';
import { t } from '@/i18n/t';

export type LinkKind = 'verify' | 'reset';
const TTL: Record<LinkKind, number> = { verify: 48 * 3_600_000, reset: 60 * 60_000 };

const sha = (token: string) => createHash('sha256').update(token).digest('hex');

/** Creates a single-use token (older unused ones of the same kind stop working). */
export async function createLinkToken(db: DbOrTx, userId: string, kind: LinkKind, now = new Date()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.update(emailTokens).set({ usedAt: now }).where(and(eq(emailTokens.userId, userId), eq(emailTokens.kind, kind), isNull(emailTokens.usedAt)));
  await db.insert(emailTokens).values({ userId, kind, tokenHash: sha(token), expiresAt: new Date(now.getTime() + TTL[kind]) });
  return token;
}

/** Uses a token exactly once; returns the user id or fails. */
async function consumeToken(db: DbOrTx, token: string, kind: LinkKind, now = new Date()): Promise<string> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) fail('invalid_link', t('Линкът е невалиден.'));
  const [row] = await db
    .update(emailTokens)
    .set({ usedAt: now })
    .where(and(eq(emailTokens.tokenHash, sha(token)), eq(emailTokens.kind, kind), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, now)))
    .returning({ userId: emailTokens.userId });
  if (!row) fail('invalid_link', kind === 'reset' ? t('Линкът за нова парола е невалиден или изтекъл. Поискайте нов.') : t('Линкът е невалиден или изтекъл. Изпратете нов от профила си.'));
  return row!.userId;
}

/** Is a reset link still usable (for showing the form)? Does not use it up. */
export async function resetLinkValid(db: DbOrTx, token: string, now = new Date()): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
  const [row] = await db.select({ id: emailTokens.id }).from(emailTokens).where(and(eq(emailTokens.tokenHash, sha(token)), eq(emailTokens.kind, 'reset'), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, now)));
  return !!row;
}

// ── Confirming the address ────────────────────────────────────────────────

/** Sends (or re-sends) the confirmation link. Returns false when e-mail is not configured. */
export async function sendVerification(db: Database, userId: string, base: string) {
  await rateLimit(db, `verify-mail:${userId}`, 3, 3600);
  const [u] = await db.select({ email: users.email, username: users.username, verified: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
  if (!u) fail('user_not_found', t('Профилът не е намерен.'), 404);
  if (u!.verified) fail('already_verified', t('Имейлът вече е потвърден.'), 409);
  const token = await createLinkToken(db, userId, 'verify');
  return sendMail(
    layoutMail({
      to: u!.email,
      subject: t('Потвърди имейла си в TransVerse'),
      heading: t('Здравей, {0}!', u!.username),
      lines: [t('Потвърди, че това е твоят имейл — така ще можеш да възстановиш профила си, ако забравиш паролата, и да правиш покупки.')],
      button: { label: t('Потвърди имейла'), url: `${base}/verify-email?token=${token}` },
      footer: t('Линкът важи 48 часа. Ако не си се регистрирал в TransVerse, просто игнорирай това писмо.'),
    }),
    'verify',
    userId,
  );
}

export async function verifyEmail(db: Database, token: string) {
  return db.transaction(async (tx) => {
    const userId = await consumeToken(tx, token, 'verify');
    await tx.update(users).set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` }).where(eq(users.id, userId));
    await logActivity(tx, userId, 'email_verified');
    // 1.1.3: +10 ТрансКоин, once per account.
    await rewardVerifiedEmail(tx, userId);
    return userId;
  });
}

// ── Forgotten password ────────────────────────────────────────────────────

export const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email('Невалиден имейл адрес.').max(254) });
export const resetSchema = z.object({
  token: z.string().max(100),
  password: z.string().min(6, 'Паролата трябва да е поне 6 символа.').max(200),
});

/** Sends a reset link if the address belongs to an active player. Always answers the same way. */
export async function requestPasswordReset(db: Database, raw: z.input<typeof forgotSchema>, ip: string, base: string) {
  const { email } = forgotSchema.parse(raw);
  await rateLimit(db, `reset-ip:${ip}`, 10, 3600);
  await rateLimit(db, `reset-mail:${email}`, 3, 3600);
  const [u] = await db.select({ id: users.id, username: users.username, email: users.email, bannedAt: users.bannedAt }).from(users).where(sql`lower(${users.email}) = ${email}`);
  if (!u || u.bannedAt) return { mailEnabled: mailConfig().enabled };
  const token = await createLinkToken(db, u.id, 'reset');
  await sendMail(
    layoutMail({
      to: u.email,
      subject: t('Нова парола за TransVerse'),
      heading: t('Здравей, {0}!', u.username),
      lines: [t('Поискана е нова парола за профила ти в TransVerse. Натисни бутона и въведи новата парола.')],
      button: { label: t('Задай нова парола'), url: `${base}/reset-password?token=${token}` },
      footer: t('Линкът важи 1 час и може да се използва веднъж. Ако не си искал нова парола, игнорирай писмото — старата остава.'),
    }),
    'reset',
    u.id,
  ).catch((error) => console.error('[mail] reset mail failed', error));
  await logActivity(db, u.id, 'password_reset_requested', { ip });
  return { mailEnabled: mailConfig().enabled };
}

/** Sets the new password, signs out everywhere and counts the address as confirmed. */
export async function resetPassword(db: Database, raw: z.input<typeof resetSchema>) {
  const input = resetSchema.parse(raw);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const userId = await consumeToken(tx, input.token, 'reset');
    await tx.update(users).set({ passwordHash, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` }).where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await logActivity(tx, userId, 'password_reset');
    await rewardVerifiedEmail(tx, userId);
    return userId;
  });
}
