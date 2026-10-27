import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { activity, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { layoutMail, mailConfig, sendMail } from '@/server/mail';
import { deviceLabel } from '@/lib/device';
import { dateTime } from '@/lib/format';
import { cancelDeletion } from './account-close';
import { t } from '@/i18n/t';

/** A device unknown for this long counts as new again. */
const KNOWN_DAYS = 180;

/**
 * 1.1.3, after a successful sign-in: remembers the device, cancels a pending
 * profile deletion and mails the player when the device is new to the profile.
 * Never fails the sign-in.
 */
export async function afterLogin(db: Database, userId: string, userAgent: string | null, base: string, now = new Date()) {
  try {
    const device = deviceLabel(userAgent);
    const since = new Date(now.getTime() - KNOWN_DAYS * 86_400_000);
    const [seen] = await db.select({ id: activity.id }).from(activity).where(and(eq(activity.userId, userId), eq(activity.action, 'login_device'), gte(activity.createdAt, since), sql`${activity.details}->>'device' = ${device}`)).limit(1);
    const [anyBefore] = await db.select({ id: activity.id }).from(activity).where(and(eq(activity.userId, userId), eq(activity.action, 'login_device'))).limit(1);
    await db.insert(activity).values({ userId, action: 'login_device', details: { device }, createdAt: now });
    await cancelDeletion(db, userId);
    // The very first recorded sign-in is not "a new device" (the player just started using this).
    if (seen || !anyBefore || !(await featureFor(db, userId, 'login_alert', now)) || !mailConfig().enabled) return;
    const [u] = await db.select({ email: users.email, username: users.username, verified: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
    if (!u?.verified) return;
    await sendMail(
      layoutMail({
        to: u.email,
        subject: t('Вход в TransVerse от ново устройство'),
        heading: t('Здравей, {0}!', u.username),
        lines: [t('Някой влезе в профила ти от {0} на {1}.', device, dateTime(now)), t('Ако си ти — всичко е наред. Ако не си, смени паролата и излез от всички други устройства.')],
        button: { label: t('Към сигурността'), url: `${base}/game/settings` },
        footer: t('Писмото се праща, когато влезеш от устройство, което не сме виждали последните 6 месеца.'),
      }),
      'login_alert',
      userId,
    );
  } catch (error) {
    console.error('[login] after-login failed', error);
  }
}

/** 1.1.3, admin: the player's sign-ins of the last days (device and time). */
export async function loginHistory(db: Database, userId: string, now: Date, days = 30) {
  const rows = await db
    .select({ at: activity.createdAt, details: activity.details })
    .from(activity)
    .where(and(eq(activity.userId, userId), eq(activity.action, 'login_device'), gte(activity.createdAt, new Date(now.getTime() - days * 86_400_000))))
    .orderBy(desc(activity.createdAt))
    .limit(100);
  return rows.map((r) => ({ at: r.at, device: String((r.details as { device?: string }).device ?? '') }));
}
