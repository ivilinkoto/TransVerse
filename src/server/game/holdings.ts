import { and, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { HOLDING } from '@/lib/game/empire';
import { periodWindow } from '@/lib/game/missions';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companyBranches, holdingInvites, holdingMembers, holdings, organizations, treasuryEntries } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { addChronicle } from './chronicle';
import { fail } from './errors';
import { post, postTreasury } from './finance';
import { membershipOf, notifyMembers, requirePermission } from './membership';
import { t as tr } from '@/i18n/t';

async function released(db: DbOrTx, userId: string, now: Date) {
  if (!(await featureFor(db, userId, 'holdings', now))) fail('not_released', tr('Това идва със следващото обновление.'), 403);
}

/** The holding a company is in, with its companies (the parent first). */
export async function holdingOf(db: DbOrTx, organizationId: string) {
  const [m] = await db.select({ holdingId: holdingMembers.holdingId }).from(holdingMembers).where(eq(holdingMembers.organizationId, organizationId));
  if (!m) return null;
  const [h] = await db.select().from(holdings).where(eq(holdings.id, m.holdingId));
  if (!h) return null;
  const companies = await db
    .select({ id: organizations.id, name: organizations.name, tag: organizations.tag, level: organizations.companyLevel, hqCityId: organizations.hqCityId, joinedAt: holdingMembers.joinedAt })
    .from(holdingMembers)
    .innerJoin(organizations, eq(organizations.id, holdingMembers.organizationId))
    .where(eq(holdingMembers.holdingId, h.id));
  companies.sort((a, b) => (a.id === h.parentId ? -1 : b.id === h.parentId ? 1 : a.joinedAt.getTime() - b.joinedAt.getTime()));
  return { ...h, companies };
}

/** A company of level 6+ founds a holding, paid from its treasury. */
export async function foundHolding(db: Database, actorId: string, rawName: string, now = new Date()) {
  await released(db, actorId, now);
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > HOLDING.nameMax) fail('invalid_name', tr('Името е от {0} до {1} символа.', 3, HOLDING.nameMax));
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_upgrades');
    if (actor.company.companyLevel < HOLDING.minCompanyLevel) fail('level', tr('Холдинг се основава от ниво {0} на компанията.', HOLDING.minCompanyLevel));
    if (await holdingOf(tx, actor.company.id)) fail('in_holding', tr('Компанията вече е в холдинг.'));
    const [taken] = await tx.select({ id: holdings.id }).from(holdings).where(sql`lower(${holdings.name}) = lower(${name})`);
    if (taken) fail('name_taken', tr('Холдинг с това име вече има.'), 409);
    const [h] = await tx.insert(holdings).values({ parentId: actor.company.id, name, createdAt: now }).returning();
    await postTreasury(tx, actor.company.id, [{ category: 'holding', amountCents: -HOLDING.foundCents, description: tr('Основаване на холдинга „{0}“', name), idempotencyKey: `holding:${h!.id}:found`, actorUserId: actorId }], { requireFunds: true });
    await tx.insert(holdingMembers).values({ holdingId: h!.id, organizationId: actor.company.id, joinedAt: now });
    await addChronicle(tx, actor.company.id, 'holding', `Основа холдинга „${name}“`, now);
    await notifyMembers(tx, actor.company.id, null, () => tr('Нов холдинг: „{0}“', name), () => tr('Поканете до {0} компании — товарите до базите и филиалите на всички плащат повече.', HOLDING.maxSubsidiaries), '/game/company/holding');
    return h!;
  });
}

/** The parent invites a company (by its tag or name). */
export async function inviteToHolding(db: Database, actorId: string, target: string, now = new Date()) {
  await released(db, actorId, now);
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_upgrades');
    const h = await holdingOf(tx, actor.company.id);
    if (!h) fail('no_holding', tr('Компанията не е в холдинг.'));
    if (h!.parentId !== actor.company.id) fail('not_parent', tr('Канят само от компанията-майка.'), 403);
    if (h!.companies.length - 1 >= HOLDING.maxSubsidiaries) fail('full', tr('Холдингът държи най-много {0} компании.', HOLDING.maxSubsidiaries));
    const name = target.trim();
    const [org] = await tx.select().from(organizations).where(or(sql`lower(${organizations.tag}) = lower(${name})`, sql`lower(${organizations.name}) = lower(${name})`));
    if (!org) fail('not_found', tr('Няма компания с такъв таг или име.'), 404);
    if (org!.id === actor.company.id) fail('self', tr('Това е твоята компания.'));
    if (await holdingOf(tx, org!.id)) fail('in_holding', tr('Тази компания вече е в холдинг.'));
    const [inv] = await tx.insert(holdingInvites).values({ holdingId: h!.id, organizationId: org!.id, expiresAt: new Date(now.getTime() + 72 * 3_600_000), createdAt: now }).returning();
    await notifyMembers(tx, org!.id, null, () => tr('Покана в холдинга „{0}“', h!.name), () => tr('„{0}“ кани компанията ви в холдинга си. Отговаря длъжност с право „Развитие“.', actor.company.name), '/game/company/holding');
    return inv!;
  });
}

/** The invited company answers. */
export async function respondHoldingInvite(db: Database, actorId: string, inviteId: string, accept: boolean, now = new Date()) {
  await released(db, actorId, now);
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_upgrades');
    const [inv] = await tx.select().from(holdingInvites).where(and(eq(holdingInvites.id, inviteId), eq(holdingInvites.organizationId, actor.company.id), eq(holdingInvites.status, 'pending'))).for('update');
    if (!inv || inv.expiresAt <= now) fail('no_invite', tr('Поканата не е валидна.'), 404);
    await tx.update(holdingInvites).set({ status: accept ? 'accepted' : 'declined' }).where(eq(holdingInvites.id, inv!.id));
    if (!accept) return null;
    if (await holdingOf(tx, actor.company.id)) fail('in_holding', tr('Компанията вече е в холдинг.'));
    const members = await tx.select().from(holdingMembers).where(eq(holdingMembers.holdingId, inv!.holdingId)).for('update');
    if (members.length - 1 >= HOLDING.maxSubsidiaries) fail('full', tr('Холдингът вече е пълен.'));
    await tx.insert(holdingMembers).values({ holdingId: inv!.holdingId, organizationId: actor.company.id, joinedAt: now });
    const [h] = await tx.select({ name: holdings.name }).from(holdings).where(eq(holdings.id, inv!.holdingId));
    await addChronicle(tx, actor.company.id, 'holding', `Влезе в холдинга „${h?.name ?? ''}“`, now);
    for (const m of members) await notifyMembers(tx, m.organizationId, null, () => tr('„{0}“ влезе в холдинга', actor.company.name), () => tr('Мрежата расте — още бази за товарите с бонус.'), '/game/company/holding');
    return inv!.holdingId;
  });
}

/**
 * A subsidiary leaves (not within a week of joining); the parent may let
 * one go (`organizationId`) or, alone, close the holding.
 */
export async function leaveHolding(db: Database, actorId: string, organizationId?: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_upgrades');
    const h = await holdingOf(tx, actor.company.id);
    if (!h) fail('no_holding', tr('Компанията не е в холдинг.'));
    const parent = h!.parentId === actor.company.id;
    const leaving = organizationId && parent ? organizationId : actor.company.id;
    const row = h!.companies.find((c) => c.id === leaving);
    if (!row) fail('not_found', tr('Тази компания не е в холдинга.'), 404);
    if (leaving === h!.parentId) {
      if (h!.companies.length > 1) fail('has_subsidiaries', tr('Първо пуснете дъщерните компании.'));
      await tx.delete(holdings).where(eq(holdings.id, h!.id));
      return { closed: true };
    }
    if (!parent && now.getTime() - row!.joinedAt.getTime() < HOLDING.minStayDays * 86_400_000) fail('too_soon', tr('Компанията може да напусне холдинга {0} дни след като е влязла.', HOLDING.minStayDays));
    await tx.delete(holdingMembers).where(eq(holdingMembers.organizationId, leaving));
    await notifyMembers(tx, h!.parentId, null, () => tr('„{0}“ напусна холдинга', row!.name), () => tr('Холдингът „{0}“ вече е без нея.', h!.name), '/game/company/holding');
    return { closed: false };
  });
}

/** The cities of a holding's network: every base and branch of its companies. */
export async function holdingNetwork(db: DbOrTx, holdingId: string): Promise<Set<number>> {
  const ids = (await db.select({ id: holdingMembers.organizationId }).from(holdingMembers).where(eq(holdingMembers.holdingId, holdingId))).map((r) => r.id);
  if (!ids.length) return new Set();
  const bases = await db.select({ cityId: organizations.hqCityId }).from(organizations).where(inArray(organizations.id, ids));
  const branches = await db.select({ cityId: companyBranches.cityId }).from(companyBranches).where(inArray(companyBranches.organizationId, ids));
  return new Set([...bases, ...branches].map((r) => r.cityId));
}

/** A member's load to a city of the holding's network pays a little more (personal account). */
export async function holdingBonus(tx: Tx, userId: string, d: { id: string; companyId: string }, destCityId: number, rewardCents: number, now: Date) {
  if (!(await featureFor(tx, userId, 'holdings', now))) return 0;
  const m = await membershipOf(tx, userId);
  if (!m) return 0;
  const [hm] = await tx.select({ holdingId: holdingMembers.holdingId }).from(holdingMembers).where(eq(holdingMembers.organizationId, m.company.id));
  if (!hm || !(await holdingNetwork(tx, hm.holdingId)).has(destCityId)) return 0;
  const [h] = await tx.select({ name: holdings.name }).from(holdings).where(eq(holdings.id, hm.holdingId));
  const bonus = Math.round(rewardCents * HOLDING.networkShare);
  if (bonus > 0) await post(tx, d.companyId, [{ category: 'holding_bonus', amountCents: bonus, description: tr('Мрежата на холдинга „{0}“', h?.name ?? ''), idempotencyKey: `delivery:${d.id}:holding`, refType: 'delivery', refId: d.id }]);
  return bonus;
}

/** Worker, each Monday: every subsidiary pays the parent its share of last week's contributions. */
export async function payHoldingFees(db: Database, now: Date) {
  const week = periodWindow('weekly', new Date(now.getTime() - 7 * 86_400_000));
  const until = periodWindow('weekly', now);
  const from = new Date(until.endsAt.getTime() - 14 * 86_400_000);
  const to = new Date(until.endsAt.getTime() - 7 * 86_400_000);
  let paid = 0;
  for (const h of await db.select().from(holdings)) {
    const subs = await db.select({ id: holdingMembers.organizationId }).from(holdingMembers).where(and(eq(holdingMembers.holdingId, h.id), sql`${holdingMembers.organizationId} <> ${h.parentId}`, lt(holdingMembers.joinedAt, to)));
    for (const s of subs) {
      const [{ c = 0 } = {}] = await db
        .select({ c: sql<number>`coalesce(sum(${treasuryEntries.amountCents}), 0)::bigint`.mapWith(Number) })
        .from(treasuryEntries)
        .where(and(eq(treasuryEntries.organizationId, s.id), eq(treasuryEntries.category, 'member_contribution'), gte(treasuryEntries.createdAt, from), lt(treasuryEntries.createdAt, to)));
      const fee = Math.floor(c * HOLDING.feeShare);
      if (fee <= 0) continue;
      await db.transaction(async (tx) => {
        const [sub] = await tx.select({ name: organizations.name, treasury: organizations.treasuryCents }).from(organizations).where(eq(organizations.id, s.id));
        const amount = Math.min(fee, Math.max(0, sub?.treasury ?? 0));
        if (amount <= 0) return;
        // Lower id first: a fixed lock order between the two treasuries.
        const out = { category: 'holding' as const, amountCents: -amount, description: tr('Такса към холдинга „{0}“ ({1})', h.name, week.key.slice(1)), idempotencyKey: `holding-fee:${h.id}:${week.key}:${s.id}:out` };
        const into = { category: 'holding' as const, amountCents: amount, description: tr('Такса от „{0}“ ({1})', sub!.name, week.key.slice(1)), idempotencyKey: `holding-fee:${h.id}:${week.key}:${s.id}:in` };
        if (s.id < h.parentId) {
          await postTreasury(tx, s.id, [out]);
          await postTreasury(tx, h.parentId, [into]);
        } else {
          await postTreasury(tx, h.parentId, [into]);
          await postTreasury(tx, s.id, [out]);
        }
        paid++;
      });
    }
  }
  return paid;
}

/** The holdings by their companies and total level (for the ranking). */
export async function holdingTable(db: DbOrTx, limit = 50) {
  return db
    .select({ id: holdings.id, name: holdings.name, parentId: holdings.parentId, companies: sql<number>`count(${holdingMembers.organizationId})::int`, levels: sql<number>`sum(${organizations.companyLevel})::int` })
    .from(holdings)
    .innerJoin(holdingMembers, eq(holdingMembers.holdingId, holdings.id))
    .innerJoin(organizations, eq(organizations.id, holdingMembers.organizationId))
    .groupBy(holdings.id)
    .orderBy(sql`sum(${organizations.companyLevel}) desc`)
    .limit(limit);
}

/** Pending invitations of a company. */
export async function holdingInvitesFor(db: DbOrTx, organizationId: string, now = new Date()) {
  return db
    .select({ id: holdingInvites.id, holding: holdings.name, expiresAt: holdingInvites.expiresAt })
    .from(holdingInvites)
    .innerJoin(holdings, eq(holdings.id, holdingInvites.holdingId))
    .where(and(eq(holdingInvites.organizationId, organizationId), eq(holdingInvites.status, 'pending'), sql`${holdingInvites.expiresAt} > ${now}`));
}
