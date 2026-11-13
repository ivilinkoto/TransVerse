/**
 * 1.3.1 „Екипът“ on the server: a player's application in job_state
 * `career-app:<user>` = { role, about, hours, contact, link, at, status, note }.
 * One per player (a new one replaces it while it is not decided). Admins read and decide;
 * an accepted player gets the „Екип TransVerse“ badge and a notification.
 */
import { desc, eq, inArray, like } from 'drizzle-orm';
import { CAREERS, careerRole, type ApplicationStatus, type CareerRole } from '@/lib/game/careers';
import type { Database, DbOrTx } from '@/server/db/client';
import { jobState, userBadges, users } from '@/server/db/schema';
import { t } from '@/i18n/t';
import { fail } from './errors';
import { notify } from './notify';

export interface Application { role: CareerRole; about: string; hours: number; contact: string; link: string; at: string; status: ApplicationStatus; note?: string }
const key = (userId: string) => `career-app:${userId}`;

export async function myApplication(db: DbOrTx, userId: string): Promise<Application | null> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(userId)));
  return (row?.value as Application | undefined) ?? null;
}

export async function applyForRole(db: Database, userId: string, input: { role: string; about: string; hours: number; contact: string; link?: string }, now: Date) {
  const role = careerRole(input.role);
  if (!role || !role.open) fail('no_role', t('Няма такава отворена позиция.'));
  const about = input.about.trim();
  if (about.length < 30) fail('too_short', t('Напиши поне няколко изречения за себе си.'));
  if (about.length > CAREERS.aboutMax) fail('too_long', t('Текстът е твърде дълъг.'));
  const contact = input.contact.trim().slice(0, CAREERS.contactMax);
  if (!contact) fail('no_contact', t('Остави Discord име или друг начин за връзка.'));
  const link = (input.link ?? '').trim().slice(0, CAREERS.linkMax);
  if (link && !/^https?:\/\//i.test(link)) fail('bad_link', t('Линкът трябва да започва с https://'));
  const old = await myApplication(db, userId);
  if (old && (old.status === 'accepted' || old.status === 'interview')) fail('decided', t('Вече разговаряме с теб — ще се свържем.'));
  const app: Application = { role: role!.id, about, hours: Math.max(1, Math.min(40, Math.round(input.hours))), contact, link, at: now.toISOString(), status: 'new' };
  await db.insert(jobState).values({ key: key(userId), value: app }).onConflictDoUpdate({ target: jobState.key, set: { value: app, updatedAt: now } });
  return { ok: true };
}

/** For the admins: the applications, newest first, with the player's name and level. */
export async function listApplications(db: DbOrTx, status?: ApplicationStatus) {
  const rows = await db.select({ key: jobState.key, value: jobState.value, updatedAt: jobState.updatedAt }).from(jobState).where(like(jobState.key, 'career-app:%')).orderBy(desc(jobState.updatedAt)).limit(500);
  const ids = rows.map((r) => r.key.slice('career-app:'.length));
  const people = ids.length ? await db.select({ id: users.id, username: users.username, level: users.level, createdAt: users.createdAt, lastSeenAt: users.lastSeenAt }).from(users).where(inArray(users.id, ids)) : [];
  return rows
    .map((r) => ({ userId: r.key.slice('career-app:'.length), ...(r.value as Application), player: people.find((p) => p.id === r.key.slice('career-app:'.length)) ?? null }))
    .filter((a) => !status || a.status === status);
}

export async function setApplicationStatus(db: Database, userId: string, status: ApplicationStatus, note: string | undefined, now: Date) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(userId))).for('update');
    if (!row) fail('not_found', t('Няма такава кандидатура.'), 404);
    const app = { ...(row!.value as Application), status, ...(note !== undefined ? { note: note.slice(0, 500) } : {}) };
    await tx.update(jobState).set({ value: app, updatedAt: now }).where(eq(jobState.key, key(userId)));
    const label = careerRole(app.role)?.label ?? app.role;
    if (status === 'accepted') {
      await tx.insert(userBadges).values({ userId, badge: CAREERS.badge, awardedAt: now }).onConflictDoNothing();
      await notify(tx, userId, 'achievement', () => t('Добре дошъл в екипа на TransVerse!'), () => t('Приет си за „{0}“. Значка „Екип TransVerse“ — ще се свържем с теб за следващите стъпки.', label), '/game/careers');
    } else if (status === 'interview') {
      await notify(tx, userId, 'info', () => t('Кандидатурата ти ни хареса'), () => t('Искаме да поговорим за „{0}“ — ще ти пишем в Discord.', label), '/game/careers');
    } else if (status === 'rejected') {
      await notify(tx, userId, 'info', () => t('Благодарим за кандидатурата'), () => t('Този път избрахме друг човек за „{0}“, но ще те имаме предвид, когато търсим отново.', label), '/game/careers');
    }
    return { ok: true };
  });
}
