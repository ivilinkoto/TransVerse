/**
 * 1.2.3 „Докато спеше“ (feature `morning_report`): one notification in the
 * morning (Sofia time, from 7:00) with what happened overnight — trips that
 * arrived, the money they brought, trucks that wait and the daily reward.
 * Once a day per player (key in job_state); nothing is sent when nothing happened.
 */
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { money } from '@/lib/format';
import { sofiaDay } from '@/lib/game/shop-v2';
import { dayKey } from '@/lib/game/daily';
import type { Database } from '@/server/db/client';
import { companies, deliveries, jobState, users, vehicles } from '@/server/db/schema';
import { notify } from './notify';
import { t } from '@/i18n/t';

export const MORNING = { fromHour: 7, toHour: 11, activeDays: 7, maxPlayers: 500 } as const;

const sofiaHour = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23' }).format(now));

/** The start of the night: 22:00 Sofia time the evening before (12 hours back is close enough at 10:00). */
const nightStart = (now: Date) => new Date(now.getTime() - (sofiaHour(now) + 2) * 3_600_000);

/** Worker: the morning reports for players seen in the last week (staff only before the release). */
export async function morningReports(db: Database, now = new Date()) {
  const hour = sofiaHour(now);
  if (hour < MORNING.fromHour || hour >= MORNING.toHour) return 0;
  const live = featureLive('morning_report', now);
  const since = new Date(now.getTime() - MORNING.activeDays * 86_400_000);
  const day = sofiaDay(now);
  const players = await db
    .select({ id: users.id, role: users.role, dailyKey: users.dailyClaimKey })
    .from(users)
    .where(and(gte(users.lastSeenAt, since), isNull(users.bannedAt), ...(live ? [] : [sql`${users.role} <> 'player'`])))
    .limit(MORNING.maxPlayers);
  if (!players.length) return 0;
  const accounts = await db.select({ id: companies.id, ownerId: companies.ownerId }).from(companies).where(inArray(companies.ownerId, players.map((p) => p.id)));
  const accountOf = new Map(accounts.map((a) => [a.ownerId, a.id]));
  const from = nightStart(now);
  let sent = 0;
  for (const p of players) {
    const companyId = accountOf.get(p.id);
    if (!companyId) continue;
    const [first] = await db.insert(jobState).values({ key: `morning:${p.id}:${day}`, value: { at: now.toISOString() } }).onConflictDoNothing().returning();
    if (!first) continue;
    const [trips] = await db
      .select({ n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${deliveries.payoutCents}), 0)::bigint` })
      .from(deliveries)
      .where(and(eq(deliveries.companyId, companyId), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, from)));
    const [idle] = await db.select({ n: sql<number>`count(*)::int` }).from(vehicles).where(and(eq(vehicles.companyId, companyId), eq(vehicles.status, 'idle'), isNull(vehicles.soldAt)));
    const n = trips?.n ?? 0, cents = Number(trips?.cents ?? 0), waiting = idle?.n ?? 0;
    if (!n && !waiting) continue;
    const parts: (() => string)[] = [];
    if (n) parts.push(() => (n === 1 ? t('1 курс пристигна (+{0})', money(cents)) : t('{0} курса пристигнаха (+{1})', n, money(cents))));
    if (waiting) parts.push(() => (waiting === 1 ? t('1 камион чака курс') : t('{0} камиона чакат курс', waiting)));
    if (p.dailyKey !== dayKey(now)) parts.push(() => t('дневната награда те чака'));
    await notify(db, p.id, 'info', () => t('Добро утро! Докато спеше:'), () => parts.map((f) => f()).join(' · '), '/game');
    sent++;
  }
  return sent;
}
