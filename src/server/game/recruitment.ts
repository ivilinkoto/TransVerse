import { and, desc, eq, gt, or } from 'drizzle-orm';
import { RECRUITMENT_BOARD } from '@/lib/game/recruitment';
import { isStaff } from '@/server/auth/roles';
import type { Database, DbOrTx } from '@/server/db/client';
import { organizations, recruitmentPosts, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { fail } from './errors';
import { membershipOf, requirePermission } from './membership';
import { assertNotMuted } from './moderation';
import { t } from '@/i18n/t';

/**
 * A post on the recruitment board: a company (recruit permission) looks for
 * drivers, or a driver without a company looks for one. A new post replaces
 * the old one.
 */
export async function postRecruitment(db: Database, userId: string, input: { kind: 'company' | 'driver'; text: string; minLevel?: number }, now = new Date()) {
  if (!(await featureFor(db, userId, 'recruitment_board', now))) fail('not_released', t('Това идва със следващото обновление.'), 403);
  await assertNotMuted(db, userId, now);
  const text = input.text.trim().replace(/\s+/g, ' ');
  if (text.length < 10) fail('short', t('Напиши поне няколко думи.'));
  if (text.length > RECRUITMENT_BOARD.maxText) fail('long', t('До {0} знака.', RECRUITMENT_BOARD.maxText));
  const expiresAt = new Date(now.getTime() + RECRUITMENT_BOARD.days * 86_400_000);
  return db.transaction(async (tx) => {
    if (input.kind === 'company') {
      const m = await requirePermission(tx, userId, 'recruit');
      if (m.company.recruitment === 'closed') fail('closed', t('Набирането на компанията е затворено — отвори го от настройките.'));
      await tx.delete(recruitmentPosts).where(or(eq(recruitmentPosts.orgId, m.company.id), and(eq(recruitmentPosts.userId, userId), eq(recruitmentPosts.kind, 'company'))));
      const [row] = await tx.insert(recruitmentPosts).values({ kind: 'company', userId, orgId: m.company.id, text, minLevel: Math.max(1, Math.min(RECRUITMENT_BOARD.maxLevel, input.minLevel ?? m.company.minJoinLevel)), createdAt: now, expiresAt }).returning();
      return row!;
    }
    if (await membershipOf(tx, userId)) fail('member', t('Вече си в компания.'));
    await tx.delete(recruitmentPosts).where(and(eq(recruitmentPosts.userId, userId), eq(recruitmentPosts.kind, 'driver')));
    const [row] = await tx.insert(recruitmentPosts).values({ kind: 'driver', userId, text, createdAt: now, expiresAt }).returning();
    return row!;
  });
}

/** The author (or someone with the recruit permission in the company, or the staff) takes a post down. */
export async function removeRecruitment(db: Database, userId: string, postId: string) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(recruitmentPosts).where(eq(recruitmentPosts.id, postId));
    if (!p) fail('not_found', t('Обявата вече я няма.'), 404);
    const [me] = await tx.select({ role: users.role }).from(users).where(eq(users.id, userId));
    let allowed = p!.userId === userId || isStaff(me!.role);
    if (!allowed && p!.orgId) {
      const m = await membershipOf(tx, userId);
      allowed = !!m && m.company.id === p!.orgId;
      if (allowed) await requirePermission(tx, userId, 'recruit');
    }
    if (!allowed) fail('forbidden', t('Не можеш да махнеш тази обява.'), 403);
    await tx.delete(recruitmentPosts).where(eq(recruitmentPosts.id, postId));
    return { removed: true };
  });
}

/** The live posts, newest first. */
export async function recruitmentBoard(db: DbOrTx, now: Date) {
  const rows = await db
    .select({ id: recruitmentPosts.id, kind: recruitmentPosts.kind, text: recruitmentPosts.text, minLevel: recruitmentPosts.minLevel, createdAt: recruitmentPosts.createdAt, userId: recruitmentPosts.userId, username: users.username, level: users.level, orgId: recruitmentPosts.orgId, company: organizations.name, tag: organizations.tag, specialization: organizations.specialization, recruitment: organizations.recruitment })
    .from(recruitmentPosts)
    .innerJoin(users, eq(users.id, recruitmentPosts.userId))
    .leftJoin(organizations, eq(organizations.id, recruitmentPosts.orgId))
    .where(gt(recruitmentPosts.expiresAt, now))
    .orderBy(desc(recruitmentPosts.createdAt))
    .limit(100);
  return { companies: rows.filter((r) => r.kind === 'company'), drivers: rows.filter((r) => r.kind === 'driver') };
}
