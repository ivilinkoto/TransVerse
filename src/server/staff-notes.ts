import { eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { jobState, users } from '@/server/db/schema';
import { recordAudit, requireStaff, type Staff } from '@/server/admin';
import { fail } from '@/server/game/errors';
import { t } from '@/i18n/t';

/**
 * 1.1.3.5: a short note about a player that only the team sees ("предупреден
 * за спам"), on the player's page in the admin panel. Kept in job_state;
 * every change is in the audit log.
 */
export interface StaffNote {
  note: string;
  by: string;
  at: string;
}

const key = (userId: string) => `staff-note:${userId}`;

export async function staffNote(db: DbOrTx, userId: string): Promise<StaffNote | null> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(userId)));
  const v = row?.value as StaffNote | undefined;
  return v?.note ? v : null;
}

/** Notes of many players at once (the users list). */
export async function staffNotes(db: DbOrTx, userIds: string[]) {
  if (!userIds.length) return new Map<string, StaffNote>();
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(inArray(jobState.key, userIds.map(key)));
  return new Map(rows.filter((r) => (r.value as StaffNote).note).map((r) => [r.key.slice('staff-note:'.length), r.value as StaffNote]));
}

export async function setStaffNote(db: DbOrTx, actor: Staff | null, userId: string, note: string, now = new Date()) {
  requireStaff(actor);
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!target) fail('user_not_found', t('Потребителят не е намерен.'), 404);
  const text = note.trim().slice(0, 500);
  if (!text) await db.delete(jobState).where(eq(jobState.key, key(userId)));
  else {
    const value: StaffNote = { note: text, by: actor.username, at: now.toISOString() };
    await db.insert(jobState).values({ key: key(userId), value }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: now } });
  }
  await recordAudit(db, actor.id, 'staff_note', userId, { note: text });
}
