import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { companies, deliveries, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { sofiaMidnight } from '@/lib/game/missions';
import { notify } from './notify';
import { t, intlLocale } from '@/i18n/t';

/** 1.1.4 „Моят ден“: the evening summary goes out at this hour (Sofia), to players who switched it on. */
export const MY_DAY_HOUR = 20;

function sofiaToday(now: Date) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number) as [number, number, number];
  return sofiaMidnight(y, m, d);
}

/** Today's trips of a player's own account: count, km, net result. */
export async function myDay(db: Database, userId: string, now: Date) {
  const from = sofiaToday(now);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int`, km: sql<number>`coalesce(sum(${deliveries.loadedKm}), 0)::float`, cents: sql<number>`coalesce(sum(${deliveries.payoutCents}), 0)::bigint`, late: sql<number>`count(*) filter (where ${deliveries.late})::int` })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, from)));
  return { trips: row?.n ?? 0, km: Math.round(row?.km ?? 0), cents: Number(row?.cents ?? 0), late: row?.late ?? 0 };
}

/** Worker (once a day, at MY_DAY_HOUR): the summary for every player who asked for it and drove today. */
export async function sendMyDay(db: Database, now: Date) {
  const players = await db.select({ id: users.id }).from(users).where(and(sql`(${users.uiPrefs}->>'dailySummary')::boolean is true`, isNull(users.bannedAt))).limit(5000);
  let sent = 0;
  for (const p of players) {
    if (!(await featureFor(db, p.id, 'daily_summary', now))) continue;
    const day = await myDay(db, p.id, now);
    if (!day.trips) continue;
    await notify(
      db,
      p.id,
      'info',
      () => t('Моят ден: {0} курса, {1} км', day.trips, day.km.toLocaleString(intlLocale())),
      () => t('Нетен резултат днес: {0} лв.{1} Добра почивка!', (day.cents / 100).toLocaleString(intlLocale(), { maximumFractionDigits: 0 }), day.late ? t(' Закъснели: {0}.', day.late) : t(' Всичко навреме.')),
      '/game/finance',
    );
    sent++;
  }
  return sent;
}
