import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { money } from '@/lib/format';
import { ACADEMY, ALLIANCE, ALLIANCE_HALL, COMPANY_CONTRACT, fuelDiscount, hallBonusShare, hallNextTons } from '@/lib/game/alliances';
import type { UpgradeLevels } from '@/lib/game/company';
import { periodWindow } from '@/lib/game/missions';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { academyStudents, allianceInvites, cities, allianceMembers, alliances, allianceWeeks, chatMessages, companyContracts, companyMembers, organizations, users } from '@/server/db/schema';
import { rateLimit } from '@/server/auth/rate-limit';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { fail } from './errors';
import { post, postTreasury } from './finance';
import { discordConfig } from '@/server/discord/config';
import { enqueue, queueRoles } from '@/server/discord/outbox';
import { addCompanyXp, membershipOf, notifyMembers, requirePermission } from './membership';
import { messageBodySchema } from './messages';
import { assertNotMuted } from './moderation';
import { notify } from './notify';
import { addChronicle } from './chronicle';
import { t as tr } from '@/i18n/t';

async function released(db: DbOrTx, userId: string, id: 'alliances' | 'company_contracts' | 'academy' | 'alliance_discord', now: Date) {
  if (!(await featureFor(db, userId, id, now))) fail('not_released', tr('Това идва със следващото обновление.'), 403);
}

// ── Fuel station ──────────────────────────────────────────────────────────

/**
 * The company fuel station in a city (the best one, when several companies
 * have their base there): for a member of that company a discount, for
 * anyone else the company earns a margin.
 */
export async function fuelStationAt(tx: DbOrTx, cityId: number, userId: string, now: Date) {
  if (!(await featureFor(tx, userId, 'fuel_station', now))) return null;
  const rows = await tx.select({ id: organizations.id, upgrades: organizations.upgrades }).from(organizations).where(and(eq(organizations.hqCityId, cityId), sql`coalesce((${organizations.upgrades}->>'fuel')::int, 0) > 0`));
  if (!rows.length) return null;
  const m = await membershipOf(tx, userId);
  const own = rows.find((r) => r.id === m?.company.id);
  if (own) return { orgId: own.id, member: true, discount: fuelDiscount((own.upgrades as UpgradeLevels).fuel ?? 0) };
  // The alliance's fuel card (v1.5): an allied company's station gives its members' discount, without the margin.
  if (m && (await featureFor(tx, userId, 'alliance_fuel', now))) {
    const allied = await tx.select({ id: allianceMembers.organizationId }).from(allianceMembers).where(sql`${allianceMembers.allianceId} = (select alliance_id from alliance_members where organization_id = ${m.company.id})`);
    const best = rows.filter((r) => allied.some((a) => a.id === r.id)).sort((a, b) => ((b.upgrades as UpgradeLevels).fuel ?? 0) - ((a.upgrades as UpgradeLevels).fuel ?? 0))[0];
    if (best) return { orgId: best.id, member: true, discount: fuelDiscount((best.upgrades as UpgradeLevels).fuel ?? 0) };
  }
  const best = rows.sort((a, b) => ((b.upgrades as UpgradeLevels).fuel ?? 0) - ((a.upgrades as UpgradeLevels).fuel ?? 0))[0]!;
  return { orgId: best.id, member: false, discount: 0 };
}

// ── Alliances ─────────────────────────────────────────────────────────────

export async function allianceOf(db: DbOrTx, organizationId: string) {
  const [row] = await db.select({ a: alliances }).from(allianceMembers).innerJoin(alliances, eq(alliances.id, allianceMembers.allianceId)).where(eq(allianceMembers.organizationId, organizationId));
  if (!row) return null;
  const members = await db.select({ id: organizations.id, name: organizations.name, tag: organizations.tag }).from(allianceMembers).innerJoin(organizations, eq(organizations.id, allianceMembers.organizationId)).where(eq(allianceMembers.allianceId, row.a.id));
  return { ...row.a, members };
}

/** The bases (HQ cities) of the player's company and of the other companies in its alliance — for the map (v1.5). */
export async function allianceBases(db: DbOrTx, userId: string) {
  const m = await membershipOf(db, userId);
  if (!m) return [];
  const ids = [m.company.id, ...((await allianceOf(db, m.company.id))?.members.map((x) => x.id) ?? [])];
  const rows = await db
    .select({ id: organizations.id, name: organizations.name, tag: organizations.tag, color: organizations.color, city: cities.nameBg, lat: cities.lat, lon: cities.lon })
    .from(organizations)
    .innerJoin(cities, eq(cities.id, organizations.hqCityId))
    .where(inArray(organizations.id, [...new Set(ids)]));
  return rows.map((r) => ({ name: r.tag ? `[${r.tag}] ${r.name}` : r.name, city: r.city, color: r.color, position: [r.lat, r.lon] as [number, number], own: r.id === m.company.id }));
}

export async function createAlliance(db: Database, actorId: string, rawName: string, now = new Date()) {
  await released(db, actorId, 'alliances', now);
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (name.length < ALLIANCE.nameMin || name.length > ALLIANCE.nameMax) fail('invalid_name', tr('Името е от {0} до {1} символа.', ALLIANCE.nameMin, ALLIANCE.nameMax));
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_settings');
    if (await allianceOf(tx, actor.company.id)) fail('in_alliance', tr('Компанията вече е в съюз.'));
    const [taken] = await tx.select({ id: alliances.id }).from(alliances).where(sql`lower(${alliances.name}) = lower(${name})`);
    if (taken) fail('name_taken', tr('Съюз с това име вече има.'), 409);
    const [a] = await tx.insert(alliances).values({ name, leaderOrgId: actor.company.id, createdAt: now }).returning();
    await tx.insert(allianceMembers).values({ allianceId: a!.id, organizationId: actor.company.id, joinedAt: now });
    await addChronicle(tx, actor.company.id, 'alliance', `Основа съюза „${name}“`, now);
    await notifyMembers(tx, actor.company.id, null, () => tr('Нов съюз: „{0}“', name), () => tr('Поканете още компании — заедно имате седмична цел и битка срещу друг съюз.'), '/game/company/alliance');
    return a!;
  });
}

/** The leader company invites another company (by its tag or name). */
export async function inviteToAlliance(db: Database, actorId: string, target: string, now = new Date()) {
  await released(db, actorId, 'alliances', now);
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_settings');
    const a = await allianceOf(tx, actor.company.id);
    if (!a) fail('no_alliance', tr('Компанията не е в съюз.'));
    if (a!.leaderOrgId !== actor.company.id) fail('not_leader', tr('Канят само от водещата компания на съюза.'), 403);
    if (a!.members.length >= ALLIANCE.maxCompanies) fail('full', tr('В съюза са най-много {0} компании.', ALLIANCE.maxCompanies));
    const t = target.trim();
    const [org] = await tx.select().from(organizations).where(or(sql`lower(${organizations.tag}) = lower(${t})`, sql`lower(${organizations.name}) = lower(${t})`));
    if (!org) fail('not_found', tr('Няма компания с такъв таг или име.'), 404);
    if (org!.id === actor.company.id) fail('self', tr('Това е твоята компания.'));
    if (await allianceOf(tx, org!.id)) fail('in_alliance', tr('Тази компания вече е в съюз.'));
    const [inv] = await tx.insert(allianceInvites).values({ allianceId: a!.id, organizationId: org!.id, expiresAt: new Date(now.getTime() + ALLIANCE.inviteHours * 3_600_000), createdAt: now }).returning();
    await notifyMembers(tx, org!.id, null, () => tr('Покана за съюза „{0}“', a!.name), () => tr('„{0}“ кани компанията ви в съюз. Отговаря длъжност с право „Настройки“.', actor.company.name), '/game/company/alliance');
    return inv!;
  });
}

export async function respondAllianceInvite(db: Database, actorId: string, inviteId: string, accept: boolean, now = new Date()) {
  await released(db, actorId, 'alliances', now);
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_settings');
    const [inv] = await tx.select().from(allianceInvites).where(and(eq(allianceInvites.id, inviteId), eq(allianceInvites.organizationId, actor.company.id), eq(allianceInvites.status, 'pending'))).for('update');
    if (!inv || inv.expiresAt <= now) fail('no_invite', tr('Поканата не е валидна.'), 404);
    await tx.update(allianceInvites).set({ status: accept ? 'accepted' : 'declined' }).where(eq(allianceInvites.id, inv!.id));
    if (!accept) return null;
    if (await allianceOf(tx, actor.company.id)) fail('in_alliance', tr('Компанията вече е в съюз.'));
    const members = await tx.select().from(allianceMembers).where(eq(allianceMembers.allianceId, inv!.allianceId)).for('update');
    if (members.length >= ALLIANCE.maxCompanies) fail('full', tr('Съюзът вече е пълен.'));
    await tx.insert(allianceMembers).values({ allianceId: inv!.allianceId, organizationId: actor.company.id, joinedAt: now });
    await queueAllianceRoles(tx, [actor.company.id], now);
    const [joined] = await tx.select({ name: alliances.name }).from(alliances).where(eq(alliances.id, inv!.allianceId));
    await addChronicle(tx, actor.company.id, 'alliance', `Влезе в съюза „${joined?.name ?? ''}“`, now);
    for (const m of members) await notifyMembers(tx, m.organizationId, null, () => tr('„{0}“ влезе в съюза', actor.company.name), () => tr('Съюзът расте — повече тонове за общата цел.'), '/game/company/alliance');
    return inv!.allianceId;
  });
}

/** The company leaves its alliance; the last one out (or the leader leaving) closes it. */
export async function leaveAlliance(db: Database, actorId: string) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_settings');
    const a = await allianceOf(tx, actor.company.id);
    if (!a) fail('no_alliance', tr('Компанията не е в съюз.'));
    await tx.delete(allianceMembers).where(eq(allianceMembers.organizationId, actor.company.id));
    await queueAllianceRoles(tx, [actor.company.id], new Date());
    const left = a!.members.filter((m) => m.id !== actor.company.id);
    if (!left.length) await tx.delete(alliances).where(eq(alliances.id, a!.id));
    else if (a!.leaderOrgId === actor.company.id) await tx.update(alliances).set({ leaderOrgId: left[0]!.id }).where(eq(alliances.id, a!.id));
  });
}

/** The leader company dissolves the alliance: it is gone for every company in it (its chat too). */
export async function dissolveAlliance(db: Database, actorId: string) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_settings');
    const a = await allianceOf(tx, actor.company.id);
    if (!a) fail('no_alliance', tr('Компанията не е в съюз.'));
    if (a!.leaderOrgId !== actor.company.id) fail('not_leader', tr('Съюза разпуска само водещата компания.'), 403);
    await tx.delete(chatMessages).where(eq(chatMessages.channel, allianceChannel(a!.id)));
    const [row] = await tx.select({ channelId: alliances.discordChannelId, roleId: alliances.discordRoleId }).from(alliances).where(eq(alliances.id, a!.id));
    if (row?.channelId || row?.roleId) await enqueue(tx, `alliance-channel-remove:${a!.id}`, 'job:alliance-channel-remove', { channelId: row.channelId, roleId: row.roleId });
    await tx.delete(alliances).where(eq(alliances.id, a!.id));
    await queueAllianceRoles(tx, a!.members.map((m) => m.id), new Date());
    for (const m of a!.members) if (m.id !== actor.company.id) await notifyMembers(tx, m.id, null, () => tr('Съюзът „{0}“ е разпуснат', a!.name), () => tr('Водещата компания „{0}“ разпусна съюза.', actor.company.name), '/game/company/alliance');
  });
}

export const allianceChannel = (allianceId: string) => `alliance:${allianceId}`;

/** The alliance's shared board (newest last). */
export async function allianceMessages(db: DbOrTx, allianceId: string, limit = 50) {
  const rows = await db
    .select({ id: chatMessages.id, body: chatMessages.body, createdAt: chatMessages.createdAt, username: users.username, company: organizations.name })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.userId))
    .leftJoin(companyMembers, eq(companyMembers.userId, users.id))
    .leftJoin(organizations, eq(organizations.id, companyMembers.companyId))
    .where(and(eq(chatMessages.channel, allianceChannel(allianceId)), isNull(chatMessages.deletedAt)))
    .orderBy(desc(chatMessages.id))
    .limit(limit);
  return rows.reverse();
}

/** The alliance's messages in the shape of the chat dock (the "Съюз" tab). */
export async function allianceFeed(db: DbOrTx, allianceId: string, afterId = 0, limit = 60, now = new Date()) {
  const rows = await db
    .select({ m: chatMessages, username: users.username, role: users.role, vipUntil: users.vipUntil })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.userId))
    .where(and(eq(chatMessages.channel, allianceChannel(allianceId)), afterId ? gt(chatMessages.id, afterId) : undefined))
    .orderBy(desc(chatMessages.id))
    .limit(limit);
  return rows.reverse().map((r) => ({ id: r.m.id, userId: r.m.userId, username: r.username, role: r.role, vip: !!r.vipUntil && r.vipUntil > now, body: r.m.deletedAt ? null : r.m.body, deleted: !!r.m.deletedAt, createdAt: r.m.createdAt.toISOString(), reply: null }));
}

/** The alliance of the player's company (for the chat dock), when alliances are out for them. */
export async function playerAlliance(db: DbOrTx, userId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'alliances', now))) return null;
  const m = await membershipOf(db, userId);
  return m ? allianceOf(db, m.company.id) : null;
}

export async function postAllianceMessage(db: Database, userId: string, raw: string, now = new Date()) {
  await released(db, userId, 'alliances', now);
  const body = messageBodySchema.parse(raw);
  await assertNotMuted(db, userId);
  await rateLimit(db, `alliance-chat:${userId}`, 6, 60);
  const m = await membershipOf(db, userId);
  const a = m ? await allianceOf(db, m.company.id) : null;
  if (!a) fail('no_alliance', tr('Компанията ти не е в съюз.'));
  const [row] = await db.insert(chatMessages).values({ channel: allianceChannel(a!.id), userId, body }).returning({ id: chatMessages.id });
  return row!.id;
}

/** This week of the alliance (made on first use: the goal by its companies, the rival later by the worker). */
async function allianceWeek(tx: DbOrTx, allianceId: string, companies: number, now: Date) {
  const week = periodWindow('weekly', now);
  await tx.insert(allianceWeeks).values({ allianceId, weekKey: week.key, targetTons: ALLIANCE.goalTonsPerCompany * Math.max(2, companies), endsAt: week.endsAt }).onConflictDoNothing();
  const [w] = await tx.select().from(allianceWeeks).where(and(eq(allianceWeeks.allianceId, allianceId), eq(allianceWeeks.weekKey, week.key)));
  return w!;
}

/** A member company's delivery: its tonnes count for the alliance's week. */
export async function recordAllianceDelivery(tx: Tx, organizationId: string, tons: number, now: Date) {
  const [m] = await tx.select({ allianceId: allianceMembers.allianceId }).from(allianceMembers).where(eq(allianceMembers.organizationId, organizationId));
  if (!m) return;
  const [{ n } = { n: 2 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(allianceMembers).where(eq(allianceMembers.allianceId, m.allianceId));
  const w = await allianceWeek(tx, m.allianceId, n, now);
  if (w.status !== 'active') return;
  await tx.update(allianceWeeks).set({ tons: sql`${allianceWeeks.tons} + ${tons}` }).where(eq(allianceWeeks.id, w.id));
}

// ── The alliance hall (v1.5) ──────────────────────────────────────────────

/** The hall of an alliance: level, progress and the city where it stands (the leader company's base). */
export async function allianceHall(db: DbOrTx, allianceId: string) {
  const [row] = await db
    .select({ level: alliances.hallLevel, tons: alliances.hallTons, cityId: organizations.hqCityId, city: cities.nameBg })
    .from(alliances)
    .innerJoin(organizations, eq(organizations.id, alliances.leaderOrgId))
    .innerJoin(cities, eq(cities.id, organizations.hqCityId))
    .where(eq(alliances.id, allianceId));
  return row ? { ...row, next: hallNextTons(row.level), bonusShare: hallBonusShare(row.level) } : null;
}

/** A member's delivery of materials (pallets, steel) to the hall's city builds the hall; each level is announced to the alliance. */
export async function recordHallDelivery(tx: Tx, userId: string, organizationId: string, load: { cargoType: string; destCityId: number; tons: number }, now: Date) {
  if (!ALLIANCE_HALL.cargo.includes(load.cargoType) || !(await featureFor(tx, userId, 'alliance_hall', now))) return null;
  const [m] = await tx.select({ allianceId: allianceMembers.allianceId }).from(allianceMembers).where(eq(allianceMembers.organizationId, organizationId));
  if (!m) return null;
  const [a] = await tx.select().from(alliances).where(eq(alliances.id, m.allianceId)).for('update');
  const hall = a ? await allianceHall(tx, a.id) : null;
  if (!a || !hall || hall.cityId !== load.destCityId || hall.next === null) return null;
  let level = a.hallLevel;
  let tons = a.hallTons + load.tons;
  while (hallNextTons(level) !== null && tons >= hallNextTons(level)!) {
    tons -= hallNextTons(level)!;
    level++;
  }
  if (hallNextTons(level) === null) tons = 0;
  await tx.update(alliances).set({ hallLevel: level, hallTons: tons }).where(eq(alliances.id, a.id));
  if (level > a.hallLevel) {
    const members = await tx.select({ id: allianceMembers.organizationId }).from(allianceMembers).where(eq(allianceMembers.allianceId, a.id));
    for (const o of members) await notifyMembers(tx, o.id, null, () => tr('Съюзната база „{0}“ е на ниво {1}!', a.name, level), () => tr('+{0} % към заплащането на всеки курс на членовете на съюза.', Math.round(hallBonusShare(level) * 100)), '/game/company/alliance');
  }
  return { level, tons };
}

/** The hall's bonus on a member's freight (personal account, before any treasury). */
export async function allianceHallBonus(tx: Tx, userId: string, organizationId: string, d: { id: string; companyId: string }, rewardCents: number, now: Date) {
  if (!(await featureFor(tx, userId, 'alliance_hall', now))) return 0;
  const [row] = await tx.select({ level: alliances.hallLevel, name: alliances.name }).from(allianceMembers).innerJoin(alliances, eq(alliances.id, allianceMembers.allianceId)).where(eq(allianceMembers.organizationId, organizationId));
  const bonus = row ? Math.round(rewardCents * hallBonusShare(row.level)) : 0;
  if (!bonus) return 0;
  await post(tx, d.companyId, [{ category: 'alliance_hall_bonus', amountCents: bonus, description: tr('Съюзна база „{0}“ (ниво {1})', row!.name, row!.level), idempotencyKey: `delivery:${d.id}:alliance-hall`, refType: 'delivery', refId: d.id }]);
  return bonus;
}

// ── The alliance in Discord (v1.5) ────────────────────────────────────────

/** The leader company turns the alliance's private Discord channel on or off. */
export async function setAllianceDiscord(db: Database, actorId: string, on: boolean, now = new Date()) {
  await released(db, actorId, 'alliance_discord', now);
  if (!discordConfig().bot) fail('discord_off', tr('Discord ботът още не е настроен.'));
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_settings');
    const a = await allianceOf(tx, actor.company.id);
    if (!a) fail('no_alliance', tr('Компанията не е в съюз.'));
    if (a!.leaderOrgId !== actor.company.id) fail('not_leader', tr('Канала на съюза включва водещата компания.'), 403);
    await tx.update(alliances).set({ discordChannel: on }).where(eq(alliances.id, a!.id));
    await enqueue(tx, `alliance-channel:${a!.id}:${now.getTime()}`, 'job:alliance-channel', { allianceId: a!.id }, now);
  });
}

/** The members of an alliance's companies get (or lose) the alliance role soon. */
async function queueAllianceRoles(tx: DbOrTx, organizationIds: string[], now: Date) {
  if (!organizationIds.length) return;
  const rows = await tx.select({ id: users.id }).from(companyMembers).innerJoin(users, eq(users.id, companyMembers.userId)).where(and(inArray(companyMembers.companyId, organizationIds), isNotNull(users.discordId)));
  for (const r of rows) await queueRoles(tx, r.id, now);
}

/** The alliance page: its week and the rival's. */
export async function allianceWeekView(db: DbOrTx, allianceId: string, companies: number, now = new Date()) {
  const w = await allianceWeek(db, allianceId, companies, now);
  const rival = w.rivalId ? (await db.select({ name: alliances.name, tons: allianceWeeks.tons }).from(allianceWeeks).innerJoin(alliances, eq(alliances.id, allianceWeeks.allianceId)).where(and(eq(allianceWeeks.allianceId, w.rivalId), eq(allianceWeeks.weekKey, w.weekKey))))[0] ?? null : null;
  return { ...w, rival };
}

/**
 * Worker: pairs the alliances of the week for battles, and after the week
 * pays the goal (each company's treasury) and the battle winner.
 */
export async function runAlliances(db: Database, now = new Date()) {
  const week = periodWindow('weekly', now);
  // Pairing: alliances without a rival this week, by their size.
  const all = await db.select({ id: alliances.id, n: sql<number>`(select count(*) from alliance_members m where m.alliance_id = ${alliances.id})::int` }).from(alliances);
  for (const a of all) await allianceWeek(db, a.id, a.n, now);
  const free = await db.select().from(allianceWeeks).where(and(eq(allianceWeeks.weekKey, week.key), isNull(allianceWeeks.rivalId)));
  for (let i = 0; i + 1 < free.length; i += 2) {
    await db.update(allianceWeeks).set({ rivalId: free[i + 1]!.allianceId }).where(eq(allianceWeeks.id, free[i]!.id));
    await db.update(allianceWeeks).set({ rivalId: free[i]!.allianceId }).where(eq(allianceWeeks.id, free[i + 1]!.id));
  }
  // Settlement of ended weeks.
  const due = await db.select().from(allianceWeeks).where(and(eq(allianceWeeks.status, 'active'), lte(allianceWeeks.endsAt, now)));
  for (const w of due) {
    const rival = w.rivalId ? (await db.select().from(allianceWeeks).where(and(eq(allianceWeeks.allianceId, w.rivalId), eq(allianceWeeks.weekKey, w.weekKey))))[0] : null;
    const goal = w.tons >= w.targetTons;
    const won = rival ? w.tons > rival.tons : null;
    await db.transaction(async (tx) => {
      const [mine] = await tx.update(allianceWeeks).set({ status: 'done', goalReached: goal, won }).where(and(eq(allianceWeeks.id, w.id), eq(allianceWeeks.status, 'active'))).returning();
      if (!mine) return;
      const members = await tx.select({ id: allianceMembers.organizationId }).from(allianceMembers).where(eq(allianceMembers.allianceId, w.allianceId));
      for (const m of members) {
        if (goal) await postTreasury(tx, m.id, [{ category: 'alliance', amountCents: ALLIANCE.goalRewardCents, description: tr('Седмичната цел на съюза ({0})', w.weekKey), idempotencyKey: `alliance:${w.id}:goal:${m.id}`, refType: 'alliance', refId: w.allianceId }]);
        if (won) await postTreasury(tx, m.id, [{ category: 'alliance', amountCents: ALLIANCE.battleRewardCents, description: tr('Победа в битката на съюзите ({0})', w.weekKey), idempotencyKey: `alliance:${w.id}:battle:${m.id}`, refType: 'alliance', refId: w.allianceId }]);
        if (goal || won) await notifyMembers(tx, m.id, null, () => won ? tr('Съюзът спечели битката! 🏆') : tr('Съюзът изпълни седмичната цел!'), () => tr('В касата влязоха {0}.', money((goal ? ALLIANCE.goalRewardCents : 0) + (won ? ALLIANCE.battleRewardCents : 0))), '/game/company/alliance');
      }
    });
  }
  return due.length;
}

// ── Hauling contracts between companies ───────────────────────────────────

/** The client offers a hauler company a week of hauling its members-only loads for a share of each load. */
export async function offerCompanyContract(db: Database, actorId: string, target: string, sharePct: number, now = new Date()) {
  await released(db, actorId, 'company_contracts', now);
  const share = sharePct / 100;
  if (!(share >= COMPANY_CONTRACT.minShare && share <= COMPANY_CONTRACT.maxShare)) fail('invalid_share', tr('Делът е от {0} до {1} %.', COMPANY_CONTRACT.minShare * 100, COMPANY_CONTRACT.maxShare * 100));
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_settings');
    const t = target.trim();
    const [org] = await tx.select().from(organizations).where(or(sql`lower(${organizations.tag}) = lower(${t})`, sql`lower(${organizations.name}) = lower(${t})`));
    if (!org) fail('not_found', tr('Няма компания с такъв таг или име.'), 404);
    if (org!.id === actor.company.id) fail('self', tr('Това е твоята компания.'));
    const [open] = await tx.select({ id: companyContracts.id }).from(companyContracts).where(and(eq(companyContracts.clientOrgId, actor.company.id), eq(companyContracts.haulerOrgId, org!.id), inArray(companyContracts.status, ['pending', 'active'])));
    if (open) fail('exists', tr('С тази компания вече има договор.'));
    const [row] = await tx.insert(companyContracts).values({ clientOrgId: actor.company.id, haulerOrgId: org!.id, share, createdBy: actorId, createdAt: now }).returning();
    await notifyMembers(tx, org!.id, null, () => tr('Договор за превоз от „{0}“', actor.company.name), () => tr('Предлагат {0} % от всеки техен товар (фабрика, филиали), който карате {1} дни.', Math.round(share * 100), COMPANY_CONTRACT.days), '/game/company/alliance');
    return row!;
  });
}

export async function respondCompanyContract(db: Database, actorId: string, contractId: string, accept: boolean, now = new Date()) {
  await released(db, actorId, 'company_contracts', now);
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_settings');
    const [c] = await tx.select().from(companyContracts).where(and(eq(companyContracts.id, contractId), eq(companyContracts.haulerOrgId, actor.company.id), eq(companyContracts.status, 'pending'))).for('update');
    if (!c || c.createdAt.getTime() + COMPANY_CONTRACT.inviteHours * 3_600_000 < now.getTime()) fail('no_offer', tr('Предложението не е валидно.'), 404);
    await tx.update(companyContracts).set(accept ? { status: 'active', startsAt: now, endsAt: new Date(now.getTime() + COMPANY_CONTRACT.days * 86_400_000) } : { status: 'declined' }).where(eq(companyContracts.id, c!.id));
    await notifyMembers(tx, c!.clientOrgId, null, () => accept ? tr('„{0}“ прие договора за превоз', actor.company.name) : tr('„{0}“ отказа договора', actor.company.name), () => accept ? tr('{0} дни техните членове карат вашите товари.', COMPANY_CONTRACT.days) : '', '/game/company/alliance');
    return accept;
  });
}

/** Active contracts where this company hauls for others: the client companies. */
export async function clientsOf(db: DbOrTx, haulerOrgId: string, now = new Date()) {
  const rows = await db.select({ clientOrgId: companyContracts.clientOrgId }).from(companyContracts).where(and(eq(companyContracts.haulerOrgId, haulerOrgId), eq(companyContracts.status, 'active'), gt(companyContracts.endsAt, now)));
  return rows.map((r) => r.clientOrgId);
}

/** A hauler's delivery of a client's load: the share from the client's treasury to the hauler's. */
export async function payCompanyContract(tx: Tx, clientOrgId: string, haulerOrgId: string, deliveryId: string, rewardCents: number, tons: number, now: Date) {
  const [c] = await tx.select().from(companyContracts).where(and(eq(companyContracts.clientOrgId, clientOrgId), eq(companyContracts.haulerOrgId, haulerOrgId), eq(companyContracts.status, 'active'))).for('update');
  if (!c || (c.endsAt && c.endsAt < new Date(now.getTime() - 6 * 3_600_000))) return 0;
  const [client] = await tx.select({ treasury: organizations.treasuryCents }).from(organizations).where(eq(organizations.id, clientOrgId));
  const cents = Math.min(Math.round(rewardCents * c.share), Math.max(0, client?.treasury ?? 0));
  if (cents > 0) {
    await postTreasury(tx, clientOrgId, [{ category: 'company_contract', amountCents: -cents, description: tr('Дял за превозвача по договор'), idempotencyKey: `cc:${deliveryId}:out`, refType: 'company_contract', refId: c.id }]);
    await postTreasury(tx, haulerOrgId, [{ category: 'company_contract', amountCents: cents, description: tr('Дял по договор за превоз'), idempotencyKey: `cc:${deliveryId}:in`, refType: 'company_contract', refId: c.id }]);
  }
  await tx.update(companyContracts).set({ loads: sql`${companyContracts.loads} + 1`, tons: sql`${companyContracts.tons} + ${tons}`, paidCents: sql`${companyContracts.paidCents} + ${cents}` }).where(eq(companyContracts.id, c.id));
  return cents;
}

/** Worker: contracts past their week end. */
export async function endCompanyContracts(db: Database, now = new Date()) {
  const done = await db.update(companyContracts).set({ status: 'done' }).where(and(eq(companyContracts.status, 'active'), lte(companyContracts.endsAt, now))).returning();
  for (const c of done) await db.transaction((tx) => notifyMembers(tx, c.clientOrgId, null, () => tr('Договорът за превоз приключи'), () => tr('{0} товара, {1} платени. Оценете превозвача.', c.loads, money(c.paidCents)), '/game/company/alliance'));
  return done.length;
}

/** The client rates the hauler after the contract (1–5). */
export async function rateCompanyContract(db: Database, actorId: string, contractId: string, stars: number) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_settings');
    const [c] = await tx.update(companyContracts).set({ rating: Math.max(1, Math.min(5, Math.round(stars))) }).where(and(eq(companyContracts.id, contractId), eq(companyContracts.clientOrgId, actor.company.id), eq(companyContracts.status, 'done'), isNull(companyContracts.rating))).returning();
    if (!c) fail('cannot_rate', tr('Договорът не може да се оцени.'));
  });
}

/** A company's contracts both ways and its rating as a hauler. */
export async function contractsOf(db: DbOrTx, orgId: string) {
  const rows = await db
    .select({ c: companyContracts, client: sql<string>`(select name from organizations where id = ${companyContracts.clientOrgId})`, hauler: sql<string>`(select name from organizations where id = ${companyContracts.haulerOrgId})` })
    .from(companyContracts)
    .where(or(eq(companyContracts.clientOrgId, orgId), eq(companyContracts.haulerOrgId, orgId)))
    .orderBy(desc(companyContracts.createdAt))
    .limit(20);
  const [r] = await db.select({ avg: sql<number | null>`avg(${companyContracts.rating})::float`, n: sql<number>`count(${companyContracts.rating})::int` }).from(companyContracts).where(eq(companyContracts.haulerOrgId, orgId));
  return { list: rows.map((x) => ({ ...x.c, client: x.client, hauler: x.hauler, mineAsClient: x.c.clientOrgId === orgId })), rating: r?.avg ?? null, ratings: r?.n ?? 0 };
}

// ── Academy ───────────────────────────────────────────────────────────────

/** A new member enrols with a mentor from the company. */
export async function enrolAcademy(db: Database, userId: string, mentorId: string, now = new Date()) {
  await released(db, userId, 'academy', now);
  return db.transaction(async (tx) => {
    const m = await membershipOf(tx, userId);
    if (!m) fail('not_member', tr('Не членуваш в компания.'), 403);
    if (m!.member.joinedAt.getTime() + ACADEMY.joinedDays * 86_400_000 < now.getTime()) fail('not_new', tr('Академията е за нови членове (до {0} дни в компанията).', ACADEMY.joinedDays));
    if (mentorId === userId) fail('self', tr('Избери друг член за наставник.'));
    const [mentor] = await tx.select({ id: users.id, level: users.level, username: users.username }).from(companyMembers).innerJoin(users, eq(users.id, companyMembers.userId)).where(and(eq(companyMembers.userId, mentorId), eq(companyMembers.companyId, m!.company.id)));
    if (!mentor) fail('not_member', tr('Наставникът трябва да е от компанията.'));
    if (mentor!.level < ACADEMY.mentorMinLevel) fail('low_level', tr('Наставникът трябва да е поне ниво {0}.', ACADEMY.mentorMinLevel));
    const [row] = await tx.insert(academyStudents).values({ organizationId: m!.company.id, userId, mentorId, startedAt: now }).onConflictDoNothing().returning();
    if (!row) fail('enrolled', tr('Вече си в академията.'), 409);
    const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    await notify(tx, mentorId, 'info', () => tr('{0} те избра за наставник', me!.username), () => tr('Три курса в академията на компанията — помагай със съвети.'), '/game/company/alliance');
    return row!;
  });
}

/** A delivery of a student: an on-time trip long enough is a course; the third one finishes the academy. */
export async function recordAcademyCourse(tx: Tx, userId: string, f: { onTime: boolean; loadedKm: number }, now: Date) {
  if (!f.onTime || f.loadedKm < ACADEMY.minKm) return;
  const [s] = await tx.select().from(academyStudents).where(and(eq(academyStudents.userId, userId), isNull(academyStudents.finishedAt))).for('update');
  if (!s) return;
  const courses = s.courses + 1;
  const done = courses >= ACADEMY.courses;
  await tx.update(academyStudents).set({ courses, finishedAt: done ? now : null }).where(eq(academyStudents.id, s.id));
  if (!done) return;
  await tx.update(users).set({ xp: sql`${users.xp} + ${ACADEMY.studentXp}` }).where(eq(users.id, userId));
  await postCoins(tx, s.mentorId, { amount: ACADEMY.mentorCoins, reason: 'mentor_reward', description: tr('Наставник в академията на компанията'), idempotencyKey: `academy:${s.id}:mentor` });
  await postTreasury(tx, s.organizationId, [{ category: 'academy', amountCents: ACADEMY.treasuryCents, description: tr('Обучен член в академията'), idempotencyKey: `academy:${s.id}:treasury`, refType: 'academy', refId: s.id }]);
  await addCompanyXp(tx, s.organizationId, 500);
  await notify(tx, userId, 'achievement', () => tr('Завърши академията! 🎓'), () => tr('+{0} опит. Наставникът и компанията също получиха награда.', ACADEMY.studentXp), '/game/company/alliance');
}

export async function academyOf(db: DbOrTx, organizationId: string) {
  const mentor = sql<string>`(select username from users where id = ${academyStudents.mentorId})`;
  return db.select({ id: academyStudents.id, userId: academyStudents.userId, username: users.username, mentor, courses: academyStudents.courses, finishedAt: academyStudents.finishedAt }).from(academyStudents).innerJoin(users, eq(users.id, academyStudents.userId)).where(eq(academyStudents.organizationId, organizationId)).orderBy(desc(academyStudents.startedAt)).limit(30);
}
