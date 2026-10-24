import polyline from '@mapbox/polyline';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { BADGES } from '@/lib/game/halloween';
import { HITCHHIKE, HITCHHIKERS, hitchhikeFare, hitchhikerFor, landmarksAlong, LANDMARKS, POSTCARDS } from '@/lib/game/road-life';
import { money } from '@/lib/format';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, deliveries, hitchhikers, routes, userBadges, userPostcards } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';
import { awardXp } from './progression';
import { t } from '@/i18n/t';

// ── Postcards ────────────────────────────────────────────────────────────

/** A loaded trip arrived: the landmarks its real route passed join the player's postcards. */
export async function collectPostcards(tx: Tx, userId: string, d: { id: string; routeId: number }, at: Date) {
  if (!(await featureFor(tx, userId, 'postcards', at))) return [];
  const [r] = await tx.select({ geometry: routes.geometry, fromCityId: routes.fromCityId, toCityId: routes.toCityId }).from(routes).where(eq(routes.id, d.routeId));
  if (!r) return [];
  let points: [number, number][];
  if (r.geometry) points = polyline.decode(r.geometry, 6) as [number, number][];
  else {
    const ends = await tx.select({ id: cities.id, lat: cities.lat, lon: cities.lon }).from(cities).where(inArray(cities.id, [r.fromCityId, r.toCityId]));
    const a = ends.find((c) => c.id === r.fromCityId);
    const b = ends.find((c) => c.id === r.toCityId);
    if (!a || !b) return [];
    points = [[a.lat, a.lon], [b.lat, b.lon]];
  }
  const passed = landmarksAlong(points);
  if (!passed.length) return [];
  const fresh = await tx
    .insert(userPostcards)
    .values(passed.map((l) => ({ userId, landmark: l.id, deliveryId: d.id, collectedAt: at })))
    .onConflictDoNothing()
    .returning({ landmark: userPostcards.landmark });
  if (!fresh.length) return [];
  const names = fresh.map((f) => LANDMARKS.find((l) => l.id === f.landmark)!).map((l) => `${l.emoji} ${l.name}`);
  await awardXp(tx, userId, POSTCARDS.xp * fresh.length, 'achievement');
  await postCoins(tx, userId, { amount: POSTCARDS.coins * fresh.length, reason: 'postcards', description: t('Картички: {0}', names.join(', ')).slice(0, 200), idempotencyKey: `postcards:${d.id}` });
  const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(userPostcards).where(eq(userPostcards.userId, userId));
  await notify(tx, userId, 'achievement', () => fresh.length === 1 ? t('Нова картичка 📮') : t('{0} нови картички 📮', fresh.length), () => t('{0} — вече имаш {1} от {2}.', names.join(', '), n, LANDMARKS.length), '/game/postcards');
  for (const [count, badge] of Object.entries(POSTCARDS.badges)) {
    if (n >= Number(count) && n - fresh.length < Number(count)) {
      await tx.insert(userBadges).values({ userId, badge, awardedAt: at }).onConflictDoNothing();
      await notify(tx, userId, 'achievement', () => t('Значка: {0}', BADGES[badge]?.label ?? badge), BADGES[badge]?.description ?? '', '/game/postcards');
    }
  }
  return fresh.map((f) => f.landmark);
}

/** The player's postcard collection, every landmark with the date it was collected. */
export async function postcardsOf(db: DbOrTx, userId: string) {
  const rows = await db.select().from(userPostcards).where(eq(userPostcards.userId, userId));
  const got = new Map(rows.map((r) => [r.landmark, r.collectedAt]));
  return LANDMARKS.map((l) => ({ ...l, collectedAt: got.get(l.id)?.toISOString() ?? null }));
}

// ── Hitchhikers ──────────────────────────────────────────────────────────

/** A trip started: sometimes someone waves at the edge of town. */
export async function maybeHitchhiker(tx: Tx, userId: string, d: { id: string; startedAt: Date; loadedKm: number }, lane: { originCityId: number; destCityId: number; urgent: boolean }, now: Date) {
  if (lane.urgent || !(await featureFor(tx, userId, 'hitchhikers', now))) return null;
  const persona = hitchhikerFor(d.id);
  if (persona === null) return null;
  const fare = hitchhikeFare(d.loadedKm);
  const [h] = await tx
    .insert(hitchhikers)
    .values({ userId, deliveryId: d.id, persona, fromCityId: lane.originCityId, toCityId: lane.destCityId, fareCents: fare, waitUntil: new Date(d.startedAt.getTime() + HITCHHIKE.waitMin * 60_000), createdAt: now })
    .onConflictDoNothing()
    .returning();
  if (!h) return null;
  const [from] = await tx.select({ name: cities.nameBg }).from(cities).where(eq(cities.id, lane.originCityId));
  const [to] = await tx.select({ name: cities.nameBg }).from(cities).where(eq(cities.id, lane.destCityId));
  const p = HITCHHIKERS[persona]!;
  await notify(tx, userId, 'info', () => t('{0} маха на пътя 👋', p.name), () => t('{0}, {1}, чака на изхода на {2} и иска до {3}. Вземи я/го до {4} мин — {5} при пристигане.', p.name, p.who, from?.name ?? '', to?.name ?? '', HITCHHIKE.waitMin, money(fare)), '/game/road');
  return h;
}

/** The player takes the hitchhiker along (only while they still wait). */
export async function pickHitchhiker(db: Database, userId: string, id: number, now = new Date()) {
  if (!(await featureFor(db, userId, 'hitchhikers', now))) fail('not_released', t('Автостопаджиите идват с обновление 1.8.'));
  const [h] = await db.select().from(hitchhikers).where(and(eq(hitchhikers.id, id), eq(hitchhikers.userId, userId)));
  if (!h) fail('not_found', t('Няма такъв автостопаджия.'), 404);
  if (h!.status !== 'waiting') fail('not_waiting', t('Вече е в камиона или си тръгна.'));
  if (h!.waitUntil <= now) {
    await db.update(hitchhikers).set({ status: 'missed', settledAt: now }).where(eq(hitchhikers.id, id));
    fail('too_late', t('Закъсня — хвана друга кола.'));
  }
  const [d] = await db.select({ status: deliveries.status }).from(deliveries).where(eq(deliveries.id, h!.deliveryId));
  if (d?.status !== 'in_progress') fail('trip_over', t('Курсът вече приключи.'));
  await db.update(hitchhikers).set({ status: 'aboard' }).where(and(eq(hitchhikers.id, id), eq(hitchhikers.status, 'waiting')));
  return { aboard: true, name: HITCHHIKERS[h!.persona]!.name };
}

/** The trip arrived: a passenger aboard pays the fare (half when the trip is late) and says goodbye. */
export async function dropHitchhiker(tx: Tx, userId: string, d: { id: string; companyId: string }, late: boolean, at: Date) {
  const [h] = await tx.select().from(hitchhikers).where(eq(hitchhikers.deliveryId, d.id));
  if (!h || h.settledAt) return 0;
  if (h.status !== 'aboard') {
    await tx.update(hitchhikers).set({ status: 'missed', settledAt: at }).where(eq(hitchhikers.id, h.id));
    return 0;
  }
  const fare = late ? Math.round(h.fareCents / 2) : h.fareCents;
  const p = HITCHHIKERS[h.persona]!;
  await post(tx, d.companyId, [{ category: 'hitchhiker', amountCents: fare, description: t('Автостоп: {0}', p.name), idempotencyKey: `hitchhiker:${h.id}`, refType: 'delivery', refId: d.id }]);
  await awardXp(tx, userId, HITCHHIKE.xp, 'other');
  await tx.update(hitchhikers).set({ status: 'done', settledAt: at }).where(eq(hitchhikers.id, h.id));
  await notify(tx, userId, 'info', () => t('{0} пристигна 🙂', p.name), () => `${p.bye} ${late ? t('Курсът закъсня, затова плати половината: ') : t('Плати ')}${money(fare)}.`, '/game/finance');
  return fare;
}

/** Hitchhikers for the road page: those waiting now and the last few rides. */
export async function hitchhikersOf(db: DbOrTx, userId: string, now = new Date()) {
  await db.update(hitchhikers).set({ status: 'missed', settledAt: now }).where(and(eq(hitchhikers.userId, userId), eq(hitchhikers.status, 'waiting'), lt(hitchhikers.waitUntil, now)));
  const from = cities;
  const rows = await db
    .select({ id: hitchhikers.id, persona: hitchhikers.persona, status: hitchhikers.status, fareCents: hitchhikers.fareCents, waitUntil: hitchhikers.waitUntil, fromCityId: hitchhikers.fromCityId, toCityId: hitchhikers.toCityId, from: from.nameBg })
    .from(hitchhikers)
    .innerJoin(from, eq(from.id, hitchhikers.fromCityId))
    .where(eq(hitchhikers.userId, userId))
    .orderBy(desc(hitchhikers.createdAt))
    .limit(8);
  const dest = rows.length ? await db.select({ id: cities.id, name: cities.nameBg }).from(cities).where(inArray(cities.id, rows.map((r) => r.toCityId))) : [];
  return rows.map((r) => ({ id: r.id, ...HITCHHIKERS[r.persona]!, status: r.status, fareCents: r.fareCents, waitUntil: r.waitUntil.toISOString(), from: r.from, to: dest.find((c) => c.id === r.toCityId)?.name ?? '' }));
}

