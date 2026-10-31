import { and, avg, count, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, deliveryExtras, jobState, routes, userBadges, vehicles } from '@/server/db/schema';
import { FOG, fogAt } from '@/lib/game/fog';
import { weekKey } from '@/lib/game/leagues';
import { PUZZLE, puzzleFill, puzzlePieces, puzzleShare, type Placement } from '@/lib/game/loading-puzzle';
import { PROMISES, promiseOutcome, type PromiseId } from '@/lib/game/promise';
import { techEffect } from '@/lib/game/research';
import { MYSTERY, REVIEWS, mysteryPick, starLine, starsFor } from '@/lib/game/reviews';
import { LIVESTOCK, livestockCare } from '@/lib/game/special-loads';
import { contractCountries } from '@/lib/game/licences';
import { t } from '@/i18n/t';
import { featureFor } from '@/server/features';
import { recordAdKm } from './ads';
import { recordCo2 } from './co2';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { post, type Posting } from './finance';
import { burnLockedFuel } from './fuel-hedge';
import { insurerClaim } from './insurers';
import { boldUntil, offerInterview } from './interviews';
import { maybeLostCase } from './lost-cargo';
import { officeEffects } from './office';
import { recordChallengeRun } from './player-challenges';
import { researchOf } from './research';
import { notify } from './notify';
import { recordWishDelivery } from './wishes';

/**
 * 1.1.4.2: what a trip brings besides the usual pay — the promise to the
 * client, the loading puzzle, the stars, the mystery client, the fog, the
 * company's technologies and office, livestock care, an interview's effect,
 * the insurer, the fuel bought ahead, adverts, CO₂, wishes and challenges.
 */

// ── When the trip starts / during it ────────────────────────────────────

export async function setPromise(db: DbOrTx, userId: string, deliveryId: string, promise: PromiseId) {
  if (!(promise in PROMISES)) fail('bad_promise', t('Невалиден срок.'));
  await db.insert(deliveryExtras).values({ deliveryId, userId, promise }).onConflictDoUpdate({ target: deliveryExtras.deliveryId, set: { promise } });
}

async function ownTrip(db: DbOrTx, userId: string, deliveryId: string) {
  const company = await companyForUser(db, userId);
  const [d] = await db.select({ id: deliveries.id, startedAt: deliveries.startedAt, status: deliveries.status, tag: contracts.tag }).from(deliveries).innerJoin(contracts, eq(contracts.id, deliveries.contractId)).where(and(eq(deliveries.id, deliveryId), eq(deliveries.companyId, company.id)));
  if (!d) fail('delivery_not_found', t('Курсът не е намерен.'), 404);
  return { ...d!, companyId: company.id };
}

/** The puzzle of a trip: its pieces, the time left and the result if already loaded. */
export async function puzzleFor(db: DbOrTx, userId: string, deliveryId: string, now = new Date()) {
  const d = await ownTrip(db, userId, deliveryId);
  const [x] = await db.select({ puzzle: deliveryExtras.puzzle }).from(deliveryExtras).where(eq(deliveryExtras.deliveryId, deliveryId));
  const endsAt = new Date(d.startedAt.getTime() + PUZZLE.minutes * 60_000);
  return { pieces: puzzlePieces(deliveryId), cols: PUZZLE.cols, rows: PUZZLE.rows, endsAt, open: d.status === 'in_progress' && now < endsAt && !x?.puzzle, result: x?.puzzle ?? null };
}

export async function submitPuzzle(db: DbOrTx, userId: string, deliveryId: string, placements: Placement[], now = new Date()) {
  const d = await ownTrip(db, userId, deliveryId);
  if (d.status !== 'in_progress' || now.getTime() > d.startedAt.getTime() + PUZZLE.minutes * 60_000) fail('puzzle_closed', t('Товаренето вече приключи — камионът е на път.'), 409);
  const [x] = await db.select({ puzzle: deliveryExtras.puzzle }).from(deliveryExtras).where(eq(deliveryExtras.deliveryId, deliveryId));
  if (x?.puzzle) fail('puzzle_done', t('Ремаркето вече е подредено.'), 409);
  let fill = 0;
  try {
    fill = puzzleFill(puzzlePieces(deliveryId), placements);
  } catch {
    fail('bad_placement', t('Някой палет не пасва — опитай пак.'));
  }
  const smart = techEffect('smart_loading', (await researchOf(db, d.companyId, now)).find((r) => r.tech === 'smart_loading')!.level);
  const puzzle = { fill: Math.round(fill * 1000) / 1000, share: puzzleShare(fill, smart) };
  await db.insert(deliveryExtras).values({ deliveryId, userId, puzzle }).onConflictDoUpdate({ target: deliveryExtras.deliveryId, set: { puzzle } });
  return puzzle;
}

// ── On arrival ──────────────────────────────────────────────────────────

export interface TripFacts {
  userId: string;
  companyId: string;
  deliveryId: string;
  contractId: string;
  tag: string | null;
  goods: string;
  cargoType: string;
  originCityId: number;
  destCityId: number;
  routeId: number;
  vehicleId: string;
  startedAt: Date;
  deadlineAt: Date;
  completedAt: Date;
  late: boolean;
  violations: number;
  rewardCents: number;
  penaltyCents: number;
  fuelCents: number;
  fuelLitres: number;
  tollCents: number;
  wear: number;
  loadedKm: number;
  crew: string[];
  condition: number;
  perfectStreak: number;
}

/** The average of the last reviews of a player (null under `minTrips`). */
export async function starsOf(db: DbOrTx, userId: string) {
  const recent = db.select({ stars: deliveryExtras.stars }).from(deliveryExtras).where(and(eq(deliveryExtras.userId, userId), isNotNull(deliveryExtras.stars))).orderBy(desc(deliveryExtras.createdAt)).limit(30).as('recent');
  const [r] = await db.select({ avg: avg(recent.stars), n: count() }).from(recent);
  const n = Number(r?.n ?? 0);
  return { average: n ? Math.round(Number(r!.avg) * 10) / 10 : null, trips: n, good: n >= REVIEWS.minTrips && Number(r!.avg) >= REVIEWS.goodAverage };
}

/** Money of the trip's extras: posted here, returned to add to the trip's result. */
export async function settleExtras(tx: Tx, f: TripFacts): Promise<number> {
  const at = f.completedAt;
  const key = (k: string) => `delivery:${f.deliveryId}:${k}`;
  const postings: Posting[] = [];
  const [x] = await tx.select().from(deliveryExtras).where(eq(deliveryExtras.deliveryId, f.deliveryId));
  // The promise.
  if (x?.promise && x.promise !== 'normal' && (await featureFor(tx, f.userId, 'load_promise', at))) {
    const o = promiseOutcome(x.promise as PromiseId, { startedAt: f.startedAt.getTime(), deadlineAt: f.deadlineAt.getTime(), completedAt: at.getTime() }, f.rewardCents, f.penaltyCents);
    if (o.cents) postings.push({ category: 'promise', amountCents: o.cents, description: o.kept ? t('Удържан срок „{0}“', PROMISES[x.promise as PromiseId].label) : t('Неудържан срок „{0}“', PROMISES[x.promise as PromiseId].label), idempotencyKey: key('promise') });
  }
  // The loading puzzle.
  if (x?.puzzle?.share && (await featureFor(tx, f.userId, 'loading_puzzle', at))) postings.push({ category: 'loading_bonus', amountCents: Math.round(f.rewardCents * x.puzzle.share), description: t('Подредено ремарке ({0}%)', Math.round(x.puzzle.fill * 100)), idempotencyKey: key('puzzle') });
  // Fog at either end (November).
  if (await featureFor(tx, f.userId, 'fog', at)) {
    const ends = await tx.select({ lat: cities.lat, lon: cities.lon }).from(cities).where(sql`${cities.id} in (${f.originCityId}, ${f.destCityId})`);
    const area = ends.map((c) => fogAt(c.lat, c.lon, f.startedAt)).find(Boolean);
    if (area) postings.push({ category: 'fog_bonus', amountCents: Math.round(f.rewardCents * FOG.payShare), description: t('Мъгла: {0}', area.label), idempotencyKey: key('fog') });
  }
  // The company's technologies and office.
  if (await featureFor(tx, f.userId, 'research', at)) {
    const tech = await researchOf(tx, f.companyId, at);
    const level = (id: string) => tech.find((r) => r.tech === id)?.level ?? 0;
    const aero = Math.round(f.fuelCents * techEffect('aero', level('aero')));
    const tele = f.late ? 0 : Math.round(f.rewardCents * techEffect('telematics', level('telematics')));
    if (aero + tele) postings.push({ category: 'tech_bonus', amountCents: aero + tele, description: t('Технологии: гориво и телематика'), idempotencyKey: key('tech') });
  }
  if (await featureFor(tx, f.userId, 'office', at)) {
    const o = await officeEffects(tx, f.companyId);
    const cents = Math.round((f.fuelCents + f.tollCents) * o.accountant) + Math.round(f.rewardCents * o.sales);
    if (cents) postings.push({ category: 'office_bonus', amountCents: cents, description: t('Офис: счетоводител и търговец'), idempotencyKey: key('office') });
  }
  // Livestock care.
  if (f.tag === 'livestock') {
    const care = livestockCare({ late: f.late, violations: f.violations, loadedKm: f.loadedKm, team: f.crew.length > 1 });
    postings.push({ category: 'livestock_care', amountCents: Math.round(f.rewardCents * (care ? LIVESTOCK.careShare : LIVESTOCK.poorShare)), description: care ? t('Добра грижа за животните') : t('Изморени животни'), idempotencyKey: key('livestock') });
  }
  // A bold interview this week.
  if (await boldUntil(tx, f.userId, at)) {
    const cents = f.late ? -f.penaltyCents : Math.round(f.rewardCents * 0.05);
    if (cents) postings.push({ category: 'interview', amountCents: cents, description: f.late ? t('Интервю: двойна неустойка') : t('Интервю: +5% навреме'), idempotencyKey: key('interview') });
  }
  // Happy clients pay a little more.
  if ((await featureFor(tx, f.userId, 'client_reviews', at)) && (await starsOf(tx, f.userId)).good) postings.push({ category: 'good_clients', amountCents: Math.round(f.rewardCents * REVIEWS.goodClientShare), description: t('Доволни клиенти'), idempotencyKey: key('good-clients') });
  const list = postings.filter((p) => p.amountCents !== 0);
  if (list.length) await post(tx, f.companyId, list);
  let total = list.reduce((s, p) => s + p.amountCents, 0);
  if (await featureFor(tx, f.userId, 'fuel_hedge', at)) total += await burnLockedFuel(tx, f.companyId, f.deliveryId, f.fuelLitres, f.fuelCents, at);
  if (f.late && (await featureFor(tx, f.userId, 'insurers', at))) total += await insurerClaim(tx, f.companyId, f.userId, f.deliveryId, f.penaltyCents, at);
  return total;
}

const weekStart = (now: Date) => new Date(`${weekKey(now).slice(1)}T00:00:00+02:00`);

/** Everything else of the trip's extras (after the truck has arrived and been updated). */
export async function afterExtras(tx: Tx, f: TripFacts) {
  const at = f.completedAt;
  const [x] = await tx.select().from(deliveryExtras).where(eq(deliveryExtras.deliveryId, f.deliveryId));
  // Stars and the mystery client.
  let stars: number | null = null;
  let mystery = false;
  if (await featureFor(tx, f.userId, 'client_reviews', at)) {
    const promiseBroken = !!x?.promise && x.promise === 'fast' && !promiseOutcome('fast', { startedAt: f.startedAt.getTime(), deadlineAt: f.deadlineAt.getTime(), completedAt: at.getTime() }, 0, 0).kept;
    stars = starsFor({ late: f.late, violations: f.violations, promiseBroken, condition: f.condition, puzzleFill: x?.puzzle?.fill });
    if (promiseBroken) await tx.update(companies).set({ reputation: sql`greatest(0, ${companies.reputation} + ${PROMISES.fast.brokenReputation})` }).where(eq(companies.id, f.companyId));
    if ((await featureFor(tx, f.userId, 'mystery_client', at)) && mysteryPick(f.deliveryId)) {
      const [had] = await tx.select({ id: deliveryExtras.deliveryId }).from(deliveryExtras).where(and(eq(deliveryExtras.userId, f.userId), eq(deliveryExtras.mystery, true), gte(deliveryExtras.createdAt, weekStart(at)))).limit(1);
      mystery = !had;
    }
  }
  const litres = f.fuelLitres;
  const co2 = (await featureFor(tx, f.userId, 'co2', at)) ? await recordCo2(tx, f.companyId, litres, at) : null;
  const ends = await tx.select({ lat: cities.lat, lon: cities.lon }).from(cities).where(sql`${cities.id} in (${f.originCityId}, ${f.destCityId})`);
  const fog = (await featureFor(tx, f.userId, 'fog', at)) && ends.some((c) => fogAt(c.lat, c.lon, f.startedAt));
  await tx
    .insert(deliveryExtras)
    .values({ deliveryId: f.deliveryId, userId: f.userId, stars, mystery, fog, co2Kg: co2 })
    .onConflictDoUpdate({ target: deliveryExtras.deliveryId, set: { stars, mystery, fog, co2Kg: co2 } });
  if (stars != null) {
    if (mystery && stars === 5) {
      await postCoins(tx, f.userId, { amount: MYSTERY.coins, reason: 'mystery_client', description: t('Тайният клиент: пет звезди'), idempotencyKey: `mystery:${f.deliveryId}` });
      await tx.insert(userBadges).values({ userId: f.userId, badge: MYSTERY.badge, awardedAt: at }).onConflictDoNothing();
      await notify(tx, f.userId, 'achievement', () => t('🕵 Това беше тайният клиент!'), () => t('Пет звезди — +{0} ТрансКоин и значка.', MYSTERY.coins), '/game/reviews');
      await offerInterview(tx, f.userId, 'mystery', at);
    } else if (mystery) {
      await notify(tx, f.userId, 'info', () => t('🕵 Тайният клиент провери курса'), () => t('Оценка {0} — следващата седмица ще има нов шанс.', starLine(stars!)), '/game/reviews');
    }
  }
  // Fog pilot: five foggy trips in November.
  if (fog) {
    const year = at.getUTCFullYear();
    const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(deliveryExtras).where(and(eq(deliveryExtras.userId, f.userId), eq(deliveryExtras.fog, true), gte(deliveryExtras.createdAt, new Date(Date.UTC(year, FOG.month, 1) - 3 * 3_600_000))));
    if (n >= FOG.missionTrips) {
      const paid = await postCoins(tx, f.userId, { amount: FOG.coins, reason: 'fog_pilot', description: t('Пилот в мъглата {0}', year), idempotencyKey: `fog-pilot:${year}:${f.userId}` });
      if (paid) {
        await tx.insert(userBadges).values({ userId: f.userId, badge: FOG.badge, awardedAt: at }).onConflictDoNothing();
        await notify(tx, f.userId, 'achievement', () => t('🌫 Пилот в мъглата'), () => t('Пет курса в мъглата — +{0} ТрансКоин и значка.', FOG.coins), '/game/collection');
      }
    }
  }
  // Wear spared by the technologies and the office inspector.
  const spare = ((await featureFor(tx, f.userId, 'research', at)) ? techEffect('predictive', (await researchOf(tx, f.companyId, at)).find((r) => r.tech === 'predictive')!.level) : 0) + ((await featureFor(tx, f.userId, 'office', at)) ? (await officeEffects(tx, f.companyId)).inspector : 0);
  if (spare > 0 && f.wear > 0) await tx.update(vehicles).set({ condition: sql`least(100, ${vehicles.condition} + ${Math.min(1, spare) * f.wear})` }).where(eq(vehicles.id, f.vehicleId));
  // Adverts: kilometres in the countries on the way.
  if (await featureFor(tx, f.userId, 'trailer_ads', at)) {
    const [route] = await tx.select({ countries: routes.countries }).from(routes).where(eq(routes.id, f.routeId));
    const [o] = await tx.select({ cc: cities.countryCode }).from(cities).where(eq(cities.id, f.originCityId));
    const [dd] = await tx.select({ cc: cities.countryCode }).from(cities).where(eq(cities.id, f.destCityId));
    await recordAdKm(tx, f.companyId, f.userId, contractCountries(o?.cc ?? '', dd?.cc ?? '', route?.countries), f.loadedKm, !f.late, at);
  }
  if (await featureFor(tx, f.userId, 'driver_wishes', at)) await recordWishDelivery(tx, f.userId, f.crew, f.destCityId, at);
  if (await featureFor(tx, f.userId, 'player_challenges', at)) await recordChallengeRun(tx, f.userId, { originCityId: f.originCityId, destCityId: f.destCityId }, { minutes: Math.round((at.getTime() - f.startedAt.getTime()) / 6000) / 10, solo: f.crew.length <= 1, deliveryId: f.deliveryId }, at);
  if (['pallets', 'container'].includes(f.cargoType) && !f.tag) await maybeLostCase(tx, f.userId, f.deliveryId, f.goods, at);
  if (f.perfectStreak === 10) await offerInterview(tx, f.userId, 'perfect', at);
  // Livestock: ten trips with good care make the badge.
  if (f.tag === 'livestock' && livestockCare({ late: f.late, violations: f.violations, loadedKm: f.loadedKm, team: f.crew.length > 1 })) {
    const k = `animal-care:${f.userId}`;
    const [row] = await tx.insert(jobState).values({ key: k, value: { n: 1 } }).onConflictDoUpdate({ target: jobState.key, set: { value: sql`jsonb_build_object('n', coalesce((${jobState.value}->>'n')::int, 0) + 1)` } }).returning({ value: jobState.value });
    if (((row?.value as { n?: number }).n ?? 0) >= 10) await tx.insert(userBadges).values({ userId: f.userId, badge: 'animal-friend', awardedAt: at }).onConflictDoNothing();
  }
  return { stars, mystery, fog };
}

/** The player's latest reviews (for the reviews page). */
export async function reviewsOf(db: Database | DbOrTx, userId: string, limit = 20) {
  return db
    .select({ deliveryId: deliveryExtras.deliveryId, stars: deliveryExtras.stars, mystery: deliveryExtras.mystery, fog: deliveryExtras.fog, promise: deliveryExtras.promise, puzzle: deliveryExtras.puzzle, goods: contracts.goods, to: cities.nameBg, at: deliveries.completedAt })
    .from(deliveryExtras)
    .innerJoin(deliveries, eq(deliveries.id, deliveryExtras.deliveryId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .where(and(eq(deliveryExtras.userId, userId), isNotNull(deliveryExtras.stars)))
    .orderBy(desc(deliveries.completedAt))
    .limit(limit);
}
