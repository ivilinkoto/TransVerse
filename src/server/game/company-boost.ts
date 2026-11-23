/**
 * 1.3.2.2: the company booster (src/lib/game/speed-up.ts COMPANY_BOOST), kept in
 * job_state under `company-boost:<organization>` ({ until, by }).
 */
import { eq } from 'drizzle-orm';
import { COMPANY_BOOST } from '@/lib/game/speed-up';
import type { Database, DbOrTx } from '@/server/db/client';
import { jobState, users } from '@/server/db/schema';
import { postCoins } from './coins';
import { fail } from './errors';
import { membershipOf, notifyMembers } from './membership';
import { t } from '@/i18n/t';

/** 1.3.2.2: until when a player company's booster runs (null: none). */
export async function companyBoostUntil(db: DbOrTx, organizationId: string): Promise<Date | null> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, `company-boost:${organizationId}`));
  const until = (row?.value as { until?: string } | undefined)?.until;
  return until ? new Date(until) : null;
}

/** 1.3.2.2: a member pays ТрансКоин for the company booster (+25 % for every member for 24 hours). */
export async function buyCompanyBoost(db: Database, userId: string, now: Date) {
  return db.transaction(async (tx) => {
    const m = await membershipOf(tx, userId, true);
    if (!m) fail('no_company', t('Първо влез в компания.'));
    const key = `company-boost:${m!.company.id}`;
    const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key)).for('update');
    const was = (row?.value as { until?: string } | undefined)?.until;
    const from = was && new Date(was) > now ? new Date(was) : now;
    const until = new Date(from.getTime() + COMPANY_BOOST.hours * 3_600_000);
    await postCoins(tx, userId, { amount: -COMPANY_BOOST.coins, reason: 'shop', description: t('Бустер за компанията · {0} ч', COMPANY_BOOST.hours), idempotencyKey: `company-boost:${m!.company.id}:${now.getTime()}` }, { requireFunds: true });
    const value = { until: until.toISOString(), by: userId };
    if (row) await tx.update(jobState).set({ value, updatedAt: now }).where(eq(jobState.key, key));
    else await tx.insert(jobState).values({ key, value, updatedAt: now });
    const [me] = await tx.select({ name: users.username }).from(users).where(eq(users.id, userId));
    await notifyMembers(tx, m!.company.id, null, () => t('🚀 {0} пусна бустер за компанията', me?.name ?? ''), () => t('+{0}% пари за всеки курс на всички в компанията до {1}.', Math.round(COMPANY_BOOST.share * 100), until.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), '/game/company');
    return until;
  });
}
