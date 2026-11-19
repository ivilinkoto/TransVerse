/**
 * „По-просто“ (1.3.2): what players had in the features removed then comes back to them, once.
 * Every payment has its own idempotency key, so a second run pays nothing twice.
 * - Собствен сервиз: the owner gets back what opening and upgrading it cost (what it earned stays).
 * - Рампата and Седмичник held nothing to give back (a dock swap paid only when accepted).
 */
import { eq, like } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { t } from '@/i18n/t';
import { companyForUser } from './company';
import { post } from './finance';

const DONE = 'retired-2026-11-27';

/** What the removed „Собствен сервиз“ cost to open and upgrade (it stopped being sold, so the numbers live here). */
export const OLD_WORKSHOP = { openCents: 50_000_00, upgradeCents: [30_000_00, 60_000_00] } as const;

/** What a workshop of this level cost in all. */
export const workshopRefundCents = (level: number) => OLD_WORKSHOP.openCents + OLD_WORKSHOP.upgradeCents.slice(0, Math.max(0, level - 1)).reduce((a, b) => a + b, 0);

/** Gives back what the removed features held (once). Returns what was settled, or null when already done. */
export async function settleRetired2(db: Database) {
  const [done] = await db.select({ key: jobState.key }).from(jobState).where(eq(jobState.key, DONE));
  if (done) return null;
  const out = { workshops: 0 };
  for (const row of await db.select().from(jobState).where(like(jobState.key, 'workshop:%'))) {
    const w = row.value as { ownerId: string; name: string; level: number };
    await db.transaction(async (tx) => {
      const account = await companyForUser(tx, w.ownerId);
      await post(tx, account.id, [{ category: 'depots', amountCents: workshopRefundCents(w.level), description: t('Сервизите на играчите са закрити: върнато за „{0}“', w.name), idempotencyKey: `retired:workshop:${w.ownerId}` }]);
      await tx.delete(jobState).where(eq(jobState.key, row.key));
    });
    out.workshops++;
  }
  await db.delete(jobState).where(like(jobState.key, 'workshop-visit:%'));
  await db.insert(jobState).values({ key: DONE, value: out }).onConflictDoNothing();
  return out;
}
