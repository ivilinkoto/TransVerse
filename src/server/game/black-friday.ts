/**
 * 1.3.2.4: on the first morning of Black Friday every player seen in the last
 * 30 days gets one notification (once a year: `job_state` `bf-notice:<year>`).
 */
import { and, gt, isNull } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { BLACK_FRIDAY, BLACK_FRIDAY_MORE, BLACK_FRIDAY_TEASE, isBlackFriday } from '@/lib/game/prewinter';
import type { Database } from '@/server/db/client';
import { jobState, users } from '@/server/db/schema';
import { notify } from './notify';
import { t } from '@/i18n/t';

const sofiaHour = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hour12: false }).format(now));

export async function blackFridayNotice(db: Database, now = new Date()) {
  if (!isBlackFriday(now) || !featureLive('black_friday', now) || sofiaHour(now) < BLACK_FRIDAY_TEASE.noticeHour) return 0;
  const year = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', year: 'numeric' }).format(now);
  const [first] = await db.insert(jobState).values({ key: `bf-notice:${year}`, value: { at: now.toISOString() }, updatedAt: now }).onConflictDoNothing().returning({ key: jobState.key });
  if (!first) return 0;
  const active = await db.select({ id: users.id }).from(users).where(and(gt(users.lastSeenAt, new Date(now.getTime() - 30 * 86_400_000)), isNull(users.bannedAt)));
  const off = Math.round(BLACK_FRIDAY.discount * 100);
  const more = Math.round(BLACK_FRIDAY_MORE.packBonus * 100);
  for (const u of active) {
    await notify(db, u.id, 'info', () => t('🛍 Черен петък започна!'), () => t('До 30 ноември: −{0}% в магазина (и на частите, премиум камионите и местата в депото), +{1}% ТрансКоин на всеки пакет и Пакет „Черен петък“.', off, more), '/game/shop');
  }
  return active.length;
}
