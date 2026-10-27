import { randomBytes } from 'node:crypto';
import { and, eq, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/server/db/client';
import { friendships, pushSubscriptions, sessions, userAvatars, users } from '@/server/db/schema';
import { fail } from '@/server/game/errors';
import { dissolveCompany, leaveCompany, memberCount, membershipOf } from '@/server/game/membership';
import { logActivity } from '@/server/game/notify';
import { hashPassword, verifyPassword } from './password';
import { isStaff } from './roles';
import { t } from '@/i18n/t';

/** 1.1.3: sign out every other device (this one stays signed in). */
export async function signOutOthers(db: Database, userId: string, sessionId: string | null) {
  const gone = await db.delete(sessions).where(sessionId ? and(eq(sessions.userId, userId), ne(sessions.id, sessionId)) : eq(sessions.userId, userId)).returning({ id: sessions.id });
  await logActivity(db, userId, 'signed_out_others', { sessions: gone.length });
  return gone.length;
}

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Въведете паролата си.').max(200),
  /** The username, typed again. */
  confirm: z.string().trim().max(60),
});

/**
 * 1.1.3: the player deletes their profile (GDPR). Many game records point at the
 * account (deliveries, ledgers, leaderboards), so it is not removed but emptied:
 * no e-mail, name, password, Discord, avatar, sessions or friends are left, and
 * nobody can sign in to it again. A company owner with members hands it over first.
 */
export async function deleteAccount(db: Database, userId: string, input: z.input<typeof deleteAccountSchema>, now = new Date()) {
  const { password, confirm } = deleteAccountSchema.parse(input);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !(await verifyPassword(user.passwordHash, password))) fail('invalid_password', t('Паролата е грешна.'), 400);
  if (confirm.toLowerCase() !== user!.username.toLowerCase()) fail('confirm_mismatch', t('Напиши потребителското си име точно, за да потвърдиш.'));
  if (isStaff(user!.role)) fail('staff_account', t('Профил от екипа не се изтрива оттук — първо поискай да ти махнат длъжността.'), 403);
  const membership = await membershipOf(db, userId);
  if (membership?.rank.isOwner) {
    if ((await memberCount(db, membership.company.id)) > 1) fail('owns_company', t('Компанията ти има членове — първо предай собствеността на някой от тях.'));
    await dissolveCompany(db, userId);
  } else if (membership) {
    await leaveCompany(db, userId);
  }
  const tag = randomBytes(4).toString('hex');
  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        username: `deleted-${tag}`,
        email: `deleted+${userId}@deleted.invalid`,
        passwordHash,
        emailVerifiedAt: null,
        bannedAt: now,
        banReason: 'Профилът е изтрит по желание на играча.',
        discordId: null,
        discordName: null,
        discordLinkedAt: null,
        discordPrefs: {},
        pushPrefs: {},
        avatarVersion: 0,
        favoriteVehicleId: null,
        forHire: false,
        mentorOpen: false,
        referralCode: null,
        signupIpHash: null,
        showcase: { trucks: [], badges: [] },
      })
      .where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    await tx.delete(userAvatars).where(eq(userAvatars.userId, userId));
    await tx.delete(friendships).where(or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)));
    await logActivity(tx, userId, 'account_deleted');
  });
}
