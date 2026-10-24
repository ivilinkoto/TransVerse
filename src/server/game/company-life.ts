import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordMonth } from '@/lib/game/community';
import { ASSEMBLY, DEPARTMENTS, INTERNS, KEY_CLIENTS, keyClientName, LOGO, TRADITION } from '@/lib/game/company-life';
import { featureLive } from '@/lib/game/features';
import { money } from '@/lib/format';
import { periodWindow, sofiaMidnight } from '@/lib/game/missions';
import { sofiaMonthDay } from '@/lib/game/seasonal';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import {
  allianceMembers, assemblyVotes, orgTrailers, orgVehicles, cities, companies, companyAssemblies, companyDepartments, companyMembers, companyOwners, contracts, deliveries, internStays, keyClients, mergerOffers, organizations, shareHoldings, users,
} from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { addChronicle } from './chronicle';
import { addLoad, loadHubs } from './contracts';
import { fail } from './errors';
import { post, postTreasury } from './finance';
import { addCompanyXp, entryRank, membershipOf, notifyMembers, requirePermission } from './membership';
import { notify } from './notify';
import { awardXp } from './progression';

const DAY = 86_400_000;

// ── Departments ──────────────────────────────────────────────────────────

export const departmentSchema = z.object({ name: z.string().trim().min(2, 'Поне 2 знака.').max(DEPARTMENTS.nameMax), goalTons: z.coerce.number().int().min(10).max(10_000).default(DEPARTMENTS.defaultGoalTons) });

export async function createDepartment(db: Database, userId: string, raw: z.input<typeof departmentSchema>) {
  const input = departmentSchema.parse(raw);
  return db.transaction(async (tx) => {
    const m = await requirePermission(tx, userId, 'manage_members');
    if (!(await featureFor(tx, userId, 'departments'))) fail('not_released', 'Отделите идват с обновление 1.9.');
    const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(companyDepartments).where(eq(companyDepartments.organizationId, m.company.id));
    if (n >= DEPARTMENTS.max) fail('too_many', `Най-много ${DEPARTMENTS.max} отдела.`);
    const [d] = await tx.insert(companyDepartments).values({ organizationId: m.company.id, name: input.name, goalTons: input.goalTons }).returning();
    return { id: d!.id };
  });
}

export async function deleteDepartment(db: Database, userId: string, id: number) {
  return db.transaction(async (tx) => {
    const m = await requirePermission(tx, userId, 'manage_members');
    await tx.update(companyMembers).set({ departmentId: null }).where(and(eq(companyMembers.companyId, m.company.id), eq(companyMembers.departmentId, id)));
    await tx.delete(companyDepartments).where(and(eq(companyDepartments.id, id), eq(companyDepartments.organizationId, m.company.id)));
    return { deleted: true };
  });
}

/** A member picks a department (or none); the head is set by a manager. */
export async function joinDepartment(db: Database, userId: string, id: number | null) {
  const m = await membershipOf(db, userId);
  if (!m) fail('not_member', 'Не членувате в компания.', 403);
  if (id !== null) {
    const [d] = await db.select().from(companyDepartments).where(and(eq(companyDepartments.id, id), eq(companyDepartments.organizationId, m!.company.id)));
    if (!d) fail('not_found', 'Няма такъв отдел.', 404);
  }
  await db.update(companyMembers).set({ departmentId: id }).where(eq(companyMembers.userId, userId));
  return { departmentId: id };
}

export async function setDepartmentHead(db: Database, userId: string, id: number, headUserId: string | null) {
  return db.transaction(async (tx) => {
    const m = await requirePermission(tx, userId, 'manage_members');
    if (headUserId) {
      const [member] = await tx.select({ id: companyMembers.userId }).from(companyMembers).where(and(eq(companyMembers.userId, headUserId), eq(companyMembers.companyId, m.company.id)));
      if (!member) fail('not_member', 'Началникът трябва да е член.');
      await tx.update(companyMembers).set({ departmentId: id }).where(eq(companyMembers.userId, headUserId));
    }
    await tx.update(companyDepartments).set({ headUserId }).where(and(eq(companyDepartments.id, id), eq(companyDepartments.organizationId, m.company.id)));
    return { headUserId };
  });
}

/** The company's departments with members and this week's tonnes. */
export async function departmentsView(db: DbOrTx, orgId: string, now = new Date()) {
  const depts = await db.select().from(companyDepartments).where(eq(companyDepartments.organizationId, orgId)).orderBy(asc(companyDepartments.id));
  if (!depts.length) return [];
  const members = await db.select({ userId: companyMembers.userId, departmentId: companyMembers.departmentId, username: users.username }).from(companyMembers).innerJoin(users, eq(users.id, companyMembers.userId)).where(eq(companyMembers.companyId, orgId));
  const weekStart = new Date(periodWindow('weekly', now).endsAt.getTime() - 7 * DAY);
  const tons = await db
    .select({ ownerId: companies.ownerId, tons: sql<number>`coalesce(sum(${contracts.weightTons}), 0)::float` })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .where(and(eq(deliveries.status, 'completed'), gte(deliveries.completedAt, weekStart), inArray(companies.ownerId, members.map((m) => m.userId))))
    .groupBy(companies.ownerId);
  return depts.map((d) => {
    const ms = members.filter((m) => m.departmentId === d.id);
    const week = ms.reduce((s, m) => s + (tons.find((t) => t.ownerId === m.userId)?.tons ?? 0), 0);
    return { id: d.id, name: d.name, goalTons: d.goalTons, head: members.find((m) => m.userId === d.headUserId)?.username ?? null, members: ms.map((m) => m.username), weekTons: Math.round(week * 10) / 10 };
  });
}

// ── The assembly ─────────────────────────────────────────────────────────

export const assemblySchema = z.object({
  question: z.string().trim().min(5, 'Напиши въпроса.').max(ASSEMBLY.questionMax),
  kind: z.enum(['text', 'rate']).default('text'),
  options: z.array(z.string().trim().min(1).max(ASSEMBLY.optionMax)).min(ASSEMBLY.minOptions).max(ASSEMBLY.maxOptions).optional(),
});

export async function openAssembly(db: Database, userId: string, raw: z.input<typeof assemblySchema>, now = new Date()) {
  const input = assemblySchema.parse(raw);
  return db.transaction(async (tx) => {
    const m = await requirePermission(tx, userId, 'manage_settings');
    if (!(await featureFor(tx, userId, 'general_assembly', now))) fail('not_released', 'Събранието идва с обновление 1.9.');
    const [open] = await tx.select({ id: companyAssemblies.id }).from(companyAssemblies).where(and(eq(companyAssemblies.organizationId, m.company.id), isNull(companyAssemblies.closedAt))).limit(1);
    if (open) fail('already_open', 'Вече има отворено гласуване.');
    const options = input.kind === 'rate' ? ASSEMBLY.rateOptions.map((r) => `${Math.round(r * 100)} %`) : input.options;
    if (!options || options.length < ASSEMBLY.minOptions) fail('bad_options', `Нужни са ${ASSEMBLY.minOptions}–${ASSEMBLY.maxOptions} отговора.`);
    const [a] = await tx.insert(companyAssemblies).values({ organizationId: m.company.id, question: input.kind === 'rate' ? `Вноска към касата: ${input.question}` : input.question, kind: input.kind, options: options!, closesAt: new Date(now.getTime() + ASSEMBLY.days * DAY), createdBy: userId, createdAt: now }).returning();
    await notifyMembers(tx, m.company.id, null, 'Общо събрание 🗳️', `${a!.question} — гласувай до ${ASSEMBLY.days} дни.`, '/game/company/community');
    return { id: a!.id };
  });
}

export async function voteAssembly(db: Database, userId: string, assemblyId: number, option: number, now = new Date()) {
  const m = await membershipOf(db, userId);
  if (!m) fail('not_member', 'Не членувате в компания.', 403);
  const [a] = await db.select().from(companyAssemblies).where(and(eq(companyAssemblies.id, assemblyId), eq(companyAssemblies.organizationId, m!.company.id)));
  if (!a || a.closedAt || a.closesAt <= now) fail('closed', 'Гласуването е приключило.');
  if (!Number.isInteger(option) || option < 0 || option >= a!.options.length) fail('bad_option', 'Няма такъв отговор.');
  const [v] = await db.insert(assemblyVotes).values({ assemblyId, userId, option, createdAt: now }).onConflictDoNothing().returning();
  if (!v) fail('already_voted', 'Вече гласува.');
  return { voted: option };
}

/** Closes the assemblies whose time is up: the most votes win (a tie — the earlier answer); a rate is applied. */
export async function closeAssemblies(db: Database, now = new Date()) {
  const due = await db.select().from(companyAssemblies).where(and(isNull(companyAssemblies.closedAt), lte(companyAssemblies.closesAt, now)));
  for (const a of due) {
    await db.transaction(async (tx) => {
      const votes = await tx.select({ option: assemblyVotes.option, n: sql<number>`count(*)::int` }).from(assemblyVotes).where(eq(assemblyVotes.assemblyId, a.id)).groupBy(assemblyVotes.option);
      const best = votes.sort((x, y) => y.n - x.n || x.option - y.option)[0];
      const [closed] = await tx.update(companyAssemblies).set({ closedAt: now, result: best?.option ?? null }).where(and(eq(companyAssemblies.id, a.id), isNull(companyAssemblies.closedAt))).returning();
      if (!closed) return;
      const answer = best ? a.options[best.option]! : null;
      if (a.kind === 'rate' && best) await tx.update(organizations).set({ contributionRate: ASSEMBLY.rateOptions[best.option] ?? 0.05 }).where(eq(organizations.id, a.organizationId));
      const text = answer ? `Събранието реши: ${a.question} → „${answer}“ (${best!.n} гласа).` : `Събранието „${a.question}“ приключи без гласове.`;
      await addChronicle(tx, a.organizationId, 'assembly', text, now);
      await notifyMembers(tx, a.organizationId, null, 'Решение на събранието', text, '/game/company/community');
    });
  }
  return due.length;
}

export async function assemblyView(db: DbOrTx, orgId: string, userId: string) {
  const list = await db.select().from(companyAssemblies).where(eq(companyAssemblies.organizationId, orgId)).orderBy(desc(companyAssemblies.createdAt)).limit(5);
  const ids = list.map((a) => a.id);
  const votes = ids.length ? await db.select({ assemblyId: assemblyVotes.assemblyId, option: assemblyVotes.option, userId: assemblyVotes.userId }).from(assemblyVotes).where(inArray(assemblyVotes.assemblyId, ids)) : [];
  return list.map((a) => ({
    id: a.id,
    question: a.question,
    options: a.options.map((o, i) => ({ label: o, votes: votes.filter((v) => v.assemblyId === a.id && v.option === i).length })),
    mine: votes.find((v) => v.assemblyId === a.id && v.userId === userId)?.option ?? null,
    closesAt: a.closesAt.toISOString(),
    closed: !!a.closedAt,
    result: a.result,
  }));
}

// ── Key clients ──────────────────────────────────────────────────────────

/** Once a month: each big city's key client goes to last month's top company there. */
export async function awardKeyClients(db: Database, now = new Date()) {
  if (!featureLive('key_clients', now)) return 0;
  const month = recordMonth(now);
  const [done] = await db.select({ n: sql<number>`count(*)::int` }).from(keyClients).where(eq(keyClients.month, month));
  if ((done?.n ?? 0) > 0) return 0;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const thisStart = sofiaMidnight(y, m, 1);
  const lastStart = m === 1 ? sofiaMidnight(y - 1, 12, 1) : sofiaMidnight(y, m - 1, 1);
  const rows = await db
    .select({ cityId: contracts.destCityId, city: cities.nameBg, orgId: companyMembers.companyId, tons: sql<number>`sum(${contracts.weightTons})::float` })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(companyMembers, eq(companyMembers.userId, companies.ownerId))
    .where(and(eq(deliveries.status, 'completed'), gte(deliveries.completedAt, lastStart), sql`${deliveries.completedAt} < ${thisStart}`, gte(cities.population, KEY_CLIENTS.minPopulation)))
    .groupBy(contracts.destCityId, cities.nameBg, companyMembers.companyId);
  const best = new Map<number, (typeof rows)[number]>();
  for (const r of rows) if (r.tons >= KEY_CLIENTS.minTons && (!best.has(r.cityId) || best.get(r.cityId)!.tons < r.tons)) best.set(r.cityId, r);
  for (const r of best.values()) {
    const client = keyClientName(r.city, r.cityId);
    const [row] = await db.insert(keyClients).values({ month, cityId: r.cityId, organizationId: r.orgId, client, tons: Math.round(r.tons * 10) / 10 }).onConflictDoNothing().returning();
    if (!row) continue;
    await db.transaction(async (tx) => {
      await addChronicle(tx, r.orgId, 'key_client', `Ключов клиент в ${r.city}: ${client} (${Math.round(r.tons)} т миналия месец).`, now);
      await notifyMembers(tx, r.orgId, null, `Ключов клиент: ${client} 🤝`, `Този месец компанията има собствени товари от ${r.city} (+${Math.round((KEY_CLIENTS.multiplier - 1) * 100)} %).`, '/game/contracts');
    });
  }
  return best.size;
}

/** While a month runs: each key client keeps a couple of members-only loads open from its city. */
export async function topUpKeyClientLoads(db: Database, now = new Date()) {
  if (!featureLive('key_clients', now)) return 0;
  const current = await db.select().from(keyClients).where(eq(keyClients.month, recordMonth(now)));
  if (!current.length) return 0;
  const hubs = await loadHubs(db, { now });
  let made = 0;
  for (const k of current) {
    const [{ open = 0 } = {}] = await db.select({ open: sql<number>`count(*)::int` }).from(contracts).where(and(eq(contracts.keyClient, true), eq(contracts.branchOrgId, k.organizationId), eq(contracts.originCityId, k.cityId), eq(contracts.status, 'open'), gt(contracts.expiresAt, now)));
    const origin = hubs.find((h) => h.id === k.cityId);
    if (!origin) continue;
    for (let i = open; i < KEY_CLIENTS.openLoads; i++) {
      const near = hubs.filter((h) => h.id !== origin.id && Math.abs(h.lat - origin.lat) + Math.abs(h.lon - origin.lon) < 6);
      const dest = near[Math.floor(Math.random() * near.length)];
      if (!dest) continue;
      const cargo = [...origin.produces][0] ?? 'pallets';
      const id = await addLoad(db, origin.id, dest.id, cargo, 8 + Math.round(Math.random() * 10), now, KEY_CLIENTS.ttlHours * 3_600_000, KEY_CLIENTS.multiplier, { goods: `За ${k.client}` });
      if (id) {
        await db.update(contracts).set({ branchOrgId: k.organizationId, keyClient: true }).where(eq(contracts.id, id));
        made++;
      }
    }
  }
  return made;
}

export async function keyClientsOf(db: DbOrTx, orgId: string, now = new Date()) {
  return db.select({ client: keyClients.client, city: cities.nameBg, tons: keyClients.tons }).from(keyClients).innerJoin(cities, eq(cities.id, keyClients.cityId)).where(and(eq(keyClients.organizationId, orgId), eq(keyClients.month, recordMonth(now))));
}

// ── The owner's weekly report ────────────────────────────────────────────

/** Monday: the owner gets the week in short — who drove, who did not, the treasury, the best member. */
export async function ownerReports(db: Database, now = new Date()) {
  if (!featureLive('owner_report', now)) return 0;
  const since = new Date(now.getTime() - 7 * DAY);
  const orgs = await db.select({ id: organizations.id, name: organizations.name, ownerId: organizations.ownerId, treasury: organizations.treasuryCents }).from(organizations);
  let sent = 0;
  for (const o of orgs) {
    const members = await db.select({ userId: companyMembers.userId, username: users.username, lastSeen: users.lastSeenAt }).from(companyMembers).innerJoin(users, eq(users.id, companyMembers.userId)).where(eq(companyMembers.companyId, o.id));
    if (members.length < 2) continue;
    const trips = await db
      .select({ ownerId: companies.ownerId, n: sql<number>`count(*)::int`, tons: sql<number>`coalesce(sum(${contracts.weightTons}), 0)::float` })
      .from(deliveries)
      .innerJoin(companies, eq(companies.id, deliveries.companyId))
      .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .where(and(eq(deliveries.status, 'completed'), gte(deliveries.completedAt, since), inArray(companies.ownerId, members.map((m) => m.userId))))
      .groupBy(companies.ownerId);
    const total = trips.reduce((s, t) => s + t.n, 0);
    const best = [...trips].sort((a, b) => b.tons - a.tons)[0];
    const idle = members.filter((m) => !trips.some((t) => t.ownerId === m.userId)).map((m) => m.username);
    const body = [
      `${total} курса за седмицата`,
      best ? `най-много: ${members.find((m) => m.userId === best.ownerId)?.username ?? '—'} (${Math.round(best.tons)} т)` : null,
      idle.length ? `без курс: ${idle.slice(0, 5).join(', ')}${idle.length > 5 ? ` и още ${idle.length - 5}` : ''}` : 'всички карат 👍',
      `каса ${money(o.treasury)}`,
    ].filter(Boolean).join(' · ');
    await db.transaction((tx) => notify(tx, o.ownerId, 'info', `Седмицата на „${o.name}“`, `${body}.`, '/game/company/members'));
    sent++;
  }
  return sent;
}

// ── Logo, tradition, history ─────────────────────────────────────────────

export const logoSchema = z.object({
  shape: z.enum(LOGO.shapes),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  initials: z.string().trim().min(1).max(LOGO.initialsMax),
  stripe: z.boolean().default(false),
});

export async function setLogoDesign(db: Database, userId: string, raw: z.input<typeof logoSchema> | null) {
  const design = raw ? logoSchema.parse(raw) : null;
  return db.transaction(async (tx) => {
    const m = await requirePermission(tx, userId, 'edit_profile');
    if (!(await featureFor(tx, userId, 'company_logo'))) fail('not_released', 'Логото идва с обновление 1.9.');
    await tx.update(organizations).set({ logoDesign: design, brandingVersion: sql`${organizations.brandingVersion} + 1` }).where(eq(organizations.id, m.company.id));
    return { saved: !!design };
  });
}

export const traditionSchema = z.object({ day: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Дата като ММ-ДД.'), name: z.string().trim().min(2).max(TRADITION.nameMax) });

export async function setTradition(db: Database, userId: string, raw: z.input<typeof traditionSchema> | null) {
  const t = raw ? traditionSchema.parse(raw) : null;
  return db.transaction(async (tx) => {
    const m = await requirePermission(tx, userId, 'manage_settings');
    if (!(await featureFor(tx, userId, 'company_traditions'))) fail('not_released', 'Традициите идват с обновление 1.9.');
    await tx.update(organizations).set({ traditionDay: t?.day ?? null, traditionName: t?.name ?? null }).where(eq(organizations.id, m.company.id));
    if (t) await addChronicle(tx, m.company.id, 'tradition', `Нова традиция: „${t.name}“ всяка година на ${t.day.split('-').reverse().join('.')}.`);
    return { day: t?.day ?? null };
  });
}

/** The company's dynasty: its owners through time, the long-serving members and the chronicle's big moments. */
export async function companyHistory(db: DbOrTx, orgId: string) {
  const [org] = await db.select({ ownerId: organizations.ownerId, createdAt: organizations.createdAt }).from(organizations).where(eq(organizations.id, orgId));
  if (!org) return null;
  let owners = await db.select({ userId: companyOwners.userId, username: users.username, fromAt: companyOwners.fromAt, toAt: companyOwners.toAt }).from(companyOwners).innerJoin(users, eq(users.id, companyOwners.userId)).where(eq(companyOwners.organizationId, orgId)).orderBy(asc(companyOwners.fromAt));
  if (!owners.length) {
    const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, org.ownerId));
    owners = [{ userId: org.ownerId, username: u?.username ?? '—', fromAt: org.createdAt, toAt: null }];
  }
  const veterans = await db
    .select({ username: users.username, deliveries: companyMembers.deliveries, joinedAt: companyMembers.joinedAt })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(eq(companyMembers.companyId, orgId))
    .orderBy(desc(companyMembers.deliveries))
    .limit(5);
  return { foundedAt: org.createdAt, owners, veterans };
}

/** Called when the owner changes (keeps the dynasty). */
export async function recordOwnerChange(tx: Tx, orgId: string, previousOwnerId: string, newOwnerId: string, at: Date, foundedAt: Date) {
  const [any] = await tx.select({ userId: companyOwners.userId }).from(companyOwners).where(eq(companyOwners.organizationId, orgId)).limit(1);
  if (!any) await tx.insert(companyOwners).values({ organizationId: orgId, userId: previousOwnerId, fromAt: foundedAt }).onConflictDoNothing();
  await tx.update(companyOwners).set({ toAt: at }).where(and(eq(companyOwners.organizationId, orgId), isNull(companyOwners.toAt)));
  await tx.insert(companyOwners).values({ organizationId: orgId, userId: newOwnerId, fromAt: at }).onConflictDoNothing();
  const [u] = await tx.select({ username: users.username }).from(users).where(eq(users.id, newOwnerId));
  await addChronicle(tx, orgId, 'owner', `Нов собственик: ${u?.username ?? '—'}.`, at);
}

// ── Interns ──────────────────────────────────────────────────────────────

export async function requestInternship(db: Database, userId: string, hostOrgId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'interns', now))) fail('not_released', 'Стажовете идват с обновление 1.9.');
  const m = await membershipOf(db, userId);
  if (m?.company.id === hostOrgId) fail('own_company', 'Това е твоята компания.');
  const [host] = await db.select({ id: organizations.id, ownerId: organizations.ownerId, name: organizations.name }).from(organizations).where(eq(organizations.id, hostOrgId));
  if (!host) fail('not_found', 'Няма такава компания.', 404);
  const [busy] = await db.select({ id: internStays.id }).from(internStays).where(and(eq(internStays.userId, userId), inArray(internStays.status, ['requested', 'active']))).limit(1);
  if (busy) fail('busy', 'Вече имаш заявен или текущ стаж.');
  const [row] = await db.insert(internStays).values({ userId, homeOrgId: m?.company.id ?? null, hostOrgId, createdAt: now }).returning();
  const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId));
  await db.transaction((tx) => notify(tx, host!.ownerId, 'info', 'Молба за стаж', `${u?.username ?? 'Играч'} иска ${INTERNS.days} дни стаж в „${host!.name}“.`, '/game/company/community'));
  return { id: row!.id };
}

export async function decideInternship(db: Database, userId: string, id: number, accept: boolean, now = new Date()) {
  return db.transaction(async (tx) => {
    const m = await requirePermission(tx, userId, 'recruit');
    const [s] = await tx.select().from(internStays).where(and(eq(internStays.id, id), eq(internStays.hostOrgId, m.company.id), eq(internStays.status, 'requested')));
    if (!s) fail('not_found', 'Няма такава молба.', 404);
    await tx.update(internStays).set(accept ? { status: 'active', startsAt: now, endsAt: new Date(now.getTime() + INTERNS.days * DAY) } : { status: 'declined' }).where(eq(internStays.id, id));
    await notify(tx, s!.userId, accept ? 'success' : 'info', accept ? `Стаж в „${m.company.name}“ 🎓` : 'Молбата за стаж е отказана', accept ? `${INTERNS.days} дни: +${Math.round(INTERNS.xpBonus * 100)} % опит от курсовете, а компанията-домакин учи от теб.` : `„${m.company.name}“ не прие стаж сега.`, '/game/company/community');
    return { status: accept ? 'active' : 'declined' };
  });
}

/** A delivery of an intern: extra XP for them and company XP for the host. */
export async function internDelivery(tx: Tx, userId: string, baseXp: number, at: Date) {
  const [s] = await tx.select().from(internStays).where(and(eq(internStays.userId, userId), eq(internStays.status, 'active'), gt(internStays.endsAt, at))).limit(1);
  if (!s) return 0;
  const extra = Math.round(baseXp * INTERNS.xpBonus);
  if (extra > 0) await awardXp(tx, userId, extra, 'other');
  await addCompanyXp(tx, s.hostOrgId, Math.round(baseXp * INTERNS.hostXpShare * 0.1));
  return extra;
}

export async function endInternships(db: Database, now = new Date()) {
  const done = await db.update(internStays).set({ status: 'done' }).where(and(eq(internStays.status, 'active'), lte(internStays.endsAt, now))).returning();
  return done.length;
}

// ── Tradition day ────────────────────────────────────────────────────────

/** A member's delivery on the company's own day: +5 % (personal account). */
export async function traditionBonus(tx: Tx, userId: string, d: { id: string; companyId: string }, rewardCents: number, at: Date) {
  const m = await membershipOf(tx, userId);
  if (!m?.company.traditionDay || m.company.traditionDay !== sofiaMonthDay(at) || !(await featureFor(tx, userId, 'company_traditions', at))) return 0;
  const bonus = Math.round(rewardCents * TRADITION.bonusShare);
  if (bonus > 0) await post(tx, d.companyId, [{ category: 'company_bonus', amountCents: bonus, description: `${m.company.traditionName ?? 'Ден на компанията'} (+${Math.round(TRADITION.bonusShare * 100)} %)`, idempotencyKey: `tradition:${d.id}`, refType: 'delivery', refId: d.id }]);
  return bonus;
}

// ── Mergers ──────────────────────────────────────────────────────────────

export async function proposeMerger(db: Database, userId: string, toOrgId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'mergers', now))) fail('not_released', 'Сливанията идват с обновление 1.9.');
  const m = await membershipOf(db, userId);
  if (!m?.rank.isOwner) fail('forbidden', 'Само собственикът предлага сливане.', 403);
  if (m!.company.id === toOrgId) fail('same', 'Избери друга компания.');
  const [to] = await db.select({ id: organizations.id, ownerId: organizations.ownerId, name: organizations.name }).from(organizations).where(eq(organizations.id, toOrgId));
  if (!to) fail('not_found', 'Няма такава компания.', 404);
  const [open] = await db.select({ id: mergerOffers.id }).from(mergerOffers).where(and(eq(mergerOffers.fromOrgId, m!.company.id), eq(mergerOffers.toOrgId, toOrgId), eq(mergerOffers.status, 'open'))).limit(1);
  if (open) fail('already', 'Вече има предложение към тази компания.');
  const [row] = await db.insert(mergerOffers).values({ fromOrgId: m!.company.id, toOrgId, createdAt: now }).returning();
  await db.transaction((tx) => notify(tx, to!.ownerId, 'info', 'Предложение за сливане', `„${m!.company.name}“ предлага „${to!.name}“ да влезе в нея като отдел. Решаваш ти.`, '/game/company/community'));
  return { id: row!.id };
}

/**
 * The owner of the company being taken in accepts: its members move over
 * (as a department with the entry rank), its treasury goes into the other
 * company's, and it closes. Not while its shares are held outside or it is
 * in an alliance.
 */
export async function acceptMerger(db: Database, userId: string, offerId: number, now = new Date()) {
  return db.transaction(async (tx) => {
    const m = await membershipOf(tx, userId, true);
    if (!m?.rank.isOwner) fail('forbidden', 'Само собственикът решава.', 403);
    const [offer] = await tx.select().from(mergerOffers).where(and(eq(mergerOffers.id, offerId), eq(mergerOffers.toOrgId, m!.company.id), eq(mergerOffers.status, 'open')));
    if (!offer) fail('not_found', 'Няма такова предложение.', 404);
    const small = m!.company;
    const [big] = await tx.select().from(organizations).where(eq(organizations.id, offer!.fromOrgId)).for('update');
    if (!big) fail('not_found', 'Другата компания вече я няма.', 404);
    const [held] = await tx.select({ n: sql<number>`count(*)::int` }).from(shareHoldings).where(eq(shareHoldings.organizationId, small.id));
    if ((held?.n ?? 0) > 0) fail('has_shares', 'Компанията има акционери — първо трябва те да продадат акциите си.');
    const [ally] = await tx.select({ id: allianceMembers.organizationId }).from(allianceMembers).where(eq(allianceMembers.organizationId, small.id));
    if (ally) fail('in_alliance', 'Първо напуснете съюза.');
    const [ownTrucks] = await tx.select({ n: sql<number>`count(*)::int` }).from(orgVehicles).where(and(eq(orgVehicles.organizationId, small.id), isNull(orgVehicles.soldAt)));
    const [ownTrailers] = await tx.select({ n: sql<number>`count(*)::int` }).from(orgTrailers).where(and(eq(orgTrailers.organizationId, small.id), isNull(orgTrailers.soldAt)));
    if ((ownTrucks?.n ?? 0) + (ownTrailers?.n ?? 0) > 0) fail('has_fleet', 'Първо продайте фирмените камиони и ремаркета на компанията.');
    const members = await tx.select({ userId: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.companyId, small.id));
    const [{ n: bigCount = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(companyMembers).where(eq(companyMembers.companyId, big!.id));
    const rank = await entryRank(tx, big!.id);
    const [dept] = await tx.insert(companyDepartments).values({ organizationId: big!.id, name: small.name.slice(0, DEPARTMENTS.nameMax), headUserId: userId, goalTons: DEPARTMENTS.defaultGoalTons }).returning();
    await tx.update(companyMembers).set({ companyId: big!.id, rankId: rank.id, departmentId: dept!.id }).where(eq(companyMembers.companyId, small.id));
    if (small.treasuryCents > 0) {
      await postTreasury(tx, small.id, [{ category: 'dissolution', amountCents: -small.treasuryCents, description: `Сливане с „${big!.name}“`, idempotencyKey: `merger:${offer!.id}:out`, actorUserId: userId }]);
      await postTreasury(tx, big!.id, [{ category: 'deposit', amountCents: small.treasuryCents, description: `Каса на „${small.name}“ при сливане`, idempotencyKey: `merger:${offer!.id}:in`, actorUserId: userId }]);
    }
    await tx.update(mergerOffers).set({ status: 'accepted', decidedAt: now }).where(eq(mergerOffers.id, offer!.id));
    await addChronicle(tx, big!.id, 'merger', `„${small.name}“ се сля с компанията (${members.length} членове, вече отдел).`, now);
    await tx.delete(organizations).where(eq(organizations.id, small.id));
    await notifyMembers(tx, big!.id, null, 'Сливане 🤝', `„${small.name}“ се присъедини като отдел. Компанията вече има ${bigCount + members.length} членове.`, '/game/company');
    return { merged: true, into: big!.id };
  });
}

export async function declineMerger(db: Database, userId: string, offerId: number, now = new Date()) {
  const m = await membershipOf(db, userId);
  if (!m?.rank.isOwner) fail('forbidden', 'Само собственикът решава.', 403);
  await db.update(mergerOffers).set({ status: 'declined', decidedAt: now }).where(and(eq(mergerOffers.id, offerId), eq(mergerOffers.toOrgId, m!.company.id), eq(mergerOffers.status, 'open')));
  return { declined: true };
}

/** Everything the community page needs for one company. */
export async function companyLifeView(db: DbOrTx, orgId: string, userId: string, now = new Date()) {
  const [departments, assemblies, keys, history, interns, offers] = await Promise.all([
    departmentsView(db, orgId, now),
    assemblyView(db, orgId, userId),
    keyClientsOf(db, orgId, now),
    companyHistory(db, orgId),
    db.select({ id: internStays.id, username: users.username, status: internStays.status, endsAt: internStays.endsAt }).from(internStays).innerJoin(users, eq(users.id, internStays.userId)).where(and(eq(internStays.hostOrgId, orgId), inArray(internStays.status, ['requested', 'active']))),
    db.select({ id: mergerOffers.id, from: organizations.name, status: mergerOffers.status }).from(mergerOffers).innerJoin(organizations, eq(organizations.id, mergerOffers.fromOrgId)).where(and(eq(mergerOffers.toOrgId, orgId), eq(mergerOffers.status, 'open'))),
  ]);
  const [mine] = await db.select({ departmentId: companyMembers.departmentId }).from(companyMembers).where(eq(companyMembers.userId, userId));
  const [myStay] = await db.select({ host: organizations.name, status: internStays.status, endsAt: internStays.endsAt }).from(internStays).innerJoin(organizations, eq(organizations.id, internStays.hostOrgId)).where(and(eq(internStays.userId, userId), inArray(internStays.status, ['requested', 'active']))).limit(1);
  return { departments, assemblies, keys, history, interns, offers, myDepartment: mine?.departmentId ?? null, myStay: myStay ?? null };
}

