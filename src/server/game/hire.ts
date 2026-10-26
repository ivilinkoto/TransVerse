import { and, asc, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { money } from '@/lib/format';
import { commissionCents, HIRE_RULES } from '@/lib/game/hire';
import { isOnline } from '@/lib/game/social';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, jobOffers, organizations, users, vehicles } from '@/server/db/schema';
import { companyForUser } from './company';
import { fail } from './errors';
import { post, postTreasury } from './finance';
import { can, membershipOf, requirePermission } from './membership';
import { assertNotBlocked } from './moderation';
import { broadcast, notify } from './notify';
import { t } from '@/i18n/t';

export const offerSchema = z.object({
  contractId: z.string().uuid(),
  toUserId: z.string().uuid(),
  share: z.coerce.number().min(HIRE_RULES.minShare).max(HIRE_RULES.maxShare),
});

export async function setForHire(db: DbOrTx, userId: string, on: boolean) {
  await db.update(users).set({ forHire: on }).where(eq(users.id, userId));
}

/** A load anyone may take from the board (not urgent, not private, still open). */
const isPublicOpen = (c: typeof contracts.$inferSelect, now: Date) =>
  c.status === 'open' && c.expiresAt > now && !c.urgent && !c.tenderId && !c.tradeCompanyId && !c.auctionId && !c.clientContractId;

/**
 * Players available for hire for a load, nearest free truck first: name,
 * level, online, and how far their nearest idle truck is from the pickup.
 */
export async function hireCandidates(db: DbOrTx, actorId: string, contractId: string, now = new Date()) {
  const [c] = await db.select({ originCityId: contracts.originCityId }).from(contracts).where(eq(contracts.id, contractId));
  if (!c) return [];
  const [origin] = await db.select({ lat: cities.lat, lon: cities.lon }).from(cities).where(eq(cities.id, c.originCityId));
  const rows = await db
    .select({ userId: users.id, username: users.username, level: users.level, lastSeenAt: users.lastSeenAt, lat: cities.lat, lon: cities.lon, city: cities.nameBg })
    .from(users)
    .innerJoin(companies, eq(companies.ownerId, users.id))
    .innerJoin(vehicles, and(eq(vehicles.companyId, companies.id), eq(vehicles.status, 'idle'), isNull(vehicles.soldAt)))
    .innerJoin(cities, eq(cities.id, vehicles.cityId))
    .where(and(eq(users.forHire, true), isNull(users.bannedAt), ne(users.id, actorId)));
  const best = new Map<string, { userId: string; username: string; level: number; online: boolean; city: string; km: number }>();
  for (const r of rows) {
    const km = origin ? Math.round(haversineKm([origin.lat, origin.lon], [r.lat, r.lon])) : 0;
    const prev = best.get(r.userId);
    if (!prev || km < prev.km) best.set(r.userId, { userId: r.userId, username: r.username, level: r.level, online: isOnline(r.lastSeenAt, now), city: r.city, km });
  }
  return [...best.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.km - b.km).slice(0, 20);
}

/** A company member with the right hands a board load to a free player; the load is held for them. */
export async function offerJob(db: Database, actorId: string, raw: z.input<typeof offerSchema>, now = new Date()) {
  const input = offerSchema.parse(raw);
  if (input.toUserId === actorId) fail('self', t('Не можеш да възложиш курс на себе си.'));
  return db.transaction(async (tx) => {
    const m = await requirePermission(tx, actorId, 'manage_tenders');
    const [target] = await tx.select({ id: users.id, username: users.username, forHire: users.forHire, bannedAt: users.bannedAt }).from(users).where(eq(users.id, input.toUserId));
    if (!target || target.bannedAt) fail('player_not_found', t('Играчът не е намерен.'), 404);
    if (!target!.forHire) fail('not_for_hire', t('Играчът не приема курсове от компании.'));
    await assertNotBlocked(tx, actorId, target!.id);
    const [pending] = await tx.select({ n: sql<number>`count(*)::int` }).from(jobOffers).where(and(eq(jobOffers.organizationId, m.company.id), eq(jobOffers.status, 'pending'), gt(jobOffers.expiresAt, now)));
    if ((pending?.n ?? 0) >= HIRE_RULES.maxPendingPerCompany) fail('too_many_offers', t('Компанията има {0} чакащи предложения — изчакай отговор.', HIRE_RULES.maxPendingPerCompany));
    const [c] = await tx.select().from(contracts).where(eq(contracts.id, input.contractId)).for('update');
    if (!c || !isPublicOpen(c, now)) fail('contract_unavailable', t('Поръчката вече не е налична за възлагане.'), 409);
    const account = await companyForUser(tx, target!.id);
    if (c!.reservedUntil && c!.reservedUntil > now && c!.reservedByCompanyId !== account.id) fail('reserved', t('Поръчката е запазена от друг играч.'), 409);
    const expiresAt = new Date(now.getTime() + HIRE_RULES.offerMinutes * 60_000);
    await tx.update(contracts).set({ reservedByCompanyId: account.id, reservedUntil: expiresAt }).where(eq(contracts.id, c!.id));
    const [offer] = await tx.insert(jobOffers).values({ contractId: c!.id, organizationId: m.company.id, offeredBy: actorId, toUserId: target!.id, share: input.share, expiresAt, createdAt: now }).returning({ id: jobOffers.id });
    const [from, to] = await Promise.all([tx.select({ n: cities.nameBg }).from(cities).where(eq(cities.id, c!.originCityId)), tx.select({ n: cities.nameBg }).from(cities).where(eq(cities.id, c!.destCityId))]);
    await notify(tx, target!.id, 'info', () => t('„{0}“ ти възлага курс', m.company.name), () => t('{0}: {1} → {2} за {3}, комисиона {4} % към компанията. Поръчката е запазена за теб {5} мин.', c!.goods, from[0]?.n, to[0]?.n, money(c!.rewardCents), Math.round(input.share * 100), HIRE_RULES.offerMinutes), '/game/contracts?hired=1');
    await broadcast(tx, 'market');
    return { id: offer!.id, expiresAt };
  });
}

/** The driver turns the offer down; the load goes back to the board. */
export async function declineJob(db: Database, userId: string, offerId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(jobOffers).where(and(eq(jobOffers.id, offerId), eq(jobOffers.toUserId, userId))).for('update');
    if (!o || o.status !== 'pending') fail('offer_closed', t('Предложението вече не е активно.'), 409);
    await tx.update(jobOffers).set({ status: 'declined' }).where(eq(jobOffers.id, o!.id));
    const account = await companyForUser(tx, userId);
    await tx.update(contracts).set({ reservedByCompanyId: null, reservedUntil: null }).where(and(eq(contracts.id, o!.contractId), eq(contracts.reservedByCompanyId, account.id)));
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    if (o!.offeredBy) await notify(tx, o!.offeredBy, 'info', () => t('{0} отказа курса', me!.username), () => t('Поръчката е отново на борсата.'), '/game/contracts');
    await broadcast(tx, 'market');
    return now;
  });
}

/** Called when a player takes a load: an open offer for it becomes accepted and is tied to the trip. */
export async function acceptJobOffer(tx: Tx, userId: string, contractId: string, deliveryId: string, now: Date) {
  const [o] = await tx
    .update(jobOffers)
    .set({ status: 'accepted', deliveryId })
    .where(and(eq(jobOffers.contractId, contractId), eq(jobOffers.toUserId, userId), eq(jobOffers.status, 'pending'), gt(jobOffers.expiresAt, now)))
    .returning();
  if (o?.offeredBy) {
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    await notify(tx, o.offeredBy, 'success', () => t('{0} пое възложения курс', me!.username), () => t('Комисионата ({0} %) влиза в касата при доставката.', Math.round(o.share * 100)), '/game/company');
  }
  return o ?? null;
}

/** At settlement: the driver pays the agreed commission to the company's treasury. Returns the amount. */
export async function payHireCommission(tx: Tx, delivery: { id: string; companyId: string }, rewardCents: number) {
  const [o] = await tx.select().from(jobOffers).where(and(eq(jobOffers.deliveryId, delivery.id), eq(jobOffers.status, 'accepted'))).for('update');
  if (!o) return 0;
  const amount = commissionCents(rewardCents, o.share);
  const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, o.organizationId));
  const [driver] = await tx.select({ username: users.username }).from(users).innerJoin(companies, eq(companies.ownerId, users.id)).where(eq(companies.id, delivery.companyId));
  // The driver's account first, then the treasury (the same lock order as delivery settlement).
  await post(tx, delivery.companyId, [{ category: 'hire_commission', amountCents: -amount, description: t('Комисиона към „{0}“ ({1} %)', org?.name ?? t('компания'), Math.round(o.share * 100)), idempotencyKey: `delivery:${delivery.id}:hire`, refType: 'delivery', refId: delivery.id }]);
  if (org) await postTreasury(tx, o.organizationId, [{ category: 'hire_commission', amountCents: amount, description: t('Възложен курс: {0}', driver?.username ?? ''), idempotencyKey: `delivery:${delivery.id}:hire-in`, refType: 'delivery', refId: delivery.id }]);
  await tx.update(jobOffers).set({ status: 'done' }).where(eq(jobOffers.id, o.id));
  return amount;
}

/** Open offers to this player (for the board). */
export async function offersFor(db: DbOrTx, userId: string, now = new Date()) {
  return db
    .select({ id: jobOffers.id, contractId: jobOffers.contractId, share: jobOffers.share, expiresAt: jobOffers.expiresAt, company: organizations.name, tag: organizations.tag })
    .from(jobOffers)
    .innerJoin(organizations, eq(organizations.id, jobOffers.organizationId))
    .where(and(eq(jobOffers.toUserId, userId), eq(jobOffers.status, 'pending'), gt(jobOffers.expiresAt, now)))
    .orderBy(asc(jobOffers.expiresAt));
}

/** The company's recent offers (company page). */
export async function companyOffers(db: DbOrTx, organizationId: string, limit = 20) {
  return db
    .select({ id: jobOffers.id, status: jobOffers.status, share: jobOffers.share, expiresAt: jobOffers.expiresAt, createdAt: jobOffers.createdAt, driver: users.username, goods: contracts.goods, rewardCents: contracts.rewardCents })
    .from(jobOffers)
    .innerJoin(users, eq(users.id, jobOffers.toUserId))
    .innerJoin(contracts, eq(contracts.id, jobOffers.contractId))
    .where(eq(jobOffers.organizationId, organizationId))
    .orderBy(desc(jobOffers.createdAt))
    .limit(limit);
}

/** Does this player have the right to hand out loads (for the board button)? */
export async function canOfferJobs(db: DbOrTx, userId: string): Promise<boolean> {
  const m = await membershipOf(db, userId);
  return !!m && can(m.rank, 'manage_tenders');
}
