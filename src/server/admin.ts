import { desc, eq, ilike, or, sql } from 'drizzle-orm';
import { canBan, canChangeRole, isAdmin, isStaff, ROLES, type Role } from '@/server/auth/roles';
import type { Database, DbOrTx } from '@/server/db/client';
import { adminAudit, companies, companyMembers, organizations, contracts, deliveries, routes, sessions, supportTickets, users } from '@/server/db/schema';
import { replenishMarket } from '@/server/game/contracts';
import { fail } from '@/server/game/errors';
import { post } from '@/server/game/finance';
import { resetBranding } from '@/server/game/membership';
import { notify } from '@/server/game/notify';
import { VIP_MAX_DAYS } from '@/lib/game/vip';

export interface Staff {
  id: string;
  role: string;
  username: string;
}

export function requireStaff(user: { role: string } | null): asserts user is Staff {
  if (!user || !isStaff(user.role)) fail('forbidden', 'Нямате достъп до административния панел.', 403);
}
export function requireAdminRole(user: { role: string }) {
  if (!isAdmin(user.role)) fail('forbidden', 'Действието изисква права на администратор.', 403);
}

async function audit(db: DbOrTx, actorId: string, action: string, targetUserId: string | null, details: Record<string, unknown> = {}) {
  const [row] = await db.insert(adminAudit).values({ actorId, action, targetUserId, details }).returning({ id: adminAudit.id });
  return row!.id;
}

export async function adminStats(db: DbOrTx) {
  const since = new Date(Date.now() - 86_400_000);
  const [row] = await db
    .select({
      users: sql<number>`(select count(*) from ${users})::int`,
      newUsers: sql<number>`(select count(*) from ${users} where ${users.createdAt} >= ${since})::int`,
      companies: sql<number>`(select count(*) from ${companies} where ${companies.kind} = 'company')::int`,
      independents: sql<number>`(select count(*) from ${companies} where ${companies.kind} = 'independent')::int`,
      activeDeliveries: sql<number>`(select count(*) from ${deliveries} where ${deliveries.status} = 'in_progress')::int`,
      deliveries24h: sql<number>`(select count(*) from ${deliveries} where ${deliveries.completedAt} >= ${since})::int`,
      openContracts: sql<number>`(select count(*) from ${contracts} where ${contracts.status} = 'open' and ${contracts.expiresAt} > now())::int`,
      routes: sql<number>`(select count(*) from ${routes})::int`,
      approxRoutes: sql<number>`(select count(*) from ${routes} where ${routes.provider} = 'approximate')::int`,
      openTickets: sql<number>`(select count(*) from ${supportTickets} where ${supportTickets.status} = 'open')::int`,
      online: sql<number>`(select count(distinct user_id) from ${sessions} where ${sessions.createdAt} >= ${since})::int`,
    })
    .from(sql`(select 1) as one`);
  return row!;
}

export async function searchUsers(db: DbOrTx, q: string) {
  const term = `%${q.trim().replace(/[%_]/g, '')}%`;
  return db
    .select({ id: users.id, username: users.username, email: users.email, role: users.role, level: users.level, bannedAt: users.bannedAt, vipUntil: users.vipUntil, createdAt: users.createdAt, kind: companies.kind, company: sql<string | null>`(select o.name from company_members m join organizations o on o.id = m.company_id where m.user_id = ${users.id})`, balance: companies.balanceCents })
    .from(users)
    .leftJoin(companies, eq(companies.ownerId, users.id))
    .where(q.trim() ? or(ilike(users.username, term), ilike(users.email, term), sql`exists (select 1 from company_members m join organizations o on o.id = m.company_id where m.user_id = ${users.id} and o.name ilike ${term})`) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(100);
}

export async function userDetail(db: DbOrTx, userId: string) {
  const [row] = await db.select({ user: users, company: companies }).from(users).leftJoin(companies, eq(companies.ownerId, users.id)).where(eq(users.id, userId));
  if (!row) fail('user_not_found', 'Потребителят не е намерен.', 404);
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name, ownerId: organizations.ownerId, treasuryCents: organizations.treasuryCents })
    .from(companyMembers)
    .innerJoin(organizations, eq(organizations.id, companyMembers.companyId))
    .where(eq(companyMembers.userId, userId));
  const recentAudit = await db.select().from(adminAudit).where(eq(adminAudit.targetUserId, userId)).orderBy(desc(adminAudit.id)).limit(20);
  return { ...row!, org: org ?? null, audit: recentAudit };
}

export async function setUserRole(db: Database, actor: Staff, targetId: string, newRole: string) {
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id, role: users.role, username: users.username }).from(users).where(eq(users.id, targetId)).for('update');
    if (!target) fail('user_not_found', 'Потребителят не е намерен.', 404);
    if (!ROLES.includes(newRole as Role)) fail('invalid_role', 'Невалидна длъжност.');
    if (!canChangeRole(actor.role, actor.id, target!.role, target!.id, newRole)) fail('forbidden', 'Нямате право да зададете тази длъжност.', 403);
    await tx.update(users).set({ role: newRole }).where(eq(users.id, targetId));
    await audit(tx, actor.id, 'set_role', targetId, { from: target!.role, to: newRole });
    await notify(tx, targetId, 'info', 'Промяна на длъжността', `Вашата длъжност е: ${newRole}.`, '/game/profile');
  });
}

export async function setBan(db: Database, actor: Staff, targetId: string, banned: boolean, reason: string) {
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, targetId)).for('update');
    if (!target) fail('user_not_found', 'Потребителят не е намерен.', 404);
    if (!canBan(actor.role, actor.id, target!.role, target!.id)) fail('forbidden', 'Нямате право да блокирате този потребител.', 403);
    await tx.update(users).set(banned ? { bannedAt: new Date(), banReason: reason || null } : { bannedAt: null, banReason: null }).where(eq(users.id, targetId));
    if (banned) await tx.delete(sessions).where(eq(sessions.userId, targetId));
    await audit(tx, actor.id, banned ? 'ban' : 'unban', targetId, { reason });
  });
}

/** Manual balance correction (e.g. compensation after a bug). Always written to the ledger and audit log. */
export async function adjustBalance(db: Database, actor: Staff, targetId: string, amountCents: number, reason: string) {
  requireAdminRole(actor);
  if (!Number.isSafeInteger(amountCents) || amountCents === 0 || Math.abs(amountCents) > 10_000_000_00) fail('invalid_amount', 'Невалидна сума.');
  if (reason.trim().length < 5) fail('reason_required', 'Посочете причина (поне 5 символа).');
  return db.transaction(async (tx) => {
    const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, targetId));
    if (!company) fail('company_not_found', 'Потребителят няма игрови акаунт.', 404);
    const auditId = await audit(tx, actor.id, 'adjust_balance', targetId, { amountCents, reason });
    await post(tx, company!.id, [{ category: 'admin_adjustment', amountCents, description: `Корекция: ${reason}`, idempotencyKey: `admin:${auditId}` }]);
    await notify(tx, targetId, 'info', 'Корекция на баланса', `${amountCents > 0 ? '+' : ''}${(amountCents / 100).toFixed(2)} € — ${reason}`, '/game/finance');
  });
}

export async function adminReplenishMarket(db: Database, actor: Staff) {
  requireAdminRole(actor);
  const created = await replenishMarket(db);
  await audit(db, actor.id, 'replenish_market', null, { created });
  return created;
}

/** Grants VIP until a date (`days` from now, entered by the administrator) or removes it (`days` = 0). */
export async function setVip(db: Database, actor: Staff, targetId: string, days: number) {
  requireAdminRole(actor);
  if (!Number.isInteger(days) || days < 0 || days > VIP_MAX_DAYS) fail('invalid_days', `Срокът е от 1 до ${VIP_MAX_DAYS} дни (0 премахва VIP).`);
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id, vipUntil: users.vipUntil }).from(users).where(eq(users.id, targetId)).for('update');
    if (!target) fail('user_not_found', 'Потребителят не е намерен.', 404);
    const until = days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
    await tx.update(users).set({ vipUntil: until }).where(eq(users.id, targetId));
    await audit(tx, actor.id, days > 0 ? 'set_vip' : 'remove_vip', targetId, { days, until: until?.toISOString() ?? null, previous: target!.vipUntil?.toISOString() ?? null });
    if (until) await notify(tx, targetId, 'achievement', 'Вече сте VIP!', `VIP статусът ви е активен до ${until.toLocaleDateString('bg-BG')}.`, '/game/profile');
    else await notify(tx, targetId, 'info', 'VIP статусът е премахнат', 'Администратор премахна VIP статуса ви.', '/game/profile');
    return until;
  });
}

/** Moderation: removes a company's logo, banner, description, rules and tag. */
export async function adminResetCompanyBranding(db: Database, actor: Staff, companyId: string, reason: string) {
  if (reason.trim().length < 5) fail('reason_required', 'Посочете причина (поне 5 символа).');
  return db.transaction(async (tx) => {
    const [company] = await tx.select({ id: organizations.id, name: organizations.name, ownerId: organizations.ownerId }).from(organizations).where(eq(organizations.id, companyId));
    if (!company) fail('company_not_found', 'Компанията не е намерена.', 404);
    await resetBranding(tx, companyId);
    await audit(tx, actor.id, 'reset_company_branding', company!.ownerId, { company: company!.name, reason });
    await notify(tx, company!.ownerId, 'warning', 'Профилът на компанията е изчистен', `Модератор премахна лого, банер и текстове. Причина: ${reason}`, '/game/company/profile');
  });
}

export async function auditLog(db: DbOrTx, limit = 100) {
  const actor = sql<string>`(select username from users u where u.id = ${adminAudit.actorId})`;
  const target = sql<string | null>`(select username from users u where u.id = ${adminAudit.targetUserId})`;
  return db.select({ entry: adminAudit, actor, target }).from(adminAudit).orderBy(desc(adminAudit.id)).limit(limit);
}

/** Promotes an existing account to founder (used by the deploy bootstrap). */
export async function bootstrapFounder(db: Database, username: string): Promise<'promoted' | 'already' | 'missing'> {
  const [user] = await db.select({ id: users.id, role: users.role }).from(users).where(sql`lower(${users.username}) = lower(${username})`);
  if (!user) return 'missing';
  if (user.role === 'founder') return 'already';
  await db.update(users).set({ role: 'founder' }).where(eq(users.id, user.id));
  await db.insert(adminAudit).values({ actorId: user.id, action: 'bootstrap_founder', targetUserId: user.id, details: { username } });
  return 'promoted';
}

