import { sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';

/**
 * 1.1.4: tables that only grow get trimmed once a night (in batches, so no
 * long locks): sessions that expired, activity older than half a year (each
 * player's last sign-in device is kept — it decides what "a new device" is)
 * and notifications read more than 90 days ago.
 */
export const HOUSEKEEPING = { activityDays: 180, readNotificationDays: 90, batch: 20_000 } as const;

export async function housekeeping(db: Database, now: Date) {
  const day = 86_400_000;
  const sessions = await db.execute(sql`delete from sessions where expires_at < ${now}`);
  const activityCutoff = new Date(now.getTime() - HOUSEKEEPING.activityDays * day);
  const activity = await db.execute(sql`
    delete from activity where id in (
      select a.id from activity a
      where a.created_at < ${activityCutoff}
        and not (a.action = 'login_device' and a.id = (select max(b.id) from activity b where b.user_id = a.user_id and b.action = 'login_device'))
      limit ${HOUSEKEEPING.batch}
    )`);
  const readCutoff = new Date(now.getTime() - HOUSEKEEPING.readNotificationDays * day);
  const notifications = await db.execute(sql`
    delete from notifications where id in (
      select id from notifications where read_at is not null and created_at < ${readCutoff} limit ${HOUSEKEEPING.batch}
    )`);
  return { sessions: sessions.rowCount ?? 0, activity: activity.rowCount ?? 0, notifications: notifications.rowCount ?? 0 };
}
