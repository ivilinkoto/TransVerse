import { plainGoodsFor } from '@/lib/game/goods';
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { featureLive } from '@/lib/game/features';
import { BADGES } from '@/lib/game/halloween';
import { RELAY } from '@/lib/game/relay';
import { PARTNER } from '@/lib/game/partner-loads';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, Tx } from '@/server/db/client';
import { cities, companies, contracts, relays, userBadges } from '@/server/db/schema';
import type { RoutingProvider } from '@/server/geo/routing';
import { addLoad, loadHubs } from './contracts';
import { post } from './finance';
import { notify } from './notify';
import { partnerHandover, partnersArrived } from './partner-loads';
import { askToRate } from './on-the-road';
import { t } from '@/i18n/t';

const HOUR = 3_600_000;
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/**
 * Worker: keeps a few relay loads open. Both legs are made at once; the
 * second one waits ("held") until the first arrives at the relay city.
 */
export async function topUpRelays(db: Database, now = new Date(), provider?: RoutingProvider) {
  if (!featureLive('relay', now)) return 0;
  return topUp(db, now, provider, { partner: false, open: RELAY.open, minKm: RELAY.minKm, maxKm: RELAY.maxKm, multiplier: RELAY.multiplier, ttlHours: RELAY.ttlHours });
}

/** 1.2.6: keeps a few partner loads open (a relay whose second leg is kept for an agreed partner). */
export async function topUpPartnerLoads(db: Database, now = new Date(), provider?: RoutingProvider) {
  if (!featureLive('partner_loads', now)) return 0;
  return topUp(db, now, provider, { partner: true, open: PARTNER.open, minKm: PARTNER.minKm, maxKm: PARTNER.maxKm, multiplier: PARTNER.multiplier, ttlHours: PARTNER.ttlHours });
}

async function topUp(db: Database, now: Date, provider: RoutingProvider | undefined, o: { partner: boolean; open: number; minKm: number; maxKm: number; multiplier: number; ttlHours: number }) {
  const [{ open = 0 } = {}] = await db.select({ open: sql<number>`count(*)::int` }).from(relays).innerJoin(contracts, eq(contracts.id, relays.leg1ContractId)).where(and(eq(relays.status, 'leg1'), eq(relays.partner, o.partner), eq(contracts.status, 'open'), gt(contracts.expiresAt, now)));
  if (open >= o.open) return 0;
  const hubs = (await loadHubs(db, { now })).filter((h) => h.population >= 50_000);
  let made = 0;
  for (let tries = 0; made < o.open - open && tries < 20; tries++) {
    const a = pick(hubs.filter((h) => h.population >= 150_000));
    if (!a) break;
    const far = hubs.filter((h) => {
      const km = haversineKm([a.lat, a.lon], [h.lat, h.lon]) * 1.25;
      return km >= o.minKm && km <= o.maxKm;
    });
    const b = pick(far);
    if (!b) continue;
    const mid: [number, number] = [(a.lat + b.lat) / 2, (a.lon + b.lon) / 2];
    const relay = hubs.filter((h) => h.id !== a.id && h.id !== b.id).sort((x, y) => haversineKm(mid, [x.lat, x.lon]) - haversineKm(mid, [y.lat, y.lon]))[0];
    if (!relay || haversineKm(mid, [relay.lat, relay.lon]) > 150) continue;
    const cargo: CargoType = ([...a.produces].find((c) => c === 'pallets' || c === 'container') as CargoType | undefined) ?? 'pallets';
    const [minT, maxT] = CARGO[cargo].tons;
    const tons = Math.round(Math.max(minT, Math.min(maxT, 8 + Math.random() * 12)) * 10) / 10;
    const goods = pick(plainGoodsFor(cargo, featureLive('more_goods', now)));
    const leg1 = await addLoad(db, a.id, relay.id, cargo, tons, now, o.ttlHours * HOUR, o.multiplier, { goods }, provider);
    const leg2 = leg1 ? await addLoad(db, relay.id, b.id, cargo, tons, now, 365 * 24 * HOUR, o.multiplier, { goods }, provider) : null;
    if (!leg1 || !leg2) continue;
    const [row] = await db.insert(relays).values({ originCityId: a.id, relayCityId: relay.id, destCityId: b.id, leg1ContractId: leg1, leg2ContractId: leg2, partner: o.partner, createdAt: now }).returning({ id: relays.id });
    await db.update(contracts).set({ relayId: row!.id, relayLeg: 1 }).where(eq(contracts.id, leg1));
    await db.update(contracts).set({ relayId: row!.id, relayLeg: 2, status: 'held' }).where(eq(contracts.id, leg2));
    made++;
  }
  return made;
}

async function badge(tx: Tx, userId: string, at: Date) {
  const [got] = await tx.insert(userBadges).values({ userId, badge: RELAY.badge, awardedAt: at }).onConflictDoNothing().returning();
  if (got) await notify(tx, userId, 'achievement', () => t('Значка: {0}', BADGES[RELAY.badge]?.label ?? t('Щафета')), BADGES[RELAY.badge]?.description ?? '', '/game/contracts');
}

/** On arrival of a relay leg: the hand-over, or the end of the relay with its bonus. */
export async function relayDelivered(tx: Tx, userId: string, d: { id: string; companyId: string }, contract: { id: string; relayId: string | null; relayLeg: number | null; rewardCents: number; goods: string }, late: boolean, at: Date) {
  if (!contract.relayId) return 0;
  const [r] = await tx.select().from(relays).where(eq(relays.id, contract.relayId)).for('update');
  if (!r) return 0;
  const names = await tx.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, [r.relayCityId, r.destCityId]));
  const name = (id: number) => names.find((c) => c.id === id)?.nameBg ?? '';
  if (contract.relayLeg === 1 && r.status === 'leg1') {
    await tx.update(relays).set({ status: 'leg2', leg1UserId: userId, leg1DeliveryId: d.id, leg1Late: late, handoverAt: at }).where(eq(relays.id, r.id));
    await tx.update(contracts).set({ status: 'open', expiresAt: new Date(at.getTime() + RELAY.handoverHours * HOUR) }).where(and(eq(contracts.id, r.leg2ContractId), eq(contracts.status, 'held')));
    if (r.partner) {
      // 1.2.6: the partner's leg waits longer; the partner hears it is their turn.
      await tx.update(contracts).set({ expiresAt: new Date(at.getTime() + PARTNER.handoverHours * HOUR) }).where(eq(contracts.id, r.leg2ContractId));
      await partnerHandover(tx, r, contract.goods);
      await notify(tx, userId, 'success', () => t('Партньорският товар е в {0} 🤝', name(r.relayCityId)), () => (r.partnerId ? t('Партньорът ти поема до {0}. Ако и двамата сте навреме — по +{1} %.', name(r.destCityId), Math.round(PARTNER.bonusShare * 100)) : t('Още нямаш партньор — покани някого, преди да изтекат {0} ч.', PARTNER.handoverHours)), `/game/contracts?partner=${r.id}`);
      return 0;
    }
    await notify(tx, userId, 'success', () => t('Щафетата е в {0} 🏃', name(r.relayCityId)), () => t('„{0}“ чака друг шофьор до {1} ({2} ч). Ако и двамата сте навреме — по +{3} %.', contract.goods, name(r.destCityId), RELAY.handoverHours, Math.round(RELAY.bonusShare * 100)), `/game/contracts?from=${r.relayCityId}`);
    return 0;
  }
  if (contract.relayLeg !== 2 || r.status !== 'leg2') return 0;
  await tx.update(relays).set({ status: 'done', leg2UserId: userId }).where(eq(relays.id, r.id));
  if (late || r.leg1Late || !r.leg1UserId || r.leg1UserId === userId) return 0;
  // Both on time, two players: each gets a share of their own leg.
  const [leg1] = await tx.select({ rewardCents: contracts.rewardCents }).from(contracts).where(eq(contracts.id, r.leg1ContractId));
  const [first] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, r.leg1UserId));
  const together = r.partner && r.partnerId === userId && r.leaderId === r.leg1UserId;
  const share = together ? PARTNER.bonusShare : RELAY.bonusShare;
  const mine = Math.round(contract.rewardCents * share);
  await post(tx, d.companyId, [{ category: 'bonus', amountCents: mine, description: t('Щафета навреме ({0})', name(r.destCityId)), idempotencyKey: `relay:${r.id}:leg2`, refType: 'delivery', refId: d.id }]);
  if (first && leg1) await post(tx, first.id, [{ category: 'bonus', amountCents: Math.round(leg1.rewardCents * share), description: t('Щафетата ти стигна до {0} навреме', name(r.destCityId)), idempotencyKey: `relay:${r.id}:leg1`, refType: 'delivery', refId: r.leg1DeliveryId ?? undefined }]);
  if (together) {
    const n = await partnersArrived(tx, r.leg1UserId, userId, at);
    for (const u of [userId, r.leg1UserId]) await notify(tx, u, 'success', () => t('Партньорският товар стигна навреме 🤝'), () => t('+{0} % и +{1} точки за пропуска за всеки. Заедно: {2}.', Math.round(PARTNER.bonusShare * 100), PARTNER.passPoints, n), '/game/finance');
    await askToRate(tx, r.id, r.leg1UserId, userId);
    return mine;
  }
  for (const u of [userId, r.leg1UserId]) {
    await badge(tx, u, at);
    await notify(tx, u, 'success', () => t('Щафетата стигна навреме 🏁'), () => t('Двама шофьори, един товар: +{0} % за всеки.', Math.round(RELAY.bonusShare * 100)), '/game/finance');
  }
  return mine;
}

/** Worker: a relay whose second leg nobody took in time ends (the first driver was already paid). */
export async function expireRelays(db: Database, now = new Date()) {
  const stale = await db.select().from(relays).innerJoin(contracts, eq(contracts.id, relays.leg2ContractId)).where(and(eq(relays.status, 'leg2'), inArray(contracts.status, ['open', 'expired']), lte(contracts.expiresAt, now)));
  for (const { relays: r } of stale) {
    await db.transaction(async (tx) => {
      const [done] = await tx.update(relays).set({ status: 'failed' }).where(and(eq(relays.id, r.id), eq(relays.status, 'leg2'))).returning();
      if (done && r.leg1UserId) await notify(tx, r.leg1UserId, 'info', () => t('Щафетата не продължи'), () => t('Никой не пое втората част навреме — твоят курс е платен, без бонус за щафета.'), '/game/contracts');
    });
  }
  // Relays whose first leg nobody took: both legs go.
  const unused = await db.select({ id: relays.id, leg2: relays.leg2ContractId }).from(relays).innerJoin(contracts, eq(contracts.id, relays.leg1ContractId)).where(and(eq(relays.status, 'leg1'), eq(contracts.status, 'expired')));
  for (const u of unused) {
    await db.update(relays).set({ status: 'expired' }).where(eq(relays.id, u.id));
    await db.update(contracts).set({ status: 'expired' }).where(and(eq(contracts.id, u.leg2), eq(contracts.status, 'held')));
  }
  return stale.length + unused.length;
}
