import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { insurancePlans, insurancePolicies, organizations } from '@/server/db/schema';
import { t } from '@/i18n/t';
import { companyForUser } from './company';
import { fail } from './errors';
import { post, postTreasury } from './finance';
import { membershipOf, requirePermission } from './membership';
import { notify } from './notify';

/**
 * 1.1.4.2 „Застрахователи“: a company sells a week of cover to other players.
 * The premium goes into its treasury; late penalties of the insured are paid
 * from it (a share, up to a limit, and only while the treasury has the money).
 */
export const INSURER = { days: 7, minCover: 20, maxCover: 80, minPremiumCents: 50_00, maxPremiumCents: 5_000_00, maxPayoutCents: 50_000_00 };

export async function setInsurancePlan(db: Database, userId: string, plan: { premiumCents: number; coverPct: number; maxPayoutCents: number; active: boolean }) {
  if (plan.coverPct < INSURER.minCover || plan.coverPct > INSURER.maxCover) fail('bad_cover', t('Покритието е между {0}% и {1}%.', INSURER.minCover, INSURER.maxCover));
  if (plan.premiumCents < INSURER.minPremiumCents || plan.premiumCents > INSURER.maxPremiumCents) fail('bad_premium', t('Премията е между {0} и {1} лв.', INSURER.minPremiumCents / 100, INSURER.maxPremiumCents / 100));
  if (plan.maxPayoutCents < 1 || plan.maxPayoutCents > INSURER.maxPayoutCents) fail('bad_limit', t('Лимитът е до {0} лв.', INSURER.maxPayoutCents / 100));
  return db.transaction(async (tx) => {
    const m = await requirePermission(tx, userId, 'manage_settings');
    const values = { premiumCents: Math.round(plan.premiumCents), coverPct: Math.round(plan.coverPct), maxPayoutCents: Math.round(plan.maxPayoutCents), active: plan.active, updatedAt: new Date() };
    await tx.insert(insurancePlans).values({ orgId: m.company.id, ...values }).onConflictDoUpdate({ target: insurancePlans.orgId, set: values });
  });
}

export async function insuranceMarket(db: DbOrTx, userId: string, now = new Date()) {
  const plans = await db
    .select({ orgId: insurancePlans.orgId, name: organizations.name, tag: organizations.tag, premiumCents: insurancePlans.premiumCents, coverPct: insurancePlans.coverPct, maxPayoutCents: insurancePlans.maxPayoutCents, treasuryCents: organizations.treasuryCents })
    .from(insurancePlans)
    .innerJoin(organizations, eq(organizations.id, insurancePlans.orgId))
    .where(eq(insurancePlans.active, true))
    .orderBy(insurancePlans.premiumCents)
    .limit(30);
  const company = await companyForUser(db, userId);
  const [policy] = await db.select().from(insurancePolicies).where(and(eq(insurancePolicies.companyId, company.id), gt(insurancePolicies.endsAt, now))).orderBy(desc(insurancePolicies.endsAt)).limit(1);
  const m = await membershipOf(db, userId);
  const [own] = m ? await db.select().from(insurancePlans).where(eq(insurancePlans.orgId, m.company.id)) : [];
  return { plans, policy: policy ?? null, own: own ?? null, orgId: m?.company.id ?? null };
}

export async function buyPolicy(db: Database, userId: string, orgId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [plan] = await tx.select().from(insurancePlans).where(and(eq(insurancePlans.orgId, orgId), eq(insurancePlans.active, true)));
    if (!plan) fail('plan_gone', t('Тази застраховка вече не се предлага.'), 409);
    const m = await membershipOf(tx, userId);
    if (m?.company.id === orgId) fail('own_insurer', t('Не можеш да се застраховаш при собствената си компания.'));
    const [active] = await tx.select({ id: insurancePolicies.id }).from(insurancePolicies).where(and(eq(insurancePolicies.companyId, company.id), gt(insurancePolicies.endsAt, now)));
    if (active) fail('policy_active', t('Вече имаш застраховка за тази седмица.'));
    const [row] = await tx
      .insert(insurancePolicies)
      .values({ orgId, userId, companyId: company.id, coverPct: plan!.coverPct, maxPayoutCents: plan!.maxPayoutCents, premiumCents: plan!.premiumCents, endsAt: new Date(now.getTime() + INSURER.days * 86_400_000) })
      .returning();
    // Personal account first, then the treasury (fixed lock order).
    await post(tx, company.id, [{ category: 'insurance_premium', amountCents: -plan!.premiumCents, description: t('Застраховка за 7 дни'), idempotencyKey: `policy:${row!.id}` }], { requireFunds: true });
    await postTreasury(tx, orgId, [{ category: 'insurance', amountCents: plan!.premiumCents, description: t('Премия от застрахован играч'), idempotencyKey: `policy-in:${row!.id}`, actorUserId: userId }]);
    return row!;
  });
}

/** In a settlement: the insurer pays its share of the late penalties (what its treasury can). */
export async function insurerClaim(tx: Tx, companyId: string, userId: string, deliveryId: string, penaltyCents: number, now: Date) {
  if (penaltyCents <= 0) return 0;
  const [p] = await tx.select().from(insurancePolicies).where(and(eq(insurancePolicies.companyId, companyId), gt(insurancePolicies.endsAt, now))).limit(1);
  if (!p) return 0;
  const [org] = await tx.select({ treasury: organizations.treasuryCents, name: organizations.name }).from(organizations).where(eq(organizations.id, p.orgId));
  const cents = Math.max(0, Math.min(Math.round((penaltyCents * p.coverPct) / 100), p.maxPayoutCents - p.paidOutCents, org?.treasury ?? 0));
  if (!cents) return 0;
  await post(tx, companyId, [{ category: 'insurance_claim', amountCents: cents, description: t('Обезщетение от „{0}“', org!.name), idempotencyKey: `delivery:${deliveryId}:insurer` }]);
  await postTreasury(tx, p.orgId, [{ category: 'insurance', amountCents: -cents, description: t('Изплатено обезщетение'), idempotencyKey: `delivery:${deliveryId}:insurer-out`, actorUserId: userId }]);
  await tx.update(insurancePolicies).set({ paidOutCents: sql`${insurancePolicies.paidOutCents} + ${cents}` }).where(eq(insurancePolicies.id, p.id));
  await notify(tx, userId, 'info', () => t('🛡 Застрахователят плати {0} лв.', Math.round(cents / 100)), () => t('За закъснението покрива „{0}“.', org!.name), '/game/finance');
  return cents;
}
