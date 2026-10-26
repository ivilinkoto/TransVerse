import { and, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { int, money } from '@/lib/format';
import { HEADS_UP } from '@/lib/game/heads-up';
import type { Database } from '@/server/db/client';
import { cities, companies, contracts, deliveries, ledgerEntries, users, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { notify } from './notify';
import { t } from '@/i18n/t';

/**
 * Worker: tells the player a few minutes before a long trip ends, with a link
 * to the loads waiting at the destination. Players with Discord linked get
 * the richer Discord message instead (src/server/discord/relay.ts).
 */
export async function notifyArrivingSoon(db: Database, now = new Date()) {
  const soon = new Date(now.getTime() + HEADS_UP.soonMinutes * 60_000);
  const rows = await db
    .select({ id: deliveries.id, userId: users.id, plate: vehicles.plate, nickname: vehicles.nickname, vehicleId: vehicles.id, destId: contracts.destCityId, dest: cities.nameBg })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .innerJoin(vehicles, eq(vehicles.id, deliveries.vehicleId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .where(and(eq(deliveries.status, 'in_progress'), isNull(deliveries.soonNotifiedAt), isNull(users.discordId), gt(deliveries.etaAt, now), lte(deliveries.etaAt, soon), sql`${deliveries.etaAt} - ${deliveries.startedAt} >= make_interval(mins => ${HEADS_UP.soonMinTripMinutes})`))
    .limit(200);
  if (!rows.length) return 0;
  // Marked first, so a second worker or a retry never sends it twice.
  const marked = new Set((await db.update(deliveries).set({ soonNotifiedAt: now }).where(and(inArray(deliveries.id, rows.map((r) => r.id)), isNull(deliveries.soonNotifiedAt))).returning({ id: deliveries.id })).map((r) => r.id));
  let n = 0;
  for (const r of rows) {
    if (!marked.has(r.id) || !(await featureFor(db, r.userId, 'arriving_soon', now))) continue;
    const truck = r.nickname ? `${r.nickname} (${r.plate})` : r.plate;
    await notify(db, r.userId, 'info', () => t('{0} пристига в {1} след ~{2} мин', truck, t(r.dest), HEADS_UP.soonMinutes), () => t('Виж товарите, които те чакат там, за да тръгнеш веднага.'), `/game/contracts?from=${r.destId}&truck=${r.vehicleId}`);
    n++;
  }
  return n;
}

/** The week's numbers of every player who drove: trips, km, freight earned and their place by earnings. */
export async function weeklyNumbers(db: Database, now = new Date()) {
  const from = new Date(now.getTime() - HEADS_UP.weekDays * 86_400_000);
  const trips = await db
    .select({ companyId: deliveries.companyId, trips: sql<number>`count(*)::int`, km: sql<number>`coalesce(sum(${deliveries.emptyKm} + ${deliveries.loadedKm}), 0)::float` })
    .from(deliveries)
    .where(and(eq(deliveries.status, 'completed'), gt(deliveries.completedAt, from), lte(deliveries.completedAt, now)))
    .groupBy(deliveries.companyId);
  if (!trips.length) return [];
  const ids = trips.map((r) => r.companyId);
  const earned = await db
    .select({ companyId: ledgerEntries.companyId, cents: sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)::float` })
    .from(ledgerEntries)
    .where(and(inArray(ledgerEntries.companyId, ids), eq(ledgerEntries.category, 'freight'), gt(ledgerEntries.createdAt, from), lte(ledgerEntries.createdAt, now)))
    .groupBy(ledgerEntries.companyId);
  const owners = await db.select({ id: companies.id, userId: companies.ownerId }).from(companies).where(inArray(companies.id, ids));
  const cents = new Map(earned.map((e) => [e.companyId, Number(e.cents)]));
  const rows = trips.flatMap((r) => {
    const userId = owners.find((o) => o.id === r.companyId)?.userId;
    return userId ? [{ userId, trips: r.trips, km: Math.round(r.km), earnedCents: cents.get(r.companyId) ?? 0 }] : [];
  });
  rows.sort((a, b) => b.earnedCents - a.earnedCents);
  return rows.map((r, i) => ({ ...r, place: i + 1, of: rows.length }));
}

/** Worker (Monday morning): the weekly report as a notification. */
export async function sendWeeklyReports(db: Database, now = new Date()) {
  let n = 0;
  for (const r of await weeklyNumbers(db, now)) {
    if (!(await featureFor(db, r.userId, 'weekly_report', now))) continue;
    await notify(db, r.userId, 'achievement', () => t('Твоята седмица в TransVerse'), () => t('{0} курса · {1} км · {2} от товари. {3} място от {4} шофьори по приходи.', r.trips, int(r.km), money(r.earnedCents), r.place, r.of), '/game/analytics');
    n++;
  }
  return n;
}
