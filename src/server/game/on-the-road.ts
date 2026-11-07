/**
 * 1.2.7 „Заедно на пътя“: the escort for oversize loads, 👍 / 👎 for partners,
 * „👋 Махни“ when two trucks pass each other, and the convoy hour.
 */
import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { sofiaHour } from '@/lib/game/halloween';
import { sofiaDay } from '@/lib/game/shop-v2';
import { CONVOY_HOUR, ESCORT, WAVE, isConvoyHour } from '@/lib/game/on-the-road';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, escorts, jobState, partnerRatings, relays, roadWaves, users } from '@/server/db/schema';
import { postGameLine } from './chat-life';
import { fail } from './errors';
import { post } from './finance';
import { membershipOf } from './membership';
import { sendDirectMessage } from './messages';
import { notify } from './notify';
import { addPassPoints } from './season-pass';
import { t } from '@/i18n/t';

type Load = typeof contracts.$inferSelect;
type Trip = typeof deliveries.$inferSelect;

const sofiaMinute = (at: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', minute: '2-digit' }).format(at));
const ownerOf = async (db: DbOrTx, companyId: string) => (await db.select({ ownerId: companies.ownerId }).from(companies).where(eq(companies.id, companyId)))[0]?.ownerId ?? null;
const nameOf = async (db: DbOrTx, userId: string) => (await db.select({ username: users.username }).from(users).where(eq(users.id, userId)))[0]?.username ?? '';
async function cityName(db: DbOrTx, id: number) {
  const [c] = await db.select({ nameBg: cities.nameBg }).from(cities).where(eq(cities.id, id));
  return c?.nameBg ?? '';
}

// ── Escort ───────────────────────────────────────────────────────────────

/** Worker: a few oversize loads on the board want an escort (they pay more with one). */
export async function topUpEscortLoads(db: Database, now = new Date()) {
  if (!featureLive('escorts', now)) return 0;
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(contracts).where(and(eq(contracts.escort, true), eq(contracts.status, 'open'), gt(contracts.expiresAt, now)));
  if (n >= ESCORT.open) return 0;
  const picked = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.status, 'open'), eq(contracts.oversize, true), eq(contracts.escort, false), sql`${contracts.relayId} is null`, sql`${contracts.tradeCompanyId} is null`, gt(contracts.expiresAt, new Date(now.getTime() + 3_600_000))))
    .limit(ESCORT.open - n);
  if (!picked.length) return 0;
  await db.update(contracts).set({ escort: true }).where(inArray(contracts.id, picked.map((p) => p.id)));
  return picked.length;
}

/** acceptContract: the leader cannot be their own escort, and the escort must still be wanted. */
export async function checkEscortRun(db: DbOrTx, userId: string, mainContractId: string) {
  const [e] = await db.select({ leaderId: escorts.leaderId, status: escorts.status }).from(escorts).where(eq(escorts.mainContractId, mainContractId));
  if (!e || e.status !== 'open') fail('escort_taken', t('Този товар вече има ескорт.'), 409);
  if (e!.leaderId === userId) fail('own_escort', t('Не можеш да си ескорт на собствения си товар — покани друг играч.'));
}

/**
 * Inside acceptContract: the main load of an escort opens the escort run (a light load on
 * the same road for 15 minutes, in the chat with „Стани ескорт“); taking that run makes
 * the player the escort. Two trucks passing each other on the lane get „👋 Махни“.
 */
export async function roadAccepted(tx: Tx, userId: string, load: Load, trip: Trip, now: Date) {
  if (load.escort) await openEscort(tx, userId, load, trip, now);
  if (load.escortFor) await takeEscort(tx, userId, load, trip);
  if (featureLive('road_wave', now) && !load.escortFor) await matchWave(tx, userId, load, trip, now);
}

async function openEscort(tx: Tx, userId: string, load: Load, trip: Trip, now: Date) {
  const [run] = await tx
    .insert(contracts)
    .values({
      shipper: load.shipper,
      goods: t('Пилотна кола (ескорт)'),
      cargoType: 'pallets',
      weightTons: ESCORT.runTons,
      originCityId: load.originCityId,
      destCityId: load.destCityId,
      routeId: load.routeId,
      distanceKm: load.distanceKm,
      rewardCents: Math.max(100_00, Math.round(load.rewardCents * 0.2 * ESCORT.runMultiplier)),
      windowMinutes: load.windowMinutes,
      minLevel: 1,
      escortFor: load.id,
      expiresAt: new Date(now.getTime() + ESCORT.windowMinutes * 60_000),
    })
    .returning({ id: contracts.id });
  const [e] = await tx.insert(escorts).values({ mainContractId: load.id, mainDeliveryId: trip.id, leaderId: userId, escortContractId: run!.id }).onConflictDoNothing().returning({ id: escorts.id });
  if (!e) return;
  const [from, to, me] = [await cityName(tx, load.originCityId), await cityName(tx, load.destCityId), await nameOf(tx, userId)];
  await postGameLine(tx, 'global', 'escort', t('🚓 {0} кара извънгабаритен товар {1} → {2} и търси ескорт. Тръгни до {3} мин от {1} — бонус и за двамата.', me, from, to, ESCORT.windowMinutes), { href: `/game/contracts?load=${run!.id}`, button: t('Стани ескорт') }, now);
  await notify(tx, userId, 'info', () => t('🚓 Търси се ескорт'), () => t('Обявата е в глобалния чат. Покани някого до {0} мин от „Курсове“ → „Ескорт“.', ESCORT.windowMinutes), `/game/contracts?escort=${e.id}`);
}

async function takeEscort(tx: Tx, userId: string, load: Load, trip: Trip) {
  const [e] = await tx.update(escorts).set({ escortUserId: userId, escortDeliveryId: trip.id, status: 'taken' }).where(and(eq(escorts.mainContractId, load.escortFor!), eq(escorts.status, 'open'))).returning();
  if (!e) fail('escort_taken', t('Този товар вече има ескорт.'), 409);
  const me = await nameOf(tx, userId);
  await notify(tx, e!.leaderId, 'success', () => t('🚓 {0} е твоят ескорт', me), () => t('Ако и двамата стигнете навреме: +{0} % за теб, +{1} % от товара за ескорта.', Math.round(ESCORT.mainBonus * 100), Math.round(ESCORT.escortShare * 100)), '/game/fleet');
}

/** The leader invites a player as the escort: a private message with the link to the run. */
export async function inviteEscort(db: Database, userId: string, escortId: string, username: string, now = new Date()) {
  const [e] = await db.select().from(escorts).where(eq(escorts.id, escortId));
  if (!e || e.leaderId !== userId) fail('not_your_load', t('Това не е твой товар.'), 404);
  if (e!.status !== 'open' || !e!.escortContractId) fail('escort_taken', t('Този товар вече има ескорт.'), 409);
  const [to] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = lower(${username.trim()})`);
  if (!to) fail('player_not_found', t('Играчът не е намерен.'), 404);
  if (to!.id === userId) fail('own_escort', t('Не можеш да си ескорт на собствения си товар — покани друг играч.'));
  const [load] = await db.select({ originCityId: contracts.originCityId, destCityId: contracts.destCityId }).from(contracts).where(eq(contracts.id, e!.mainContractId));
  const [from, dest] = [await cityName(db, load!.originCityId), await cityName(db, load!.destCityId)];
  await sendDirectMessage(db, userId, to!.id, t('🚓 Ще ми бъдеш ли ескорт? Извънгабаритен товар {0} → {1}, тръгваме сега. /game/contracts?load={2}', from, dest, e!.escortContractId), now);
  return { ok: true };
}

/** The leader's open escort requests (for the panel on „Курсове“). */
export async function myEscorts(db: DbOrTx, userId: string, now = new Date()) {
  const rows = await db
    .select({ e: escorts, from: contracts.originCityId, to: contracts.destCityId })
    .from(escorts)
    .innerJoin(contracts, eq(contracts.id, escorts.mainContractId))
    .where(and(sql`(${escorts.leaderId} = ${userId} or ${escorts.escortUserId} = ${userId})`, inArray(escorts.status, ['open', 'taken']), gt(escorts.createdAt, new Date(now.getTime() - 2 * 86_400_000))));
  const out = [];
  for (const r of rows) {
    const other = r.e.leaderId === userId ? r.e.escortUserId : r.e.leaderId;
    out.push({ id: r.e.id, lead: r.e.leaderId === userId, status: r.e.status, route: [await cityName(db, r.from), await cityName(db, r.to)] as [string, string], other: other ? await nameOf(db, other) : null, runId: r.e.escortContractId });
  }
  return out;
}

/** On arrival: when both the load and its escort are in, on time — the bonuses, points and a rating. */
async function escortArrived(tx: Tx, userId: string, trip: Trip, load: Load, late: boolean, at: Date) {
  const mainId = load.escortFor ?? load.id;
  const [e] = await tx.select().from(escorts).where(eq(escorts.mainContractId, mainId)).for('update');
  const isMain = !load.escortFor;
  if (e && e.status === 'open' && isMain) await tx.update(escorts).set({ status: 'failed', mainDone: true, mainLate: late }).where(eq(escorts.id, e.id));
  if (!e || e.status !== 'taken') return 0;
  const [row] = await tx.update(escorts).set(isMain ? { mainDone: true, mainLate: late } : { escortDone: true, escortLate: late }).where(eq(escorts.id, e.id)).returning();
  if (!row!.mainDone || !row!.escortDone) return 0;
  const ok = !row!.mainLate && !row!.escortLate && row!.escortUserId && row!.escortUserId !== row!.leaderId;
  await tx.update(escorts).set({ status: ok ? 'done' : 'failed' }).where(eq(escorts.id, e.id));
  if (!ok) return 0;
  const [main] = await tx.select({ rewardCents: contracts.rewardCents }).from(contracts).where(eq(contracts.id, mainId));
  const leadCo = (await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, row!.leaderId)))[0];
  const escCo = (await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, row!.escortUserId!)))[0];
  const leadBonus = Math.round(main!.rewardCents * ESCORT.mainBonus);
  const escBonus = Math.round(main!.rewardCents * ESCORT.escortShare);
  if (leadCo) await post(tx, leadCo.id, [{ category: 'bonus', amountCents: leadBonus, description: t('Извънгабаритен товар с ескорт'), idempotencyKey: `escort:${e.id}:lead`, refType: 'delivery', refId: row!.mainDeliveryId ?? undefined }]);
  if (escCo) await post(tx, escCo.id, [{ category: 'bonus', amountCents: escBonus, description: t('Ескорт на извънгабаритен товар'), idempotencyKey: `escort:${e.id}:escort`, refType: 'delivery', refId: row!.escortDeliveryId ?? undefined }]);
  for (const [u, other] of [[row!.leaderId, row!.escortUserId!], [row!.escortUserId!, row!.leaderId]] as const) {
    await addPassPoints(tx, u, ESCORT.passPoints, at);
    const name = await nameOf(tx, other);
    await notify(tx, u, 'success', () => t('🚓 Ескортът стигна навреме'), () => t('+{0} точки за пропуска. Как беше с {1}? Оцени партньора.', ESCORT.passPoints, name), `/game/contracts?rate=${e.id}`);
  }
  void userId;
  void trip;
  return isMain ? leadBonus : escBonus;
}

// ── Ratings ──────────────────────────────────────────────────────────────

/** Who a player can rate for a finished partner load or escort (the other one), or null. */
async function rateTarget(db: DbOrTx, userId: string, refId: string) {
  const [e] = await db.select().from(escorts).where(eq(escorts.id, refId));
  if (e) return e.status === 'done' ? (e.leaderId === userId ? e.escortUserId : e.escortUserId === userId ? e.leaderId : null) : null;
  const [r] = await db.select().from(relays).where(eq(relays.id, refId));
  if (r?.partner && r.status === 'done' && r.leg1UserId && r.leg2UserId) return r.leg1UserId === userId ? r.leg2UserId : r.leg2UserId === userId ? r.leg1UserId : null;
  return null;
}

/** 👍 / 👎 for the partner of a finished partner load or escort (once). */
export async function ratePartner(db: Database, userId: string, refId: string, good: boolean) {
  const other = await rateTarget(db, userId, refId);
  if (!other) fail('cannot_rate', t('Можеш да оцениш само партньор от завършен общ товар.'));
  const [row] = await db.insert(partnerRatings).values({ raterId: userId, rateeId: other!, ref: refId, good }).onConflictDoNothing().returning();
  if (!row) fail('already_rated', t('Вече оцени този партньор.'));
  return { ok: true };
}

/** How reliable a player is as a partner: 👍 and 👎 from the ones they drove with. */
export async function reliability(db: DbOrTx, userId: string) {
  const [r] = await db.select({ good: sql<number>`count(*) filter (where ${partnerRatings.good})::int`, bad: sql<number>`count(*) filter (where not ${partnerRatings.good})::int` }).from(partnerRatings).where(eq(partnerRatings.rateeId, userId));
  return { good: r?.good ?? 0, bad: r?.bad ?? 0 };
}

/** relayDelivered: after a partner load on time, both are asked to rate each other. */
export async function askToRate(tx: Tx, refId: string, a: string, b: string) {
  if (!featureLive('partner_ratings', new Date())) return;
  for (const [u, other] of [[a, b], [b, a]] as const) {
    const name = await nameOf(tx, other);
    await notify(tx, u, 'info', () => t('Как беше с {0}?', name), () => t('Оцени партньора — другите виждат надеждността в профила.'), `/game/contracts?rate=${refId}`);
  }
}

// ── „👋 Махни“ ───────────────────────────────────────────────────────────

/** A truck that just left meets one of another player coming the other way on the same lane. */
async function matchWave(tx: Tx, userId: string, load: Load, trip: Trip, now: Date) {
  const [other] = await tx
    .select({ id: deliveries.id, companyId: deliveries.companyId })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .where(and(eq(deliveries.status, 'in_progress'), eq(contracts.originCityId, load.destCityId), eq(contracts.destCityId, load.originCityId), ne(deliveries.companyId, trip.companyId), gt(deliveries.etaAt, now)))
    .orderBy(desc(deliveries.startedAt))
    .limit(1);
  if (!other) return null;
  const otherId = await ownerOf(tx, other.companyId);
  if (!otherId || otherId === userId) return null;
  const [w] = await tx.insert(roadWaves).values({ aId: userId, bId: otherId, aDeliveryId: trip.id, bDeliveryId: other.id }).onConflictDoNothing().returning({ id: roadWaves.id });
  if (!w) return null;
  const [mine, theirs] = [await nameOf(tx, userId), await nameOf(tx, otherId)];
  const road = `${await cityName(tx, load.originCityId)} – ${await cityName(tx, load.destCityId)}`;
  await notify(tx, userId, 'info', () => t('👋 Насреща ти идва {0}', theirs), () => t('По пътя {0}. Махни му!', road), `/game/fleet?wave=${w.id}`);
  await notify(tx, otherId, 'info', () => t('👋 Насреща ти идва {0}', mine), () => t('По пътя {0}. Махни му!', road), `/game/fleet?wave=${w.id}`);
  return w.id;
}

/** „👋 Махни“: when both wave, a few pass points and the private chat opens between them. */
export async function wave(db: Database, userId: string, waveId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [w] = await tx.select().from(roadWaves).where(eq(roadWaves.id, waveId)).for('update');
    if (!w || (w.aId !== userId && w.bId !== userId)) fail('wave_not_found', t('Камионът вече отмина.'), 404);
    const mineA = w!.aId === userId;
    if (mineA ? w!.aWaved : w!.bWaved) return { both: w!.aWaved && w!.bWaved };
    await tx.update(roadWaves).set(mineA ? { aWaved: true } : { bWaved: true }).where(eq(roadWaves.id, w!.id));
    const other = mineA ? w!.bId : w!.aId;
    const both = mineA ? w!.bWaved : w!.aWaved;
    const me = await nameOf(tx, userId);
    if (!both) {
      await notify(tx, other, 'info', () => t('👋 {0} ти маха', me), () => t('Махни и ти!'), `/game/fleet?wave=${w!.id}`);
      return { both: false };
    }
    const day = sofiaDay(now);
    for (const u of [userId, other]) {
      const [c] = await tx.insert(jobState).values({ key: `waves:${u}:${day}`, value: { n: 1 } }).onConflictDoUpdate({ target: jobState.key, set: { value: sql`jsonb_build_object('n', coalesce((${jobState.value}->>'n')::int, 0) + 1)` } }).returning({ value: jobState.value });
      if (Number((c!.value as { n: number }).n) <= WAVE.perDay) await addPassPoints(tx, u, WAVE.passPoints, now);
    }
    const them = await nameOf(tx, other);
    await notify(tx, other, 'success', () => t('👋 Махнахте си с {0}', me), () => t('Пиши му — може да карате заедно.'), `/game?chat=dm:${userId}`);
    await notify(tx, userId, 'success', () => t('👋 Махнахте си с {0}', them), () => t('Пиши му — може да карате заедно.'), `/game?chat=dm:${other}`);
    return { both: true };
  });
}

// ── The convoy hour ──────────────────────────────────────────────────────

/** Worker: the chat is told a few minutes before 20:00 (once a day). */
export async function announceConvoyHour(db: Database, now = new Date()) {
  if (!featureLive('convoy_hour', now) || sofiaHour(now) !== CONVOY_HOUR.startHour - 1 || sofiaMinute(now) < 45) return null;
  return db.transaction(async (tx) => {
    const [first] = await tx.insert(jobState).values({ key: `convoy-hour:${sofiaDay(now)}`, value: {} }).onConflictDoNothing().returning();
    if (!first) return null;
    return postGameLine(tx, 'global', 'moment', t('🚚 В 20:00 започва часът на конвоя: 30 минути, в които курс в конвой с играч от друга компания носи двойни точки за пропуска. Кой тръгва?'), { href: '/game/convoys', button: t('Конвои') }, now);
  });
}

/** settleDelivery: a convoy with a player of another company, started in the convoy hour — pass points ×2. */
export async function convoyHourPoints(tx: Tx, userId: string, trip: Trip, points: number, at: Date) {
  if (!featureLive('convoy_hour', at) || !isConvoyHour(sofiaHour(trip.startedAt), sofiaMinute(trip.startedAt))) return 0;
  let mixed = !!trip.organizedConvoyId;
  if (!mixed && trip.convoyWith) {
    const [mate] = await tx.select({ companyId: deliveries.companyId }).from(deliveries).where(eq(deliveries.id, trip.convoyWith));
    const mateOwner = mate ? await ownerOf(tx, mate.companyId) : null;
    if (mateOwner && mateOwner !== userId) {
      const [mine, theirs] = [await membershipOf(tx, userId), await membershipOf(tx, mateOwner)];
      mixed = !mine || !theirs || mine.company.id !== theirs.company.id;
    }
  }
  if (!mixed) return 0;
  const extra = Math.round(points * (CONVOY_HOUR.multiplier - 1));
  if (extra > 0) await addPassPoints(tx, userId, extra, at);
  return extra;
}

/** settleDelivery: everything of 1.2.7 that happens on arrival. Returns the bonus paid to this company. */
export async function roadDelivered(tx: Tx, userId: string, trip: Trip, load: Load, late: boolean, at: Date) {
  let bonus = 0;
  if (load.escort || load.escortFor) bonus += await escortArrived(tx, userId, trip, load, late, at);
  return bonus;
}
