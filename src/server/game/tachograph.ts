import { and, desc, eq, gte, or } from 'drizzle-orm';
import { isMoving, type Segment } from '@/lib/game/schedule';
import type { DbOrTx } from '@/server/db/client';
import { deliveries } from '@/server/db/schema';

const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(new Date(ms));

/**
 * The tachograph (v1.5): a driver's driving and rest by day for the last
 * week, from the schedules of their trips (game time), and the trips that
 * broke the rest rules.
 */
export async function tachograph(db: DbOrTx, driverId: string, now = new Date(), days = 7) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const trips = await db
    .select({ schedule: deliveries.schedule, violations: deliveries.violations, startedAt: deliveries.startedAt })
    .from(deliveries)
    .where(and(or(eq(deliveries.driverId, driverId), eq(deliveries.coDriverId, driverId)), gte(deliveries.startedAt, since)))
    .orderBy(desc(deliveries.startedAt))
    .limit(100);
  const byDay = new Map<string, { driveMin: number; restMin: number; trips: number; violations: number }>();
  for (const t of trips) {
    const k = day(t.startedAt.getTime());
    const row = byDay.get(k) ?? { driveMin: 0, restMin: 0, trips: 0, violations: 0 };
    row.trips++;
    if (t.violations.includes('hours')) row.violations++;
    for (const s of t.schedule as Segment[]) {
      const min = Math.max(0, Math.min(s.end, now.getTime()) - s.start) / 60_000;
      if (s.kind === 'drive' && isMoving(s.kind)) row.driveMin += min;
      else if (s.kind === 'rest' || s.kind === 'break') row.restMin += min;
    }
    byDay.set(k, row);
  }
  return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, r]) => ({ date, driveMin: Math.round(r.driveMin), restMin: Math.round(r.restMin), trips: r.trips, violations: r.violations }));
}
