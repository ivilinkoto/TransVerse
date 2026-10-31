import { and, eq, gt } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { research } from '@/server/db/schema';
import { MAX_TECH_LEVEL, TECHS, TECH_IDS, techCost, type TechId } from '@/lib/game/research';
import { t } from '@/i18n/t';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';

/**
 * 1.1.4.2 „Развойна дейност“: a level counts once its research is over
 * (`busyUntil` has passed). One technology at a time.
 */
export async function researchOf(db: DbOrTx, companyId: string, now = new Date()) {
  const rows = await db.select().from(research).where(eq(research.companyId, companyId));
  return TECH_IDS.map((tech) => {
    const r = rows.find((x) => x.tech === tech);
    const busy = !!r?.busyUntil && r.busyUntil > now;
    return { tech, level: (r?.level ?? 0) - (busy ? 1 : 0), busyUntil: busy ? r!.busyUntil : null };
  });
}

/** The reached level of a technology (0 without). */
export async function techLevel(db: DbOrTx, companyId: string, tech: TechId, now = new Date()) {
  return (await researchOf(db, companyId, now)).find((r) => r.tech === tech)!.level;
}

export async function startResearch(db: Database, userId: string, tech: TechId, now = new Date()) {
  if (!(tech in TECHS)) fail('unknown_tech', t('Непозната технология.'));
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [busy] = await tx.select({ tech: research.tech }).from(research).where(and(eq(research.companyId, company.id), gt(research.busyUntil, now)));
    if (busy) fail('research_busy', t('Вече се изследва „{0}“ — едно по едно.', TECHS[busy.tech as TechId]?.label ?? busy.tech));
    const level = await techLevel(tx, company.id, tech, now);
    if (level >= MAX_TECH_LEVEL) fail('research_max', t('Технологията е на най-високото ниво.'));
    const next = level + 1;
    const cost = techCost(next);
    await post(tx, company.id, [{ category: 'research', amountCents: -cost.cents, description: t('{0} — ниво {1}', TECHS[tech].label, next), idempotencyKey: `research:${company.id}:${tech}:${next}` }], { requireFunds: true });
    const busyUntil = new Date(now.getTime() + cost.hours * 3_600_000);
    await tx.insert(research).values({ companyId: company.id, tech, level: next, busyUntil, updatedAt: now }).onConflictDoUpdate({ target: [research.companyId, research.tech], set: { level: next, busyUntil, updatedAt: now } });
    return { level: next, busyUntil };
  });
}
