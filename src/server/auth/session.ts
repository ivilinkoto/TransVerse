import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { sessions, users } from '@/server/db/schema';

export const SESSION_COOKIE = 'tv_session';
const SESSION_DAYS = 30;
const RENEW_WHEN_DAYS_LEFT = 15;

/** Sessions are stored by the SHA-256 of their token. */
export const sessionDigest = (token: string) => createHash('sha256').update(token).digest('hex');
const digest = sessionDigest;

export async function createSession(db: DbOrTx, userId: string, userAgent?: string | null) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: digest(token), userId, expiresAt, userAgent: userAgent?.slice(0, 300) ?? null });
  return { token, expiresAt };
}

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  level: number;
  xp: number;
  role: string;
}

/** Validates a session token; extends it when it is getting old (sliding expiry). */
export async function validateSession(db: DbOrTx, token: string | undefined): Promise<{ user: SessionUser; expiresAt: Date } | null> {
  if (!token || token.length > 100) return null;
  const id = digest(token);
  const [row] = await db
    .select({ session: sessions, user: { id: users.id, username: users.username, email: users.email, level: users.level, xp: users.xp, role: users.role, bannedAt: users.bannedAt } })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
  if (!row || row.user.bannedAt) return null;
  let expiresAt = row.session.expiresAt;
  if (expiresAt.getTime() - Date.now() < RENEW_WHEN_DAYS_LEFT * 86_400_000) {
    expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
  }
  const { bannedAt: _banned, ...user } = row.user;
  void _banned;
  return { user, expiresAt };
}

export async function revokeSession(db: DbOrTx, token: string | undefined) {
  if (token) await db.delete(sessions).where(eq(sessions.id, digest(token)));
}

export function sessionCookie(token: string, expiresAt: Date) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    expires: expiresAt,
  };
}
