import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { countries, jobState, marketEvents, rateLimits, sessions } from '@/server/db/schema';
import { upgradeApproximateRoutes } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { replenishMarket } from './contracts';
import { migrateToGameTime, recoverDemand, settleDueDeliveries } from './deliveries';
import { broadcast } from './notify';
import { pick, randInt } from './random';
import { activeSeason, rotateSeasons } from './seasons';
import { runPayroll } from './staff';

/**
 * Background simulation of the persistent world. Every job is idempotent and
 * catches up after downtime, so restarting the worker never loses or doubles
 * anything. The browser plays no part in game time.
 */

const EVENT_TEMPLATES = [
  { title: 'Жътва', description: 'Сезонът на жътвата вдига търсенето на превоз на насипни товари.', cargoType: 'bulk', multiplier: 1.35 },
  { title: 'Строителен бум', description: 'Големи инфраструктурни проекти търсят специализиран транспорт.', cargoType: 'special', multiplier: 1.3 },
  { title: 'Горещи дни', description: 'Високите температури увеличават търсенето на хладилен транспорт.', cargoType: 'refrigerated', multiplier: 1.25 },
  { title: 'Пиково търсене в търговията', description: 'Веригите зареждат складове — палетите плащат повече.', cargoType: 'pallets', multiplier: 1.2 },
  { title: 'Задръстени пристанища', description: 'Пристанищата наваксват — контейнерните превози са по-скъпи.', cargoType: 'container', multiplier: 1.3 },
  { title: 'Отоплителен сезон', description: 'Търсенето на горива расте.', cargoType: 'liquid', multiplier: 1.25 },
] as const;
const EVENT_COUNTRIES = ['BG', 'RO', 'GR', 'TR', 'RS', 'MK', 'HU', 'AT', 'DE'];

async function lastRun(db: Database, key: string): Promise<number> {
  const [row] = await db.select().from(jobState).where(eq(jobState.key, key));
  return row ? Number((row.value as { at: number }).at) : 0;
}
async function markRun(db: Database, key: string, at: number) {
  await db.insert(jobState).values({ key, value: { at } }).onConflictDoUpdate({ target: jobState.key, set: { value: { at }, updatedAt: new Date() } });
}

async function every(db: Database, key: string, intervalMs: number, now: Date, fn: (elapsedMs: number) => Promise<unknown>) {
  const last = await lastRun(db, key);
  if (now.getTime() - last < intervalMs) return;
  await fn(last ? now.getTime() - last : intervalMs);
  await markRun(db, key, now.getTime());
}

export async function spawnMarketEvent(db: Database, now: Date) {
  const active = await db.select({ id: marketEvents.id }).from(marketEvents).where(and(lte(marketEvents.startsAt, now), gt(marketEvents.endsAt, now)));
  if (active.length >= 3) return;
  const t = pick(EVENT_TEMPLATES);
  const country = pick(EVENT_COUNTRIES);
  const [c] = await db.select({ nameBg: countries.nameBg }).from(countries).where(eq(countries.code, country));
  await db.insert(marketEvents).values({
    title: `${t.title}: ${c?.nameBg ?? country}`,
    description: `${t.description} (игрово събитие)`,
    countryCode: country,
    cargoType: t.cargoType,
    multiplier: t.multiplier,
    startsAt: now,
    endsAt: new Date(now.getTime() + randInt(24, 72) * 3_600_000),
  });
  await broadcast(db, 'market');
}

/** One pass of the world simulation. Guarded by an advisory lock so only one runner works at a time. */
export async function worldTick(db: Database, now = new Date(), provider?: RoutingProvider) {
  const { rows } = await db.execute<{ locked: boolean }>(sql`select pg_try_advisory_lock(424242) as locked`);
  if (!rows[0]?.locked) return { skipped: true };
  try {
    await migrateToGameTime(db);
    const settled = await settleDueDeliveries(db, now);
    await every(db, 'market', 5 * 60_000, now, () => replenishMarket(db, now, provider));
    await every(db, 'routes', 15 * 60_000, now, () => upgradeApproximateRoutes(db, 5, provider));
    await every(db, 'demand', 60 * 60_000, now, (elapsed) => recoverDemand(db, Math.min(48, elapsed / 3_600_000)));
    await every(db, 'events', 6 * 60 * 60_000, now, () => spawnMarketEvent(db, now));
    await every(db, 'seasons', 10 * 60_000, now, async () => {
      await activeSeason(db, now);
      await rotateSeasons(db, now);
    });
    // Payroll for the previous UTC day, once per day (idempotent per company/day).
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const [payroll] = await db.select().from(jobState).where(eq(jobState.key, 'payroll'));
    if ((payroll?.value as { day?: string } | undefined)?.day !== yesterday) {
      await runPayroll(db, yesterday);
      await db.insert(jobState).values({ key: 'payroll', value: { day: yesterday } }).onConflictDoUpdate({ target: jobState.key, set: { value: { day: yesterday }, updatedAt: now } });
    }
    await every(db, 'cleanup', 60 * 60_000, now, async () => {
      await db.delete(sessions).where(lte(sessions.expiresAt, now));
      await db.delete(rateLimits).where(lte(rateLimits.windowStart, new Date(now.getTime() - 86_400_000)));
    });
    return { skipped: false, settled };
  } finally {
    await db.execute(sql`select pg_advisory_unlock(424242)`);
  }
}
