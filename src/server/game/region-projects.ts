/**
 * 1.2.6 „На една вълна“: the common project of the region — one a week, in stages,
 * built by everyone's deliveries. The „Проекти“ channel tells how it goes.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { featureLive } from '@/lib/game/features';
import { BADGES } from '@/lib/game/halloween';
import { weekEndsAt, weekKey } from '@/lib/game/leagues';
import { REGION_PROJECT, REGION_PROJECTS, regionTemplateFor, type RegionTemplate } from '@/lib/game/region-projects';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { regionProjectShares, regionProjects, userBadges, users } from '@/server/db/schema';
import { postGameLine } from './chat-life';
import { rewardCase } from './inventory';
import { notify } from './notify';
import { addPassPoints } from './season-pass';
import { t, tx as place } from '@/i18n/t';

const templateOf = (id: string): RegionTemplate | undefined => REGION_PROJECTS.find((p) => p.id === id);
const HREF = '/game/contracts#region-project';

/** The project running now (or null). */
export async function activeRegionProject(db: DbOrTx, now = new Date()) {
  const [p] = await db.select().from(regionProjects).where(and(eq(regionProjects.status, 'active'), sql`${regionProjects.endsAt} > ${now}`)).orderBy(desc(regionProjects.startsAt)).limit(1);
  if (!p) return null;
  const tpl = templateOf(p.templateId);
  return tpl ? { ...p, template: tpl } : null;
}

/** Worker: the week's project starts on Monday; last week's unfinished one ends. */
export async function ensureRegionProject(db: Database, now = new Date()) {
  if (!featureLive('region_projects', now)) return null;
  await db.update(regionProjects).set({ status: 'failed', finishedAt: now }).where(and(eq(regionProjects.status, 'active'), sql`${regionProjects.endsAt} <= ${now}`));
  const week = weekKey(now);
  const startsAt = new Date(weekEndsAt(week).getTime() - REGION_PROJECT.days * 86_400_000);
  const tpl = regionTemplateFor(startsAt);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(regionProjects).values({ templateId: tpl.id, week, country: tpl.country, startsAt, endsAt: weekEndsAt(week) }).onConflictDoNothing().returning();
    if (!row) return null;
    const s = tpl.stages[0]!;
    await postGameLine(tx, 'projects', 'project', t('🏗️ Нов проект на региона: {0} ({1}). Етап 1/{2}: {3} — {4} т {5} до {1}. Всяка доставка се брои!', t(tpl.name), place(tpl.countryName), tpl.stages.length, t(s.label), s.tons, t(CARGO[s.cargo].label).toLowerCase()), { href: HREF, button: t('Виж товарите') }, now);
    return row.id;
  });
}

/**
 * After a delivery: cargo of the current stage to the project's country counts. A stage that
 * fills pays everyone who helped it, then the next one starts (the extra tons go on); the last
 * one finishes the project.
 */
export async function recordRegionDelivery(tx: Tx, userId: string, load: { cargoType: string; destCountry: string; tons: number }, at: Date) {
  if (!featureLive('region_projects', at) || load.tons <= 0) return false;
  const [p] = await tx.select().from(regionProjects).where(and(eq(regionProjects.status, 'active'), eq(regionProjects.country, load.destCountry), sql`${regionProjects.startsAt} <= ${at}`, sql`${regionProjects.endsAt} > ${at}`)).for('update');
  const tpl = p && templateOf(p.templateId);
  const stage = tpl?.stages[p!.stage];
  if (!p || !tpl || !stage || stage.cargo !== load.cargoType) return false;
  await tx
    .insert(regionProjectShares)
    .values({ projectId: p.id, userId, stage: p.stage, tons: load.tons, loads: 1 })
    .onConflictDoUpdate({ target: [regionProjectShares.projectId, regionProjectShares.userId, regionProjectShares.stage], set: { tons: sql`${regionProjectShares.tons} + ${load.tons}`, loads: sql`${regionProjectShares.loads} + 1` } });
  const before = p.progress;
  const after = before + load.tons;
  if (after < stage.tons) {
    await tx.update(regionProjects).set({ progress: after }).where(eq(regionProjects.id, p.id));
    for (const m of REGION_PROJECT.milestones) {
      if (before < stage.tons * m && after >= stage.tons * m) await postGameLine(tx, 'projects', 'project', t('🏗️ {0}: етап {1}/{2} е на {3} % ({4} / {5} т).', t(tpl.name), p.stage + 1, tpl.stages.length, Math.round(m * 100), Math.round(after), stage.tons), { href: HREF, button: t('Помогни') }, at);
    }
    return true;
  }
  await finishStage(tx, p, tpl, at);
  const next = p.stage + 1;
  if (next >= tpl.stages.length) {
    await tx.update(regionProjects).set({ progress: stage.tons, status: 'done', finishedAt: at }).where(eq(regionProjects.id, p.id));
    await finishProject(tx, p, tpl, at);
  } else {
    const n = tpl.stages[next]!;
    await tx.update(regionProjects).set({ stage: next, progress: Math.min(after - stage.tons, n.tons - 1) }).where(eq(regionProjects.id, p.id));
    await postGameLine(tx, 'projects', 'project', t('✅ {0}: етап {1} е готов! Етап {2}/{3}: {4} — {5} т {6} до {7}.', t(tpl.name), p.stage + 1, next + 1, tpl.stages.length, t(n.label), n.tons, t(CARGO[n.cargo].label).toLowerCase(), place(tpl.countryName)), { href: HREF, button: t('Виж товарите') }, at);
  }
  return true;
}

async function helpersOf(tx: Tx, projectId: string, stage?: number) {
  return tx
    .select({ userId: regionProjectShares.userId, tons: sql<number>`sum(${regionProjectShares.tons})::real` })
    .from(regionProjectShares)
    .where(and(eq(regionProjectShares.projectId, projectId), stage == null ? undefined : eq(regionProjectShares.stage, stage)))
    .groupBy(regionProjectShares.userId)
    .having(sql`sum(${regionProjectShares.tons}) >= ${REGION_PROJECT.minTons}`)
    .orderBy(desc(sql`sum(${regionProjectShares.tons})`));
}

async function finishStage(tx: Tx, p: { id: string; stage: number }, tpl: RegionTemplate, at: Date) {
  for (const h of await helpersOf(tx, p.id, p.stage)) {
    await addPassPoints(tx, h.userId, REGION_PROJECT.stagePoints, at);
    await notify(tx, h.userId, 'success', () => t('🏗️ Етапът е готов: {0}', t(tpl.name)), () => t('Помогна с {0} т: +{1} точки за пропуска.', Math.round(h.tons), REGION_PROJECT.stagePoints), HREF);
  }
}

async function finishProject(tx: Tx, p: { id: string }, tpl: RegionTemplate, at: Date) {
  const helpers = await helpersOf(tx, p.id);
  for (const h of helpers) {
    await addPassPoints(tx, h.userId, REGION_PROJECT.finalPoints, at);
    await rewardCase(tx, h.userId, REGION_PROJECT.finalCase, 'region_project', `region-case:${p.id}:${h.userId}`, at);
    await notify(tx, h.userId, 'achievement', () => t('🎉 {0} е построен!', t(tpl.name)), () => t('Благодарим ти: +{0} точки за пропуска и сребърен кейс.', REGION_PROJECT.finalPoints), HREF);
  }
  const top = helpers[0];
  let name = '';
  if (top) {
    const [u] = await tx.select({ username: users.username }).from(users).where(eq(users.id, top.userId));
    name = u?.username ?? '';
    const [got] = await tx.insert(userBadges).values({ userId: top.userId, badge: REGION_PROJECT.title, awardedAt: at }).onConflictDoNothing().returning();
    if (got) await notify(tx, top.userId, 'achievement', () => t('Титла: {0}', BADGES[REGION_PROJECT.title]?.label ?? ''), BADGES[REGION_PROJECT.title]?.description ?? '', '/game/profile');
  }
  await postGameLine(tx, 'projects', 'project', top ? t('🎉 {0} е построен с {1} шофьори! Най-много донесе {2} ({3} т) — „Строител на региона“.', t(tpl.name), helpers.length, name, Math.round(top.tons)) : t('🎉 {0} е построен!', t(tpl.name)), { href: '/game/seasons', button: t('Пропуск') }, at);
}

/** For the card on „Курсове“: the stage, the progress, the top helpers and the viewer's share. */
export async function regionProjectView(db: DbOrTx, userId: string, now = new Date()) {
  const p = await activeRegionProject(db, now);
  if (!p) return null;
  const stage = p.template.stages[p.stage]!;
  const top = await db
    .select({ username: users.username, tons: sql<number>`sum(${regionProjectShares.tons})::real` })
    .from(regionProjectShares)
    .innerJoin(users, eq(users.id, regionProjectShares.userId))
    .where(eq(regionProjectShares.projectId, p.id))
    .groupBy(users.username)
    .orderBy(desc(sql`sum(${regionProjectShares.tons})`))
    .limit(3);
  const [mine] = await db.select({ tons: sql<number>`coalesce(sum(${regionProjectShares.tons}), 0)::real` }).from(regionProjectShares).where(and(eq(regionProjectShares.projectId, p.id), eq(regionProjectShares.userId, userId)));
  return {
    id: p.id,
    name: p.template.name,
    country: p.country,
    countryName: p.template.countryName,
    stage: p.stage + 1,
    stages: p.template.stages.length,
    label: stage.label,
    cargo: stage.cargo as CargoType,
    cargoLabel: CARGO[stage.cargo].label,
    progress: Math.round(p.progress),
    target: stage.tons,
    endsAt: p.endsAt.toISOString(),
    top: top.map((r) => ({ username: r.username, tons: Math.round(r.tons) })),
    mine: Math.round(mine?.tons ?? 0),
  };
}
