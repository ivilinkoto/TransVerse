import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CB, extendedExpiry, REPORT_KIND_IDS, REPORT_KINDS, REPORTS, type ReportKind } from '@/lib/game/live-road';
import { haversineKm, type LatLon } from '@/lib/geo/geometry';
import { rateLimit } from '@/server/auth/rate-limit';
import type { Database, DbOrTx } from '@/server/db/client';
import { cbMessages, cities, companies, deliveries, roadReports, roadReportVotes, users, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { companyForUser } from './company';
import { fail } from './errors';
import { assertNotMuted } from './moderation';
import { notify } from './notify';
import { nearestTruckKm, tripPosition } from './roadside';

/** The player's trucks on a trip now, with where each one is. */
export async function trucksOnRoad(db: DbOrTx, userId: string, now: Date) {
  const account = await companyForUser(db, userId);
  const trips = await db
    .select({ vehicleId: deliveries.vehicleId, plate: vehicles.plate, schedule: deliveries.schedule, emptyRouteId: deliveries.emptyRouteId, routeId: deliveries.routeId, contractId: deliveries.contractId })
    .from(deliveries)
    .innerJoin(vehicles, eq(vehicles.id, deliveries.vehicleId))
    .where(and(eq(deliveries.companyId, account.id), eq(deliveries.status, 'in_progress')));
  const out: { vehicleId: string; plate: string; position: LatLon }[] = [];
  for (const t of trips) {
    const position = await tripPosition(db, t, now);
    if (position) out.push({ vehicleId: t.vehicleId, plate: t.plate, position });
  }
  return out;
}

/** The nearest real city of 50 000+ people (for "near Plovdiv"). */
export async function nearCity(db: DbOrTx, [lat, lon]: LatLon) {
  const [c] = await db
    .select({ name: cities.nameBg })
    .from(cities)
    .where(gt(cities.population, 50_000))
    .orderBy(sql`(${cities.lat} - ${lat}) * (${cities.lat} - ${lat}) + ((${cities.lon} - ${lon}) * cos(radians(${lat}))) * ((${cities.lon} - ${lon}) * cos(radians(${lat})))`)
    .limit(1);
  return c?.name ?? '—';
}

export const cbBodySchema = z.string().trim().min(1, 'Напиши съобщение.').max(CB.maxLength, `Най-много ${CB.maxLength} символа.`);

/** Says something on channel 19 from where the player's truck is (the first one on the road, or the one chosen). */
export async function sendCb(db: Database, userId: string, raw: string, now = new Date(), vehicleId?: string) {
  if (!(await featureFor(db, userId, 'cb_radio', now))) fail('not_released', 'CB радиото идва с обновление 1.8.');
  const body = cbBodySchema.parse(raw);
  await assertNotMuted(db, userId, now);
  const trucks = await trucksOnRoad(db, userId, now);
  const truck = trucks.find((t) => t.vehicleId === vehicleId) ?? trucks[0];
  if (!truck) fail('not_on_road', 'CB радиото работи само от камион на път.');
  await rateLimit(db, `cb:${userId}`, CB.perMinute, 60);
  const near = await nearCity(db, truck!.position);
  const [row] = await db.insert(cbMessages).values({ userId, body, lat: truck!.position[0], lon: truck!.position[1], near, createdAt: now }).returning();
  return { id: row!.id, near };
}

/** What the player hears on channel 19: the last hour's messages near any of the trucks on the road. */
export async function cbFeed(db: DbOrTx, userId: string, now = new Date()) {
  const trucks = await trucksOnRoad(db, userId, now);
  if (!trucks.length) return { onRoad: false as const, near: null, messages: [] };
  const since = new Date(now.getTime() - CB.historyMin * 60_000);
  const rows = await db
    .select({ id: cbMessages.id, userId: cbMessages.userId, username: users.username, body: cbMessages.body, lat: cbMessages.lat, lon: cbMessages.lon, near: cbMessages.near, at: cbMessages.createdAt })
    .from(cbMessages)
    .innerJoin(users, eq(users.id, cbMessages.userId))
    .where(and(gt(cbMessages.createdAt, since), isNull(users.bannedAt)))
    .orderBy(desc(cbMessages.createdAt))
    .limit(300);
  const messages = rows
    .map((m) => ({ ...m, km: Math.min(...trucks.map((t) => haversineKm(t.position, [m.lat, m.lon]))) }))
    .filter((m) => m.km <= CB.radiusKm || m.userId === userId)
    .slice(0, 50)
    .reverse()
    .map((m) => ({ id: m.id, username: m.username, mine: m.userId === userId, body: m.body, near: m.near, km: Math.round(m.km), at: m.at.toISOString() }));
  return { onRoad: true as const, near: await nearCity(db, trucks[0]!.position), messages };
}

/** Marks a road report where the player's truck is now. */
export async function createReport(db: Database, userId: string, kind: ReportKind, now = new Date(), vehicleId?: string) {
  if (!(await featureFor(db, userId, 'road_reports', now))) fail('not_released', 'Пътните сигнали идват с обновление 1.8.');
  if (!REPORT_KIND_IDS.includes(kind)) fail('bad_kind', 'Няма такъв сигнал.');
  const trucks = await trucksOnRoad(db, userId, now);
  const truck = trucks.find((t) => t.vehicleId === vehicleId) ?? trucks[0];
  if (!truck) fail('not_on_road', 'Сигнал се дава само от камион на път.');
  const [recent] = await db
    .select({ at: roadReports.createdAt })
    .from(roadReports)
    .where(and(eq(roadReports.userId, userId), gt(roadReports.createdAt, new Date(now.getTime() - REPORTS.cooldownMin * 60_000))))
    .limit(1);
  if (recent) fail('too_soon', `Един сигнал на ${REPORTS.cooldownMin} минути.`);
  const near = await nearCity(db, truck!.position);
  const [row] = await db
    .insert(roadReports)
    .values({ userId, kind, lat: truck!.position[0], lon: truck!.position[1], near, createdAt: now, expiresAt: new Date(now.getTime() + REPORTS.ttlMin * 60_000) })
    .returning();
  return { id: row!.id, near };
}

/** A driver nearby confirms (+1) or denies (−1) a report; the reporter gains or loses reputation once it is clear. */
export async function voteReport(db: Database, userId: string, reportId: number, vote: 1 | -1, now = new Date()) {
  if (!(await featureFor(db, userId, 'road_reports', now))) fail('not_released', 'Пътните сигнали идват с обновление 1.8.');
  const [r] = await db.select().from(roadReports).where(eq(roadReports.id, reportId));
  if (!r || r.expiresAt <= now) fail('report_gone', 'Сигналът вече не е активен.');
  if (r!.userId === userId) fail('own_report', 'Не можеш да гласуваш за своя сигнал.');
  const km = await nearestTruckKm(db, userId, [r!.lat, r!.lon], now);
  if (km === null || km > REPORTS.voteRadiusKm) fail('too_far', `Потвърждава се само от камион до ${REPORTS.voteRadiusKm} км от мястото.`);
  return db.transaction(async (tx) => {
    const [v] = await tx.insert(roadReportVotes).values({ reportId, userId, vote, createdAt: now }).onConflictDoNothing().returning();
    if (!v) fail('already_voted', 'Вече гласува за този сигнал.');
    const [cur] = await tx
      .update(roadReports)
      .set(vote === 1 ? { confirms: sql`${roadReports.confirms} + 1` } : { denies: sql`${roadReports.denies} + 1` })
      .where(eq(roadReports.id, reportId))
      .returning();
    let report = cur!;
    if (vote === 1) [report] = await tx.update(roadReports).set({ expiresAt: extendedExpiry(report.createdAt, report.expiresAt, now) }).where(eq(roadReports.id, reportId)).returning() as [typeof report];
    const kind = REPORT_KINDS[report.kind as ReportKind];
    if (!report.settled && report.confirms >= REPORTS.confirmsToReward) {
      await tx.update(roadReports).set({ settled: true }).where(eq(roadReports.id, reportId));
      await tx.update(companies).set({ reputation: sql`least(100, ${companies.reputation} + ${REPORTS.reputation})` }).where(eq(companies.ownerId, report.userId));
      await notify(tx, report.userId, 'achievement', 'Сигналът ти е потвърден 👍', `${kind.emoji} ${kind.label} край ${report.near} — потвърден от ${report.confirms} шофьори. +${REPORTS.reputation} репутация.`, '/game/road');
    } else if (!report.settled && report.denies >= REPORTS.deniesToRemove && report.denies > report.confirms) {
      await tx.update(roadReports).set({ settled: true, expiresAt: now }).where(eq(roadReports.id, reportId));
      await tx.update(companies).set({ reputation: sql`greatest(0, ${companies.reputation} - ${REPORTS.reputation})` }).where(eq(companies.ownerId, report.userId));
      await notify(tx, report.userId, 'info', 'Сигналът ти е отхвърлен', `${kind.emoji} ${kind.label} край ${report.near} — ${report.denies} шофьори казаха, че го няма. −${REPORTS.reputation} репутация.`, '/game/road');
    }
    return { confirms: report.confirms, denies: report.denies };
  });
}

/** Active reports (for the map and the road page); with `at`, only those near the given points. */
export async function activeReports(db: DbOrTx, now = new Date(), viewerId?: string, at?: LatLon[]) {
  const rows = await db
    .select({ id: roadReports.id, userId: roadReports.userId, username: users.username, kind: roadReports.kind, lat: roadReports.lat, lon: roadReports.lon, near: roadReports.near, confirms: roadReports.confirms, denies: roadReports.denies, createdAt: roadReports.createdAt, expiresAt: roadReports.expiresAt })
    .from(roadReports)
    .innerJoin(users, eq(users.id, roadReports.userId))
    .where(and(gt(roadReports.expiresAt, now), isNull(users.bannedAt)))
    .orderBy(desc(roadReports.createdAt))
    .limit(500);
  const voted = viewerId && rows.length
    ? new Set((await db.select({ id: roadReportVotes.reportId }).from(roadReportVotes).where(eq(roadReportVotes.userId, viewerId))).map((v) => v.id))
    : new Set<number>();
  return rows
    .map((r) => ({ ...r, km: at?.length ? Math.round(Math.min(...at.map((p) => haversineKm(p, [r.lat, r.lon])))) : null }))
    .filter((r) => !at || (r.km !== null && r.km <= REPORTS.showRadiusKm))
    .map((r) => ({ id: r.id, kind: r.kind as ReportKind, position: [r.lat, r.lon] as LatLon, near: r.near, username: r.username, mine: r.userId === viewerId, voted: voted.has(r.id), confirms: r.confirms, denies: r.denies, km: r.km, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString() }));
}

export type ActiveReport = Awaited<ReturnType<typeof activeReports>>[number];

/** Old CB messages and reports are cleared once a day. */
export async function pruneLiveRoad(db: Database, now = new Date()) {
  const day = new Date(now.getTime() - 86_400_000);
  await db.delete(cbMessages).where(sql`${cbMessages.createdAt} < ${day}`);
  await db.delete(roadReports).where(sql`${roadReports.expiresAt} < ${day}`);
}

