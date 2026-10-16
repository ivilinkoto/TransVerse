import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ALL_PERMISSIONS,
  COMPANY_LIMITS,
  COMPANY_UPGRADES,
  companyLevelForXp,
  DEFAULT_RANKS,
  hasUnlock,
  maxRanks,
  memberBonuses,
  memberCapacity,
  type MemberBonuses,
  type Permission,
  RECRUITMENT,
  sniffImage,
  type UpgradeLevels,
} from '@/lib/game/company';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, companyApplications, companyAssets, companyMembers, companyRanks, users } from '@/server/db/schema';
import { fail } from './errors';
import { post } from './finance';
import { logActivity, notify } from './notify';

export type Rank = typeof companyRanks.$inferSelect;
type CompanyRow = typeof companies.$inferSelect;

// ── Validation (shared by the API route) ─────────────────────────────────

const text = (max: number) => z.string().trim().max(max, `Най-много ${max} символа.`);
export const rankInputSchema = z.object({
  name: z.string().trim().min(2, 'Името е твърде кратко.').max(32, 'Най-много 32 символа.'),
  priority: z.coerce.number().int().min(1).max(999),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(ALL_PERMISSIONS.length),
});
export const profileSchema = z.object({
  description: text(COMPANY_LIMITS.descriptionMax),
  rules: text(COMPANY_LIMITS.rulesMax),
  tag: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z0-9А-Я]{2,5})?$/u, 'Тагът е 2–5 главни букви или цифри.')
    .optional(),
  color: z
    .string()
    .regex(/^(#[0-9a-fA-F]{6})?$/, 'Невалиден цвят.')
    .optional(),
});
export const settingsSchema = z.object({
  recruitment: z.enum(Object.keys(RECRUITMENT) as [keyof typeof RECRUITMENT, ...(keyof typeof RECRUITMENT)[]]),
  minJoinLevel: z.coerce.number().int().min(1).max(50),
  contributionRate: z.coerce.number().min(0).max(COMPANY_LIMITS.contributionMax),
});

// ── Lookups ──────────────────────────────────────────────────────────────

export interface Membership {
  company: CompanyRow;
  rank: Rank;
  member: typeof companyMembers.$inferSelect;
}

export async function membershipOf(db: DbOrTx, userId: string, lock = false): Promise<Membership | null> {
  const [m] = await db.select().from(companyMembers).where(eq(companyMembers.userId, userId));
  if (!m) return null;
  const q = db.select().from(companies).where(eq(companies.id, m.companyId));
  const [company] = lock ? await q.for('update') : await q;
  const [rank] = await db.select().from(companyRanks).where(eq(companyRanks.id, m.rankId));
  return { company: company!, rank: rank!, member: m };
}

export const can = (rank: Pick<Rank, 'isOwner' | 'permissions'>, permission: Permission) => rank.isOwner || rank.permissions.includes(permission);

/** The actor's membership, failing unless they hold the permission. Locks the company row. */
async function requirePermission(tx: Tx, userId: string, permission: Permission): Promise<Membership> {
  const m = await membershipOf(tx, userId, true);
  if (!m) fail('not_member', 'Не членувате в компания.', 403);
  if (!can(m!.rank, permission)) fail('forbidden', 'Длъжността ви няма това право.', 403);
  return m!;
}

/** Bonuses a player gets from the company they belong to (none outside a company). */
export async function bonusesForUser(db: DbOrTx, userId: string): Promise<{ membership: Membership; bonuses: MemberBonuses } | null> {
  const m = await membershipOf(db, userId);
  if (!m) return null;
  return { membership: m, bonuses: memberBonuses(m.company.upgrades as UpgradeLevels) };
}

async function memberCount(db: DbOrTx, companyId: string): Promise<number> {
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(companyMembers).where(eq(companyMembers.companyId, companyId));
  return n;
}

/** The rank new members receive: the most junior non-owner rank. */
async function entryRank(db: DbOrTx, companyId: string): Promise<Rank> {
  const [rank] = await db
    .select()
    .from(companyRanks)
    .where(and(eq(companyRanks.companyId, companyId), eq(companyRanks.isOwner, false)))
    .orderBy(desc(companyRanks.priority))
    .limit(1);
  if (!rank) fail('no_entry_rank', 'Компанията няма длъжност за нови членове.');
  return rank!;
}

async function notifyMembers(tx: Tx, companyId: string, permission: Permission | null, title: string, body: string, href: string) {
  const rows = await tx.select({ userId: companyMembers.userId, rank: companyRanks }).from(companyMembers).innerJoin(companyRanks, eq(companyRanks.id, companyMembers.rankId)).where(eq(companyMembers.companyId, companyId));
  for (const r of rows) if (!permission || can(r.rank, permission)) await notify(tx, r.userId, 'info', title, body, href);
}

// ── Founding ─────────────────────────────────────────────────────────────

/** Creates the default ranks and makes the owner a member (called when a company is founded). */
export async function setupCompanyMembership(tx: Tx, companyId: string, ownerId: string) {
  const ranks = await tx
    .insert(companyRanks)
    .values(DEFAULT_RANKS.map((r) => ({ companyId, name: r.name, priority: r.priority, permissions: r.permissions, isOwner: r.isOwner })))
    .returning();
  const owner = ranks.find((r) => r.isOwner)!;
  await tx.insert(companyMembers).values({ userId: ownerId, companyId, rankId: owner.id });
}

// ── Joining and leaving ──────────────────────────────────────────────────

/** Joins an open company directly, or files an application to one that recruits by application. */
export async function joinCompany(db: Database, userId: string, companyId: string, message = ''): Promise<'joined' | 'applied'> {
  return db.transaction(async (tx) => {
    if (await membershipOf(tx, userId)) fail('already_member', 'Вече членувате в компания. Първо я напуснете.', 409);
    const [company] = await tx.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.kind, 'company'))).for('update');
    if (!company) fail('company_not_found', 'Компанията не е намерена.', 404);
    const [user] = await tx.select({ level: users.level, username: users.username }).from(users).where(eq(users.id, userId));
    if (company!.recruitment === 'closed') fail('recruitment_closed', 'Компанията не приема нови членове.');
    if ((user?.level ?? 1) < company!.minJoinLevel) fail('join_level', `Компанията приема играчи от ниво ${company!.minJoinLevel}.`);
    if ((await memberCount(tx, companyId)) >= memberCapacity(company!.upgrades as UpgradeLevels)) fail('company_full', 'Компанията няма свободни места.');

    if (company!.recruitment === 'open') {
      const rank = await entryRank(tx, companyId);
      await tx.insert(companyMembers).values({ userId, companyId, rankId: rank.id });
      await tx.update(companyApplications).set({ status: 'withdrawn', decidedAt: new Date() }).where(and(eq(companyApplications.userId, userId), eq(companyApplications.status, 'pending')));
      await logActivity(tx, userId, 'company_joined', { companyId });
      await notifyMembers(tx, companyId, 'manage_members', 'Нов член', `${user!.username} се присъедини към „${company!.name}“.`, '/game/company/members');
      return 'joined' as const;
    }
    const inserted = await tx
      .insert(companyApplications)
      .values({ companyId, userId, message: message.trim().slice(0, 500) })
      .onConflictDoNothing()
      .returning({ id: companyApplications.id });
    if (!inserted.length) fail('already_applied', 'Вече сте кандидатствали в тази компания.', 409);
    await logActivity(tx, userId, 'company_applied', { companyId });
    await notifyMembers(tx, companyId, 'manage_members', 'Нова кандидатура', `${user!.username} кандидатства за „${company!.name}“.`, '/game/company/members');
    return 'applied' as const;
  });
}

export async function withdrawApplication(db: Database, userId: string, applicationId: string) {
  const res = await db
    .update(companyApplications)
    .set({ status: 'withdrawn', decidedAt: new Date() })
    .where(and(eq(companyApplications.id, applicationId), eq(companyApplications.userId, userId), eq(companyApplications.status, 'pending')))
    .returning({ id: companyApplications.id });
  if (!res.length) fail('application_not_found', 'Кандидатурата не е намерена.', 404);
}

export async function decideApplication(db: Database, actorId: string, applicationId: string, accept: boolean) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_members');
    const [app] = await tx
      .select()
      .from(companyApplications)
      .where(and(eq(companyApplications.id, applicationId), eq(companyApplications.companyId, actor.company.id), eq(companyApplications.status, 'pending')))
      .for('update');
    if (!app) fail('application_not_found', 'Кандидатурата не е намерена или вече е разгледана.', 404);
    const decided = { decidedBy: actorId, decidedAt: new Date() };
    if (!accept) {
      await tx.update(companyApplications).set({ status: 'rejected', ...decided }).where(eq(companyApplications.id, app!.id));
      await notify(tx, app!.userId, 'warning', 'Кандидатурата е отхвърлена', `„${actor.company.name}“ отхвърли кандидатурата ви.`, '/game/companies');
      return 'rejected' as const;
    }
    if (await membershipOf(tx, app!.userId)) {
      await tx.update(companyApplications).set({ status: 'withdrawn', ...decided }).where(eq(companyApplications.id, app!.id));
      fail('already_member', 'Играчът вече членува в друга компания.', 409);
    }
    if ((await memberCount(tx, actor.company.id)) >= memberCapacity(actor.company.upgrades as UpgradeLevels)) fail('company_full', 'Няма свободни места — разширете административната сграда.');
    const rank = await entryRank(tx, actor.company.id);
    await tx.insert(companyMembers).values({ userId: app!.userId, companyId: actor.company.id, rankId: rank.id });
    await tx.update(companyApplications).set({ status: 'accepted', ...decided }).where(eq(companyApplications.id, app!.id));
    await tx.update(companyApplications).set({ status: 'withdrawn', decidedAt: new Date() }).where(and(eq(companyApplications.userId, app!.userId), eq(companyApplications.status, 'pending')));
    await logActivity(tx, actorId, 'company_application_accepted', { applicationId, userId: app!.userId });
    await notify(tx, app!.userId, 'achievement', `Приети сте в „${actor.company.name}“!`, 'Вече получавате бонусите на компанията.', '/game/company');
    return 'accepted' as const;
  });
}

export async function leaveCompany(db: Database, userId: string) {
  return db.transaction(async (tx) => {
    const m = await membershipOf(tx, userId);
    if (!m) fail('not_member', 'Не членувате в компания.');
    if (m!.rank.isOwner) fail('owner_cannot_leave', 'Собственикът не може да напусне собствената си компания.');
    await tx.delete(companyMembers).where(eq(companyMembers.userId, userId));
    await logActivity(tx, userId, 'company_left', { companyId: m!.company.id });
    await notify(tx, m!.company.ownerId, 'info', 'Член напусна компанията', 'Един от членовете напусна компанията.', '/game/company/members');
  });
}

/** Loads a member of the actor's company that the actor outranks. */
async function subordinate(tx: Tx, actor: Membership, targetUserId: string) {
  const [target] = await tx
    .select({ member: companyMembers, rank: companyRanks })
    .from(companyMembers)
    .innerJoin(companyRanks, eq(companyRanks.id, companyMembers.rankId))
    .where(and(eq(companyMembers.userId, targetUserId), eq(companyMembers.companyId, actor.company.id)));
  if (!target) fail('member_not_found', 'Членът не е намерен.', 404);
  if (target!.rank.isOwner || target!.rank.priority <= actor.rank.priority) fail('forbidden', 'Можете да управлявате само по-ниски длъжности.', 403);
  return target!;
}

export async function kickMember(db: Database, actorId: string, targetUserId: string) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_members');
    await subordinate(tx, actor, targetUserId);
    await tx.delete(companyMembers).where(eq(companyMembers.userId, targetUserId));
    await logActivity(tx, actorId, 'company_member_removed', { userId: targetUserId });
    await notify(tx, targetUserId, 'warning', 'Изключени сте от компанията', `Вече не членувате в „${actor.company.name}“.`, '/game/companies');
  });
}

export async function setMemberRank(db: Database, actorId: string, targetUserId: string, rankId: string) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_members');
    await subordinate(tx, actor, targetUserId);
    const [rank] = await tx.select().from(companyRanks).where(and(eq(companyRanks.id, rankId), eq(companyRanks.companyId, actor.company.id)));
    if (!rank) fail('rank_not_found', 'Длъжността не е намерена.', 404);
    if (rank!.isOwner || rank!.priority <= actor.rank.priority) fail('forbidden', 'Можете да назначавате само на длъжности под вашата.', 403);
    await tx.update(companyMembers).set({ rankId }).where(eq(companyMembers.userId, targetUserId));
    await notify(tx, targetUserId, 'info', 'Нова длъжност', `Вашата длъжност в „${actor.company.name}“ е „${rank!.name}“.`, '/game/company');
  });
}

// ── Ranks ────────────────────────────────────────────────────────────────

function checkRankInput(actor: Membership, input: z.infer<typeof rankInputSchema>) {
  if (input.priority <= actor.rank.priority) fail('forbidden', 'Длъжността трябва да е под вашата.', 403);
  // Nobody can hand out privileges they do not hold themselves.
  if (!actor.rank.isOwner && input.permissions.some((p) => !actor.rank.permissions.includes(p))) fail('forbidden', 'Не можете да давате права, които нямате.', 403);
}

export async function createRank(db: Database, actorId: string, input: z.infer<typeof rankInputSchema>) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_ranks');
    checkRankInput(actor, input);
    const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(companyRanks).where(eq(companyRanks.companyId, actor.company.id));
    const limit = maxRanks(actor.company.companyLevel);
    if (n >= limit) fail('rank_limit', `Достигнахте лимита от ${limit} длъжности. Развийте компанията, за да отключите повече.`);
    const [rank] = await tx.insert(companyRanks).values({ companyId: actor.company.id, ...input }).returning();
    return rank!;
  });
}

export async function updateRank(db: Database, actorId: string, rankId: string, input: z.infer<typeof rankInputSchema>) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_ranks');
    const [rank] = await tx.select().from(companyRanks).where(and(eq(companyRanks.id, rankId), eq(companyRanks.companyId, actor.company.id)));
    if (!rank) fail('rank_not_found', 'Длъжността не е намерена.', 404);
    if (rank!.isOwner) {
      // The owner rank keeps every permission and its place; only its name can change.
      if (!actor.rank.isOwner) fail('forbidden', 'Само собственикът може да преименува тази длъжност.', 403);
      await tx.update(companyRanks).set({ name: input.name }).where(eq(companyRanks.id, rankId));
      return;
    }
    if (rank!.priority <= actor.rank.priority) fail('forbidden', 'Можете да променяте само длъжности под вашата.', 403);
    checkRankInput(actor, input);
    await tx.update(companyRanks).set(input).where(eq(companyRanks.id, rankId));
  });
}

export async function deleteRank(db: Database, actorId: string, rankId: string) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_ranks');
    const [rank] = await tx.select().from(companyRanks).where(and(eq(companyRanks.id, rankId), eq(companyRanks.companyId, actor.company.id)));
    if (!rank) fail('rank_not_found', 'Длъжността не е намерена.', 404);
    if (rank!.isOwner || rank!.priority <= actor.rank.priority) fail('forbidden', 'Не можете да изтриете тази длъжност.', 403);
    const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(companyMembers).where(eq(companyMembers.rankId, rankId));
    if (n > 0) fail('rank_in_use', 'Първо преместете членовете с тази длъжност.');
    const [{ others = 0 } = {}] = await tx
      .select({ others: sql<number>`count(*)::int` })
      .from(companyRanks)
      .where(and(eq(companyRanks.companyId, actor.company.id), eq(companyRanks.isOwner, false)));
    if (others <= 1) fail('last_rank', 'Нужна е поне една длъжност за нови членове.');
    await tx.delete(companyRanks).where(eq(companyRanks.id, rankId));
  });
}

// ── Profile, settings and development ────────────────────────────────────

export async function updateProfile(db: Database, actorId: string, input: z.infer<typeof profileSchema>) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'edit_profile');
    const level = actor.company.companyLevel;
    if (input.tag && !hasUnlock(level, 'tag')) fail('locked', 'Тагът се отключва на ниво 5 на компанията.');
    if (input.color && !hasUnlock(level, 'banner')) fail('locked', 'Фирменият цвят се отключва на ниво 3 на компанията.');
    await tx
      .update(companies)
      .set({ description: input.description || null, rules: input.rules || null, tag: input.tag || null, color: input.color || null })
      .where(eq(companies.id, actor.company.id));
    await logActivity(tx, actorId, 'company_profile_updated', { companyId: actor.company.id });
  });
}

export async function updateSettings(db: Database, actorId: string, input: z.infer<typeof settingsSchema>) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_settings');
    await tx.update(companies).set(input).where(eq(companies.id, actor.company.id));
    await logActivity(tx, actorId, 'company_settings_updated', { companyId: actor.company.id, ...input });
  });
}

/** Buys the next level of a company upgrade from the company treasury. */
export async function buyCompanyUpgrade(db: Database, actorId: string, upgradeId: string) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_upgrades');
    const upgrade = COMPANY_UPGRADES.find((u) => u.id === upgradeId);
    if (!upgrade) fail('unknown_upgrade', 'Непознато подобрение.');
    const levels = actor.company.upgrades as UpgradeLevels;
    const current = levels[upgrade!.id] ?? 0;
    const next = upgrade!.levels[current];
    if (!next) fail('max_level', 'Подобрението е на максимално ниво.');
    if (actor.company.companyLevel < next!.minCompanyLevel) fail('company_level', `Нужно е ниво ${next!.minCompanyLevel} на компанията.`);
    await post(
      tx,
      actor.company.id,
      [{ category: 'company_upgrade', amountCents: -next!.costCents, description: `${upgrade!.label} — ниво ${current + 1}`, idempotencyKey: `company-upgrade:${actor.company.id}:${upgrade!.id}:${current + 1}` }],
      { requireFunds: true },
    );
    await tx
      .update(companies)
      .set({ upgrades: { ...levels, [upgrade!.id]: current + 1 } })
      .where(eq(companies.id, actor.company.id));
    await logActivity(tx, actorId, 'company_upgrade', { upgradeId, level: current + 1 });
    await notifyMembers(tx, actor.company.id, null, 'Компанията се развива', `${upgrade!.label} достигна ниво ${current + 1}: ${upgrade!.description(current + 1)}.`, '/game/company/development');
    return current + 1;
  });
}

/** Adds company experience from a member's delivery and announces level-ups. */
export async function addCompanyXp(tx: Tx, companyId: string, xp: number) {
  const [row] = await tx.update(companies).set({ companyXp: sql`${companies.companyXp} + ${xp}` }).where(eq(companies.id, companyId)).returning({ xp: companies.companyXp, level: companies.companyLevel, name: companies.name });
  const level = companyLevelForXp(row!.xp);
  if (level > row!.level) {
    await tx.update(companies).set({ companyLevel: level }).where(eq(companies.id, companyId));
    await notifyMembers(tx, companyId, null, `„${row!.name}“ достигна ниво ${level}!`, 'Вижте новите възможности в „Развитие“.', '/game/company/development');
  }
}

// ── Branding images ──────────────────────────────────────────────────────

export type AssetKind = 'logo' | 'banner';

export async function uploadAsset(db: Database, actorId: string, kind: AssetKind, bytes: Uint8Array) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'edit_profile');
    if (kind === 'banner' && !hasUnlock(actor.company.companyLevel, 'banner')) fail('locked', 'Банерът се отключва на ниво 3 на компанията.');
    const max = kind === 'logo' ? COMPANY_LIMITS.logoMaxBytes : COMPANY_LIMITS.bannerMaxBytes;
    if (bytes.length > max) fail('too_large', `Файлът е твърде голям (най-много ${Math.round(max / 1024)} KB).`);
    const mime = sniffImage(bytes);
    if (!mime) fail('bad_image', 'Позволени са само PNG, JPEG и WebP изображения.');
    const data = Buffer.from(bytes);
    await tx
      .insert(companyAssets)
      .values({ companyId: actor.company.id, kind, mime: mime!, data })
      .onConflictDoUpdate({ target: [companyAssets.companyId, companyAssets.kind], set: { mime: mime!, data, updatedAt: new Date() } });
    await tx.update(companies).set({ brandingVersion: sql`${companies.brandingVersion} + 1` }).where(eq(companies.id, actor.company.id));
    await logActivity(tx, actorId, 'company_asset_uploaded', { kind, bytes: bytes.length });
  });
}

export async function removeAsset(db: Database, actorId: string, kind: AssetKind) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'edit_profile');
    await tx.delete(companyAssets).where(and(eq(companyAssets.companyId, actor.company.id), eq(companyAssets.kind, kind)));
    await tx.update(companies).set({ brandingVersion: sql`${companies.brandingVersion} + 1` }).where(eq(companies.id, actor.company.id));
  });
}

export async function getAsset(db: DbOrTx, companyId: string, kind: AssetKind) {
  const [asset] = await db.select().from(companyAssets).where(and(eq(companyAssets.companyId, companyId), eq(companyAssets.kind, kind)));
  return asset ?? null;
}

export async function assetKinds(db: DbOrTx, companyId: string): Promise<Set<AssetKind>> {
  const rows = await db.select({ kind: companyAssets.kind }).from(companyAssets).where(eq(companyAssets.companyId, companyId));
  return new Set(rows.map((r) => r.kind as AssetKind));
}

// ── Views ────────────────────────────────────────────────────────────────

const membersCount = sql<number>`(select count(*)::int from company_members m where m.company_id = ${companies.id})`;

export async function companyDirectory(db: DbOrTx, search = '', limit = 60) {
  const conditions = [eq(companies.kind, 'company')];
  if (search.trim()) conditions.push(ilike(companies.name, `%${search.trim().replace(/[%_\\]/g, '')}%`));
  return db
    .select({
      id: companies.id,
      name: companies.name,
      tag: companies.tag,
      color: companies.color,
      recruitment: companies.recruitment,
      minJoinLevel: companies.minJoinLevel,
      companyLevel: companies.companyLevel,
      upgrades: companies.upgrades,
      brandingVersion: companies.brandingVersion,
      description: companies.description,
      deliveries: companies.deliveries,
      owner: users.username,
      members: membersCount,
    })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(...conditions))
    .orderBy(desc(companies.companyLevel), desc(companies.companyXp))
    .limit(limit);
}

export async function companyMembersView(db: DbOrTx, companyId: string) {
  return db
    .select({ userId: users.id, username: users.username, level: users.level, member: companyMembers, rank: companyRanks })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .innerJoin(companyRanks, eq(companyRanks.id, companyMembers.rankId))
    .where(eq(companyMembers.companyId, companyId))
    .orderBy(asc(companyRanks.priority), desc(companyMembers.contributedCents));
}

export async function companyRanksView(db: DbOrTx, companyId: string) {
  return db.select().from(companyRanks).where(eq(companyRanks.companyId, companyId)).orderBy(asc(companyRanks.priority));
}

export async function pendingApplications(db: DbOrTx, companyId: string) {
  return db
    .select({ application: companyApplications, username: users.username, level: users.level })
    .from(companyApplications)
    .innerJoin(users, eq(users.id, companyApplications.userId))
    .where(and(eq(companyApplications.companyId, companyId), eq(companyApplications.status, 'pending')))
    .orderBy(asc(companyApplications.createdAt));
}

export async function myApplications(db: DbOrTx, userId: string) {
  return db
    .select({ application: companyApplications, company: companies.name })
    .from(companyApplications)
    .innerJoin(companies, eq(companies.id, companyApplications.companyId))
    .where(and(eq(companyApplications.userId, userId), eq(companyApplications.status, 'pending')));
}

export async function publicCompany(db: DbOrTx, companyId: string) {
  const [row] = await db
    .select({ company: companies, owner: users.username, members: membersCount })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(companies.id, companyId), eq(companies.kind, 'company')));
  return row ?? null;
}

// ── Staff moderation ─────────────────────────────────────────────────────

/** Clears a company's images and texts (moderation). The caller writes the audit entry. */
export async function resetBranding(tx: Tx, companyId: string) {
  await tx.delete(companyAssets).where(eq(companyAssets.companyId, companyId));
  await tx
    .update(companies)
    .set({ description: null, rules: null, tag: null, brandingVersion: sql`${companies.brandingVersion} + 1` })
    .where(eq(companies.id, companyId));
}

/** Everything the company section needs about the player's own company. */
export async function companyHub(db: DbOrTx, userId: string) {
  const m = await membershipOf(db, userId);
  if (!m) return null;
  const [assets, members, pending] = await Promise.all([
    assetKinds(db, m.company.id),
    memberCount(db, m.company.id),
    can(m.rank, 'manage_members') ? pendingApplications(db, m.company.id) : Promise.resolve([]),
  ]);
  return { ...m, assets, members, pending };
}
