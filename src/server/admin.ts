import { desc, eq, ilike, or, sql } from 'drizzle-orm';
import { canBan, canChangeRole, isAdmin, isStaff, ROLES, type Role } from '@/server/auth/roles';
import type { Database, DbOrTx } from '@/server/db/client';
import { adminAudit, companies, companyMembers, organizations, contracts, deliveries, routes, sessions, reports, supportTickets, users } from '@/server/db/schema';
import { replenishMarket } from '@/server/game/contracts';
import { fail } from '@/server/game/errors';
import { post } from '@/server/game/finance';
import { resetBranding } from '@/server/game/membership';
import { notify } from '@/server/game/notify';
import { postCoins } from '@/server/game/coins';
import { VIP_MAX_DAYS } from '@/lib/game/vip';
import { createLinkToken } from '@/server/auth/email-links';
import { layoutMail, sendMail } from '@/server/mail';
import { t, intlLocale } from '@/i18n/t';

export interface Staff {
  id: string;
  role: string;
  username: string;
}

export function requireStaff(user: { role: string } | null): asserts user is Staff {
  if (!user || !isStaff(user.role)) fail('forbidden', t('Нямате достъп до административния панел.'), 403);
}
export function requireAdminRole(user: { role: string }) {
  if (!isAdmin(user.role)) fail('forbidden', t('Действието изисква права на администратор.'), 403);
}

export { audit as recordAudit };

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
  if (!row) fail('user_not_found', t('Потребителят не е намерен.'), 404);
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
    if (!target) fail('user_not_found', t('Потребителят не е намерен.'), 404);
    if (!ROLES.includes(newRole as Role)) fail('invalid_role', t('Невалидна длъжност.'));
    if (!canChangeRole(actor.role, actor.id, target!.role, target!.id, newRole)) fail('forbidden', t('Нямате право да зададете тази длъжност.'), 403);
    await tx.update(users).set({ role: newRole }).where(eq(users.id, targetId));
    await audit(tx, actor.id, 'set_role', targetId, { from: target!.role, to: newRole });
    await notify(tx, targetId, 'info', () => t('Промяна на длъжността'), () => t('Вашата длъжност е: {0}.', newRole), '/game/profile');
  });
}

export async function setBan(db: Database, actor: Staff, targetId: string, banned: boolean, reason: string) {
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, targetId)).for('update');
    if (!target) fail('user_not_found', t('Потребителят не е намерен.'), 404);
    if (!canBan(actor.role, actor.id, target!.role, target!.id)) fail('forbidden', t('Нямате право да блокирате този потребител.'), 403);
    await tx.update(users).set(banned ? { bannedAt: new Date(), banReason: reason || null } : { bannedAt: null, banReason: null }).where(eq(users.id, targetId));
    if (banned) await tx.delete(sessions).where(eq(sessions.userId, targetId));
    await audit(tx, actor.id, banned ? 'ban' : 'unban', targetId, { reason });
  });
}

/** Manual balance correction (e.g. compensation after a bug). Always written to the ledger and audit log. */
export async function adjustBalance(db: Database, actor: Staff, targetId: string, amountCents: number, reason: string) {
  requireAdminRole(actor);
  if (!Number.isSafeInteger(amountCents) || amountCents === 0 || Math.abs(amountCents) > 10_000_000_00) fail('invalid_amount', t('Невалидна сума.'));
  if (reason.trim().length < 5) fail('reason_required', t('Посочете причина (поне 5 символа).'));
  return db.transaction(async (tx) => {
    const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, targetId));
    if (!company) fail('company_not_found', t('Потребителят няма игрови акаунт.'), 404);
    const auditId = await audit(tx, actor.id, 'adjust_balance', targetId, { amountCents, reason });
    await post(tx, company!.id, [{ category: 'admin_adjustment', amountCents, description: t('Корекция: {0}', reason), idempotencyKey: `admin:${auditId}` }]);
    await notify(tx, targetId, 'info', () => t('Корекция на баланса'), () => t('{0}{1} лв. — {2}', amountCents > 0 ? '+' : '', (amountCents / 100).toFixed(2), reason), '/game/finance');
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
  if (!Number.isInteger(days) || days < 0 || days > VIP_MAX_DAYS) fail('invalid_days', t('Срокът е от 1 до {0} дни (0 премахва VIP).', VIP_MAX_DAYS));
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id, vipUntil: users.vipUntil }).from(users).where(eq(users.id, targetId)).for('update');
    if (!target) fail('user_not_found', t('Потребителят не е намерен.'), 404);
    const until = days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
    await tx.update(users).set({ vipUntil: until }).where(eq(users.id, targetId));
    await audit(tx, actor.id, days > 0 ? 'set_vip' : 'remove_vip', targetId, { days, until: until?.toISOString() ?? null, previous: target!.vipUntil?.toISOString() ?? null });
    if (until) await notify(tx, targetId, 'achievement', () => t('Вече сте VIP!'), () => t('VIP статусът ви е активен до {0}.', until.toLocaleDateString(intlLocale())), '/game/profile');
    else await notify(tx, targetId, 'info', () => t('VIP статусът е премахнат'), () => t('Администратор премахна VIP статуса ви.'), '/game/profile');
    return until;
  });
}

/** Gives (or with a negative amount takes away) ТрансКоин. Audited; the player is notified. */
export async function adjustCoins(db: Database, actor: Staff, targetId: string, amount: number, reason: string) {
  requireAdminRole(actor);
  if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) fail('invalid_amount', t('Невалидно количество ТрансКоин.'));
  if (reason.trim().length < 3) fail('reason_required', t('Посочете причина (поне 3 символа).'));
  return db.transaction(async (tx) => {
    const auditId = await audit(tx, actor.id, amount > 0 ? 'grant_coins' : 'remove_coins', targetId, { amount, reason });
    await postCoins(tx, targetId, { amount, reason: amount > 0 ? 'admin_grant' : 'admin_remove', description: reason, idempotencyKey: `admin-coins:${auditId}`, actorUserId: actor.id }, { requireFunds: amount < 0 });
    await notify(tx, targetId, 'info', () => amount > 0 ? t('Получихте {0} ТрансКоин', amount) : t('Отнети {0} ТрансКоин', -amount), reason, '/game/shop');
  });
}

export const COMPENSATION = { maxCents: 100_000_00, maxCoins: 10_000, batch: 200 } as const;

/**
 * "Компенсация за всички" (v1.5): the same amount of money or ТрансКоин for
 * every active (not banned) player, e.g. after an outage. One audit entry for
 * the whole run; each payment has its own idempotency key under it, and every
 * player is notified. Returns how many players got it.
 */
export async function compensateAll(db: Database, actor: Staff, input: { kind: 'money' | 'coins'; amount: number; reason: string }, now = new Date()) {
  requireAdminRole(actor);
  const amount = input.kind === 'money' ? Math.round(input.amount * 100) : Math.round(input.amount);
  const max = input.kind === 'money' ? COMPENSATION.maxCents : COMPENSATION.maxCoins;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > max) fail('invalid_amount', input.kind === 'money' ? t('Сумата е от 0,01 до {0} лв.', max / 100) : t('От 1 до {0} ТрансКоин.', max));
  const reason = input.reason.trim();
  if (reason.length < 5) fail('reason_required', t('Посочете причина (поне 5 символа).'));
  const auditId = await audit(db, actor.id, 'compensate_all', null, { kind: input.kind, amount, reason });
  const label = input.kind === 'money' ? t('{0} лв.', (amount / 100).toFixed(2)) : t('{0} ТрансКоин', amount);
  let paid = 0;
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const page = await db
      .select({ userId: users.id, companyId: companies.id })
      .from(users)
      .innerJoin(companies, eq(companies.ownerId, users.id))
      .where(sql`${users.bannedAt} is null and ${users.id} > ${after}`)
      .orderBy(users.id)
      .limit(COMPENSATION.batch);
    if (!page.length) break;
    for (const p of page) {
      await db.transaction(async (tx) => {
        const applied = input.kind === 'money'
          ? await post(tx, p.companyId, [{ category: 'admin_adjustment', amountCents: amount, description: t('Компенсация: {0}', reason), idempotencyKey: `compensation:${auditId}:${p.userId}` }])
          : (await postCoins(tx, p.userId, { amount, reason: 'admin_grant', description: t('Компенсация: {0}', reason), idempotencyKey: `compensation:${auditId}:${p.userId}`, actorUserId: actor.id })) ? 1 : 0;
        if (!applied) return;
        paid++;
        await notify(tx, p.userId, 'success', () => t('Компенсация: +{0}', label), reason, input.kind === 'money' ? '/game/finance' : '/game/shop');
      });
    }
    after = page.at(-1)!.userId;
  }
  await db.update(adminAudit).set({ details: { kind: input.kind, amount, reason, players: paid } }).where(eq(adminAudit.id, auditId));
  return { players: paid, auditId, at: now };
}

/** Moderation: removes a company's logo, banner, description, rules and tag. */
export async function adminResetCompanyBranding(db: Database, actor: Staff, companyId: string, reason: string) {
  if (reason.trim().length < 5) fail('reason_required', t('Посочете причина (поне 5 символа).'));
  return db.transaction(async (tx) => {
    const [company] = await tx.select({ id: organizations.id, name: organizations.name, ownerId: organizations.ownerId }).from(organizations).where(eq(organizations.id, companyId));
    if (!company) fail('company_not_found', t('Компанията не е намерена.'), 404);
    await resetBranding(tx, companyId);
    await audit(tx, actor.id, 'reset_company_branding', company!.ownerId, { company: company!.name, reason });
    await notify(tx, company!.ownerId, 'warning', () => t('Профилът на компанията е изчистен'), () => t('Модератор премахна лого, банер и текстове. Причина: {0}', reason), '/game/company/profile');
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


/**
 * Administrator creates a password-reset link for a player who cannot get the
 * e-mail (to hand over through support). Valid 1 hour, single use, audited.
 */
export async function adminResetLink(db: Database, actor: Staff, targetId: string, base: string) {
  requireAdminRole(actor);
  const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, targetId));
  if (!target) fail('user_not_found', t('Потребителят не е намерен.'), 404);
  if (!canBan(actor.role, actor.id, target!.role, target!.id)) fail('forbidden', t('Нямате право да създавате линк за този профил.'), 403);
  const token = await createLinkToken(db, targetId, 'reset');
  await audit(db, actor.id, 'password_reset_link', targetId);
  return `${base}/reset-password?token=${token}`;
}

/**
 * Marks an e-mail as confirmed by hand (when the mailbox does not receive our mail). Admins and founders may do it
 * for anyone, themselves and other founders included: it only unlocks features and is audited.
 */
export async function adminVerifyEmail(db: Database, actor: Staff, targetId: string) {
  requireAdminRole(actor);
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, targetId));
    if (!u) fail('user_not_found', t('Потребителят не е намерен.'), 404);
    await tx.update(users).set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` }).where(eq(users.id, targetId));
    await audit(tx, actor.id, 'verify_email', targetId);
  });
}

/** Sends a test e-mail and returns the mail server's answer (or throws its error). */
export async function sendTestMail(actor: Staff, to: string, base: string) {
  if (!isStaff(actor.role)) fail('forbidden', t('Нямате достъп.'), 403);
  return sendMail(
    layoutMail({
      to,
      subject: t('Проба от TransVerse'),
      heading: t('Пробно писмо'),
      lines: [t('Това е проба от админ панела на TransVerse. Ако го виждаш във „Входящи“, писмата стигат до тази поща.')],
      button: { label: t('Към играта'), url: `${base}/game` },
      footer: t('Изпратено от {0}.', actor.username),
    }),
    'test',
  );
}

/** What waits for the staff: open support questions and open reports (for the badge on the in-game "Админ панел" button). */
export async function staffAttention(db: DbOrTx) {
  const [row] = await db
    .select({
      tickets: sql<number>`(select count(*) from ${supportTickets} where ${supportTickets.status} = 'open')::int`,
      reports: sql<number>`(select count(*) from ${reports} where ${reports.status} = 'open')::int`,
    })
    .from(sql`(select 1) as one`);
  return { tickets: row?.tickets ?? 0, reports: row?.reports ?? 0, total: (row?.tickets ?? 0) + (row?.reports ?? 0) };
}

/**
 * 1.1.2: how the new players of the last 7 days are doing — who drove their
 * first load, who drove five, who came back the next day. Shows where people
 * give up.
 */
export async function newPlayerFunnel(db: DbOrTx, now = new Date()) {
  const week = new Date(now.getTime() - 7 * 86_400_000);
  const day = new Date(now.getTime() - 86_400_000);
  const { rows } = await db.execute<{ today: number; week: number; first: number; five: number; back: number; company: number }>(sql`
    select
      count(*) filter (where u.created_at >= ${day})::int as today,
      count(*)::int as week,
      count(*) filter (where c.deliveries >= 1)::int as first,
      count(*) filter (where c.deliveries >= 5)::int as five,
      count(*) filter (where u.last_seen_at >= u.created_at + interval '1 day')::int as back,
      count(*) filter (where exists (select 1 from company_members m where m.user_id = u.id))::int as company
    from users u left join companies c on c.owner_id = u.id
    where u.created_at >= ${week} and u.banned_at is null`);
  const r = rows[0] ?? { today: 0, week: 0, first: 0, five: 0, back: 0, company: 0 };
  return { today: Number(r.today), week: Number(r.week), first: Number(r.first), five: Number(r.five), back: Number(r.back), company: Number(r.company) };
}
