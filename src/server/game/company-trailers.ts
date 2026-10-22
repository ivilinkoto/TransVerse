import { and, asc, eq, isNull } from 'drizzle-orm';
import { stickerText } from '@/lib/game/cosmetics';
import { COMPANY_TRAILERS, trailerLimit } from '@/lib/game/company-fleet';
import type { UpgradeLevels } from '@/lib/game/company';
import { isTrailerUpgrade, TRAILER_UPGRADES, TRAILERS, trailerModel, type TrailerUpgradeId } from '@/lib/game/catalog';
import { resaleValueCents } from '@/lib/game/economy';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, orgTrailers, organizations, trailers, users, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { fail } from './errors';
import { postTreasury } from './finance';
import { membershipOf, notifyMembers, requirePermission } from './membership';
import { uniquePlate } from './names';
import { logActivity } from './notify';

type OrgTrailer = typeof orgTrailers.$inferSelect;

const ageDays = (from: Date, now: Date) => (now.getTime() - from.getTime()) / 86_400_000;

async function released(db: DbOrTx, userId: string, now: Date) {
  if (!(await featureFor(db, userId, 'company_trailers', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
}

/** The company's trailers: in the yard or with a member. */
export async function orgTrailersView(db: DbOrTx, organizationId: string) {
  const [org] = await db.select({ upgrades: organizations.upgrades }).from(organizations).where(eq(organizations.id, organizationId));
  if (!org) return null;
  const rows = await db
    .select({ t: orgTrailers, borrower: users.username, city: cities.nameBg })
    .from(orgTrailers)
    .leftJoin(users, eq(users.id, orgTrailers.lentTo))
    .innerJoin(cities, eq(cities.id, orgTrailers.cityId))
    .where(and(eq(orgTrailers.organizationId, organizationId), isNull(orgTrailers.soldAt)))
    .orderBy(asc(orgTrailers.createdAt));
  return {
    limit: trailerLimit(org.upgrades as UpgradeLevels),
    trailers: rows.map((r) => ({ id: r.t.id, modelId: r.t.modelId, name: trailerModel(r.t.modelId).name, plate: r.t.plate, city: r.city, condition: r.t.condition, upgrades: r.t.upgrades, borrower: r.borrower, lentTo: r.t.lentTo })),
  };
}

/** Buys a trailer for the company from the treasury (places: 2 per parking level). */
export async function buyOrgTrailer(db: Database, actorId: string, modelId: string, now = new Date()) {
  await released(db, actorId, now);
  const model = TRAILERS.find((m) => m.id === modelId);
  if (!model) fail('unknown_model', 'Непознато ремарке.');
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_upgrades');
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, actor.company.id)).for('update');
    const limit = trailerLimit(org!.upgrades as UpgradeLevels);
    if (!limit) fail('no_parking', 'Първо постройте паркинг на участъка.');
    const have = await tx.select({ id: orgTrailers.id }).from(orgTrailers).where(and(eq(orgTrailers.organizationId, org!.id), isNull(orgTrailers.soldAt)));
    if (have.length >= limit) fail('parking_full', `Паркингът побира ${limit} фирмени ремаркета — вдигнете нивото му.`);
    const [row] = await tx.insert(orgTrailers).values({ organizationId: org!.id, modelId: model!.id, plate: await uniquePlate(tx), cityId: org!.hqCityId, createdAt: now }).returning();
    await postTreasury(tx, org!.id, [{ category: 'company_trailer', amountCents: -model!.priceCents, description: `Фирмено ремарке: ${model!.name} (${row!.plate})`, idempotencyKey: `org-trailer:${row!.id}:buy`, actorUserId: actorId, refType: 'org_trailer', refId: row!.id }], { requireFunds: true });
    await notifyMembers(tx, org!.id, null, 'Ново фирмено ремарке', `${model!.name} (${row!.plate}) чака на паркинга — всеки член може да го вземе. Курсовете с него носят бонус за касата.`, '/game/company/plot');
    await logActivity(tx, actorId, 'org_trailer_bought', { id: row!.id, modelId });
    return row!;
  });
}

async function lockOrgTrailer(tx: Tx, organizationId: string, id: string): Promise<OrgTrailer> {
  const [t] = await tx.select().from(orgTrailers).where(and(eq(orgTrailers.id, id), eq(orgTrailers.organizationId, organizationId), isNull(orgTrailers.soldAt))).for('update');
  if (!t) fail('not_found', 'Няма такова фирмено ремарке.', 404);
  return t!;
}

/** Sells a company trailer that is in the yard; the money goes back to the treasury. */
export async function sellOrgTrailer(db: Database, actorId: string, orgTrailerId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_upgrades');
    const t = await lockOrgTrailer(tx, actor.company.id, orgTrailerId);
    if (t.lentTo) fail('lent', 'Ремаркето е при член на компанията — първо трябва да го върне.');
    const value = resaleValueCents(trailerModel(t.modelId).priceCents, t.condition, ageDays(t.createdAt, now));
    await tx.update(orgTrailers).set({ soldAt: now }).where(eq(orgTrailers.id, t.id));
    await postTreasury(tx, actor.company.id, [{ category: 'company_trailer', amountCents: value, description: `Продадено фирмено ремарке (${t.plate})`, idempotencyKey: `org-trailer:${t.id}:sell`, actorUserId: actorId, refType: 'org_trailer', refId: t.id }]);
    return value;
  });
}

/** On dissolution: every company trailer (all in the yard by now) is sold into the treasury. */
export async function sellTrailersOnDissolve(tx: Tx, organizationId: string, now: Date) {
  const rows = await tx.select().from(orgTrailers).where(and(eq(orgTrailers.organizationId, organizationId), isNull(orgTrailers.soldAt))).for('update');
  let sum = 0;
  for (const t of rows) {
    const value = resaleValueCents(trailerModel(t.modelId).priceCents, t.condition, ageDays(t.createdAt, now));
    await tx.update(orgTrailers).set({ soldAt: now }).where(eq(orgTrailers.id, t.id));
    await postTreasury(tx, organizationId, [{ category: 'company_trailer', amountCents: value, description: `Продадено фирмено ремарке (${t.plate})`, idempotencyKey: `org-trailer:${t.id}:sell`, refType: 'org_trailer', refId: t.id }]);
    sum += value;
  }
  return sum;
}

/** Upgrades on a company trailer (from the treasury); it must be in the yard. */
export async function upgradeOrgTrailer(db: Database, actorId: string, orgTrailerId: string, upgradeId: string, now = new Date()) {
  await released(db, actorId, now);
  if (!isTrailerUpgrade(upgradeId) || upgradeId === 'company_logo') fail('unknown_upgrade', 'Непознато подобрение (фирмените ремаркета вече са с логото).');
  const upgrade = TRAILER_UPGRADES[upgradeId as TrailerUpgradeId];
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_upgrades');
    const t = await lockOrgTrailer(tx, actor.company.id, orgTrailerId);
    if (t.lentTo) fail('lent', 'Ремаркето е при член на компанията — подобрения се монтират на паркинга.');
    if (upgrade.bodies && !upgrade.bodies.includes(trailerModel(t.modelId).body)) fail('not_applicable', 'Подобрението не е приложимо за този тип ремарке.');
    if (t.upgrades.includes(upgrade.id)) fail('already_installed', 'Вече е монтирано.');
    await postTreasury(tx, actor.company.id, [{ category: 'company_trailer', amountCents: -upgrade.priceCents, description: `${upgrade.label} — фирмено ремарке ${t.plate}`, idempotencyKey: `org-trailer:${t.id}:upgrade:${upgrade.id}`, actorUserId: actorId, refType: 'org_trailer', refId: t.id }], { requireFunds: true });
    await tx.update(orgTrailers).set({ upgrades: [...t.upgrades, upgrade.id] }).where(eq(orgTrailers.id, t.id));
    return upgrade.priceCents;
  });
}

/** A member takes a company trailer from the yard: it joins their fleet where it stands. One at a time. */
export async function borrowOrgTrailer(db: Database, userId: string, orgTrailerId: string, now = new Date()) {
  await released(db, userId, now);
  return db.transaction(async (tx) => {
    const m = await membershipOf(tx, userId);
    if (!m) fail('not_member', 'Не членувате в компания.', 403);
    const t = await lockOrgTrailer(tx, m!.company.id, orgTrailerId);
    if (t.lentTo) fail('lent', 'Ремаркето вече е взето от друг член.');
    const [account] = await tx.select().from(companies).where(eq(companies.ownerId, userId));
    if (!account) fail('company_not_found', 'Профилът няма игрови акаунт.', 404);
    const [mine] = await tx.select({ id: trailers.id }).from(trailers).where(and(eq(trailers.companyId, account!.id), eq(trailers.ownership, 'company'), isNull(trailers.soldAt)));
    if (mine) fail('has_company_trailer', 'Вече имате фирмено ремарке — върнете го, преди да вземете друго.');
    const [row] = await tx
      .insert(trailers)
      .values({ companyId: account!.id, modelId: t.modelId, plate: t.plate, cityId: t.cityId, condition: t.condition, ownership: 'company', purchasePriceCents: 0, upgrades: [...t.upgrades, 'company_logo'], logo: stickerText(m!.company.name), orgTrailerId: t.id })
      .returning();
    await tx.update(orgTrailers).set({ lentTo: userId, trailerId: row!.id }).where(eq(orgTrailers.id, t.id));
    await logActivity(tx, userId, 'org_trailer_borrowed', { id: t.id });
    return row!;
  });
}

/** Gives a borrowed trailer back (not on a trip): its wear and city go with it. */
export async function returnCompanyTrailer(tx: Tx, trailerId: string, now: Date) {
  const [t] = await tx.select().from(trailers).where(and(eq(trailers.id, trailerId), eq(trailers.ownership, 'company'), isNull(trailers.soldAt))).for('update');
  if (!t) fail('trailer_not_found', 'Ремаркето не е намерено.', 404);
  if (t!.vehicleId) {
    const [v] = await tx.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, t!.vehicleId));
    if (v?.status !== 'idle') fail('trailer_busy', 'Ремаркето е на курс — върнете го след края му.');
  }
  await tx.update(trailers).set({ vehicleId: null, soldAt: now }).where(eq(trailers.id, t!.id));
  if (t!.orgTrailerId) await tx.update(orgTrailers).set({ lentTo: null, trailerId: null, cityId: t!.cityId, condition: t!.condition }).where(eq(orgTrailers.id, t!.orgTrailerId));
}

export async function returnOrgTrailer(db: Database, userId: string, trailerId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [account] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
    const [t] = await tx.select({ id: trailers.id }).from(trailers).where(and(eq(trailers.id, trailerId), eq(trailers.companyId, account?.id ?? '00000000-0000-0000-0000-000000000000')));
    if (!t) fail('trailer_not_found', 'Ремаркето не е намерено.', 404);
    await returnCompanyTrailer(tx, trailerId, now);
  });
}

/** A member leaves: a borrowed trailer not on a trip goes back at once; one on a trip fails the leave. */
export async function returnTrailersOnLeave(tx: Tx, userId: string, now: Date) {
  const rows = await tx
    .select({ id: trailers.id })
    .from(trailers)
    .innerJoin(companies, eq(companies.id, trailers.companyId))
    .where(and(eq(companies.ownerId, userId), eq(trailers.ownership, 'company'), isNull(trailers.soldAt)));
  for (const r of rows) await returnCompanyTrailer(tx, r.id, now);
}

/** The bonus of a trip made with a company trailer: a share of the freight into the treasury. */
export async function companyTrailerBonus(tx: Tx, organizationId: string, deliveryId: string, rewardCents: number, username: string) {
  const bonus = Math.round(rewardCents * COMPANY_TRAILERS.treasuryShare);
  if (bonus <= 0) return 0;
  await postTreasury(tx, organizationId, [{ category: 'company_trailer', amountCents: bonus, description: `Курс с фирмено ремарке: ${username}`, idempotencyKey: `org-trailer-bonus:${deliveryId}`, refType: 'delivery', refId: deliveryId }]);
  return bonus;
}
