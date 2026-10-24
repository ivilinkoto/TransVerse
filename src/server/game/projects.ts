import { and, desc, eq, lte } from 'drizzle-orm';
import { periodWindow } from '@/lib/game/missions';
import { PROJECT_RULES, projectOffers, projectReward, projectTarget, projectTemplate } from '@/lib/game/projects';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companyMembers, companyProjects, organizations } from '@/server/db/schema';
import { postCoins } from './coins';
import { addFeed } from './feed';
import { fail } from './errors';
import { postTreasury } from './finance';
import { addCompanyXp, memberCount, notifyMembers, requirePermission } from './membership';
import { addChronicle } from './chronicle';
import { t as tr, intlLocale } from '@/i18n/t';

export type CompanyProject = typeof companyProjects.$inferSelect;

/** The running project of a company, if any. */
export async function activeProject(db: DbOrTx, organizationId: string): Promise<CompanyProject | null> {
  const [p] = await db.select().from(companyProjects).where(and(eq(companyProjects.organizationId, organizationId), eq(companyProjects.status, 'active')));
  return p ?? null;
}

/** This week's offer of projects for a company, with targets and rewards for its size. */
export async function projectChoices(db: DbOrTx, organizationId: string, now: Date) {
  const [org] = await db.select({ level: organizations.companyLevel }).from(organizations).where(eq(organizations.id, organizationId));
  const members = await memberCount(db, organizationId);
  const week = periodWindow('weekly', now).key;
  const reward = projectReward(members, org?.level ?? 1);
  return projectOffers(`${organizationId}:${week}`).map((t) => ({ ...t, target: projectTarget(t, members), reward }));
}

/** A member with the right starts one of this week's projects (one at a time, one per week). */
export async function startProject(db: Database, actorId: string, templateId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const m = await requirePermission(tx, actorId, 'manage_tenders');
    if (await activeProject(tx, m.company.id)) fail('project_running', tr('Компанията вече има текущ проект.'), 409);
    const week = periodWindow('weekly', now).key;
    const [recent] = await tx.select({ startsAt: companyProjects.startsAt }).from(companyProjects).where(eq(companyProjects.organizationId, m.company.id)).orderBy(desc(companyProjects.startsAt)).limit(1);
    if (recent && periodWindow('weekly', recent.startsAt).key === week) fail('project_this_week', tr('Тази седмица компанията вече започна проект — следващият от понеделник.'), 409);
    const choice = (await projectChoices(tx, m.company.id, now)).find((c) => c.id === templateId);
    if (!choice) fail('project_unknown', tr('Този проект не е в предложенията за седмицата.'));
    const t = projectTemplate(templateId)!;
    const [city] = await tx.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(and(eq(cities.name, t.city), eq(cities.countryCode, t.country)));
    if (!city) fail('project_unknown', tr('Градът на проекта не е намерен.'));
    const [row] = await tx
      .insert(companyProjects)
      .values({ organizationId: m.company.id, templateId, title: t.title, cargoType: t.cargo, destCityId: city!.id, targetTons: choice!.target, rewardCents: choice!.reward.cents, rewardXp: choice!.reward.xp, startedBy: actorId, startsAt: now, endsAt: new Date(now.getTime() + PROJECT_RULES.days * 86_400_000) })
      .returning();
    await notifyMembers(tx, m.company.id, null, () => tr('Нов фирмен проект: {0}', t.title), () => tr('Превозете заедно {0} т {1} до {2} за {3} дни.', choice!.target, t.goods, city!.nameBg, PROJECT_RULES.days), '/game/company/missions');
    return row!;
  });
}

/** Called when a member's load arrives: the tonnes count if it is the project's cargo to its city. */
export async function recordProjectDelivery(tx: Tx, organizationId: string, userId: string, load: { cargoType: string; destCityId: number; tons: number }, now: Date) {
  const [p] = await tx.select().from(companyProjects).where(and(eq(companyProjects.organizationId, organizationId), eq(companyProjects.status, 'active'))).for('update');
  if (!p || p.cargoType !== load.cargoType || p.destCityId !== load.destCityId || p.endsAt <= now) return;
  const contributions = { ...p.contributions, [userId]: (p.contributions[userId] ?? 0) + load.tons };
  const progress = p.progressTons + load.tons;
  const done = progress >= p.targetTons;
  await tx.update(companyProjects).set({ progressTons: Math.min(progress, p.targetTons), contributions, status: done ? 'done' : 'active', completedAt: done ? now : null }).where(eq(companyProjects.id, p.id));
  if (!done) return;
  await postTreasury(tx, organizationId, [{ category: 'company_project', amountCents: p.rewardCents, description: tr('Фирмен проект: {0}', p.title), idempotencyKey: `project:${p.id}`, refType: 'company_project', refId: p.id }]);
  await addCompanyXp(tx, organizationId, p.rewardXp);
  await addFeed(tx, { organizationId, kind: 'project', text: tr('компанията завърши проекта „{0}“', p.title) }, now);
  await addChronicle(tx, organizationId, 'project', `Завършен проект „${p.title}“`, now);
  // ТрансКоин for every member who really helped (and is still in the company).
  const members = new Set((await tx.select({ userId: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.companyId, organizationId))).map((r) => r.userId));
  for (const [helper, tons] of Object.entries(contributions)) {
    if (!members.has(helper) || tons < p.targetTons * PROJECT_RULES.helperShare) continue;
    await postCoins(tx, helper, { amount: PROJECT_RULES.helperCoins, reason: 'project_reward', description: tr('Фирмен проект: {0}', p.title), idempotencyKey: `project:${p.id}:coins:${helper}` });
  }
  await notifyMembers(tx, organizationId, null, () => tr('Проектът е завършен: {0}', p.title), () => tr('+{0} лв. в касата, +{1} опит за компанията и {2} TC за всеки, който помогна.', (p.rewardCents / 100).toLocaleString(intlLocale()), p.rewardXp, PROJECT_RULES.helperCoins), '/game/company/missions');
}

/** Worker: projects past their week without the target fail. */
export async function expireProjects(db: Database, now = new Date()): Promise<number> {
  const due = await db.select().from(companyProjects).where(and(eq(companyProjects.status, 'active'), lte(companyProjects.endsAt, now)));
  for (const p of due) {
    await db.transaction(async (tx) => {
      const [row] = await tx.update(companyProjects).set({ status: 'failed' }).where(and(eq(companyProjects.id, p.id), eq(companyProjects.status, 'active'))).returning({ id: companyProjects.id });
      if (row) await notifyMembers(tx, p.organizationId, null, () => tr('Проектът не е завършен: {0}', p.title), () => tr('Превозени {0} от {1} т. Следващата седмица — нов шанс.', Math.round(p.progressTons), Math.round(p.targetTons)), '/game/company/missions');
    });
  }
  return due.length;
}

/** Finished projects of a company (profile history). */
export async function finishedProjects(db: DbOrTx, organizationId: string, limit = 10) {
  return db.select({ title: companyProjects.title, status: companyProjects.status, completedAt: companyProjects.completedAt, endsAt: companyProjects.endsAt }).from(companyProjects).where(and(eq(companyProjects.organizationId, organizationId), eq(companyProjects.status, 'done'))).orderBy(desc(companyProjects.completedAt)).limit(limit);
}
