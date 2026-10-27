import { randomBytes } from 'node:crypto';
import { and, eq, like, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, DbOrTx } from '@/server/db/client';
import { friendships, jobState, pushSubscriptions, sessions, userAvatars, users } from '@/server/db/schema';
import { fail } from '@/server/game/errors';
import { dissolveCompany, leaveCompany, memberCount, membershipOf } from '@/server/game/membership';
import { logActivity, notify } from '@/server/game/notify';
import { layoutMail, sendMail } from '@/server/mail';
import { deviceLabel } from '@/lib/device';
import { date } from '@/lib/format';
import { hashPassword, verifyPassword } from './password';
import { isStaff } from './roles';
import { t } from '@/i18n/t';

/** 1.1.3: sign out every other device (this one stays signed in). */
export async function signOutOthers(db: Database, userId: string, sessionId: string | null) {
  const gone = await db.delete(sessions).where(sessionId ? and(eq(sessions.userId, userId), ne(sessions.id, sessionId)) : eq(sessions.userId, userId)).returning({ id: sessions.id });
  await logActivity(db, userId, 'signed_out_others', { sessions: gone.length });
  return gone.length;
}

/** The part of a session id shown to the browser (the id is a digest; even so, only a prefix leaves the server). */
const KEY_LENGTH = 16;

/** 1.1.3: the devices signed in to the profile, this one first. */
export async function listSessions(db: DbOrTx, userId: string, sessionId: string | null) {
  const rows = await db.select().from(sessions).where(eq(sessions.userId, userId));
  return rows
    .map((s) => ({ key: s.id.slice(0, KEY_LENGTH), device: deviceLabel(s.userAgent), createdAt: s.createdAt, current: s.id === sessionId }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.createdAt.getTime() - a.createdAt.getTime());
}

/** Signs out one device (not this one — that is "Изход"). */
export async function signOutSession(db: Database, userId: string, key: string, sessionId: string | null) {
  if (!/^[0-9a-f]{16}$/.test(key)) fail('session_not_found', t('Устройството не е намерено.'), 404);
  if (sessionId?.startsWith(key)) fail('current_session', t('Това е устройството, от което си сега — излез от менюто на профила.'));
  const gone = await db.delete(sessions).where(and(eq(sessions.userId, userId), like(sessions.id, `${key}%`))).returning({ id: sessions.id });
  if (!gone.length) fail('session_not_found', t('Устройството не е намерено.'), 404);
  await logActivity(db, userId, 'signed_out_device');
}

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Въведете паролата си.').max(200),
  /** The username, typed again. */
  confirm: z.string().trim().max(60),
});

/** 1.1.3: a deletion waits this long; signing in again cancels it. */
export const DELETION_GRACE_DAYS = 7;
const PENDING = 'account-delete:';

export async function pendingDeletion(db: DbOrTx, userId: string): Promise<Date | null> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, PENDING + userId));
  const at = (row?.value as { at?: string } | undefined)?.at;
  return at ? new Date(at) : null;
}

/** Fails when the profile cannot be deleted (team members; an owner with company members). */
async function checkDeletable(db: DbOrTx, user: { id: string; role: string }) {
  if (isStaff(user.role)) fail('staff_account', t('Профил от екипа не се изтрива оттук — първо поискай да ти махнат длъжността.'), 403);
  const membership = await membershipOf(db, user.id);
  if (membership?.rank.isOwner && (await memberCount(db, membership.company.id)) > 1) fail('owns_company', t('Компанията ти има членове — първо предай собствеността на някой от тях.'));
}

/**
 * 1.1.3: the player asks to delete their profile (GDPR): password and username.
 * Every device is signed out and the profile is deleted after
 * DELETION_GRACE_DAYS — signing in before then cancels it.
 */
export async function requestAccountDeletion(db: Database, userId: string, input: z.input<typeof deleteAccountSchema>, base: string, now = new Date()) {
  const { password, confirm } = deleteAccountSchema.parse(input);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !(await verifyPassword(user.passwordHash, password))) fail('invalid_password', t('Паролата е грешна.'), 400);
  if (confirm.toLowerCase() !== user!.username.toLowerCase()) fail('confirm_mismatch', t('Напиши потребителското си име точно, за да потвърдиш.'));
  await checkDeletable(db, user!);
  const at = new Date(now.getTime() + DELETION_GRACE_DAYS * 86_400_000);
  await db.insert(jobState).values({ key: PENDING + userId, value: { at: at.toISOString() } }).onConflictDoUpdate({ target: jobState.key, set: { value: { at: at.toISOString() }, updatedAt: now } });
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await logActivity(db, userId, 'account_deletion_requested', { at: at.toISOString() });
  await sendMail(
    layoutMail({
      to: user!.email,
      subject: t('Профилът ти в TransVerse ще бъде изтрит'),
      heading: t('Здравей, {0}!', user!.username),
      lines: [t('Поиска изтриване на профила си. Той ще бъде изтрит окончателно на {0}.', date(at)), t('Размисли ли? Просто влез в профила преди това — изтриването се отменя.')],
      button: { label: t('Влез и откажи'), url: `${base}/login` },
      footer: t('Ако не си поискал това, влез веднага и смени паролата си.'),
    }),
    'account',
    userId,
  ).catch((error) => console.error('[mail] deletion mail failed', error));
  return at;
}

/** Signing in during the grace period cancels the deletion. */
export async function cancelDeletion(db: DbOrTx, userId: string) {
  const gone = await db.delete(jobState).where(eq(jobState.key, PENDING + userId)).returning({ key: jobState.key });
  if (!gone.length) return false;
  await logActivity(db, userId, 'account_deletion_cancelled');
  await notify(db, userId, 'info', () => t('Изтриването на профила е отменено'), () => t('Влезе отново, затова профилът ти остава. Ако все пак искаш да го изтриеш, направи го пак от Настройки → Сигурност.'), '/game/settings');
  return true;
}

/**
 * Deletes the profile. Many game records point at the account (deliveries,
 * ledgers, leaderboards), so it is not removed but emptied: no e-mail, name,
 * password, Discord, avatar, sessions or friends are left, and nobody can sign
 * in to it again. A one-member company is closed first.
 */
export async function eraseAccount(db: Database, userId: string, now = new Date()) {
  const membership = await membershipOf(db, userId);
  if (membership?.rank.isOwner) await dissolveCompany(db, userId);
  else if (membership) await leaveCompany(db, userId);
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
    await tx.delete(jobState).where(eq(jobState.key, PENDING + userId));
    await logActivity(tx, userId, 'account_deleted');
  });
}

/** Worker: deletes the profiles whose grace period ended (a new company member in the meantime stops it). */
export async function runDueDeletions(db: Database, now: Date) {
  const rows = await db.select().from(jobState).where(like(jobState.key, `${PENDING}%`));
  let done = 0;
  for (const r of rows) {
    const at = (r.value as { at?: string }).at;
    if (!at || new Date(at) > now) continue;
    const userId = r.key.slice(PENDING.length);
    const [user] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, userId));
    try {
      if (!user) throw new Error('gone');
      await checkDeletable(db, user);
      await eraseAccount(db, userId, now);
      done++;
    } catch (error) {
      await db.delete(jobState).where(eq(jobState.key, r.key));
      if (user) await notify(db, userId, 'warning', () => t('Профилът не беше изтрит'), () => t('{0} Изтриването е отменено.', error instanceof Error ? error.message : ''), '/game/settings');
    }
  }
  return done;
}
