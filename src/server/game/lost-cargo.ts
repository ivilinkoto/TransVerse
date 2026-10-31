import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, lostCases, userBadges } from '@/server/db/schema';
import { CLUES, LOST, SUSPECTS, caseSeed, clueText, culpritOf, type Clue } from '@/lib/game/lost-cargo';
import { hash } from '@/lib/game/missions';
import { t } from '@/i18n/t';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';

/** 1.1.4.2 „Изгубена пратка“: a rare case after a trip (one open at a time). */
export async function maybeLostCase(tx: Tx, userId: string, deliveryId: string, goods: string, now: Date) {
  if ((hash(`lost:${deliveryId}`) % 10_000) / 10_000 >= LOST.chance) return false;
  if (!(await featureFor(tx, userId, 'lost_cargo', now))) return false;
  const [open] = await tx.select({ id: lostCases.id }).from(lostCases).where(and(eq(lostCases.userId, userId), isNull(lostCases.closedAt))).limit(1);
  if (open) return false;
  await tx.insert(lostCases).values({ userId, deliveryId, goods, seed: caseSeed(deliveryId), createdAt: now });
  await notify(tx, userId, 'warning', () => t('🔍 Липсва палет: {0}', goods), () => t('Клиентът не получи един палет. Разгледай уликите и посочи виновника.'), '/game/case');
  return true;
}

export async function caseOf(db: DbOrTx, userId: string) {
  const [row] = await db.select().from(lostCases).where(eq(lostCases.userId, userId)).orderBy(desc(lostCases.createdAt)).limit(1);
  if (!row) return null;
  const clues = row.clues.filter((c): c is Clue => (CLUES as readonly string[]).includes(c)).map((c) => ({ clue: c, ...clueText(row.seed, c) }));
  return { id: row.id, goods: row.goods, clues, accused: row.accused, solved: row.solved, closed: !!row.closedAt, culprit: row.closedAt ? culpritOf(row.seed) : null };
}

export async function lookClue(db: DbOrTx, userId: string, id: string, clue: Clue) {
  if (!(CLUES as readonly string[]).includes(clue)) fail('bad_clue', t('Непозната улика.'));
  const [row] = await db.select().from(lostCases).where(and(eq(lostCases.id, id), eq(lostCases.userId, userId)));
  if (!row || row.closedAt) fail('case_closed', t('Случаят е приключен.'), 409);
  if (!row!.clues.includes(clue)) await db.update(lostCases).set({ clues: sql`array_append(${lostCases.clues}, ${clue})` }).where(eq(lostCases.id, id));
  return clueText(row!.seed, clue);
}

export async function accuse(db: Database, userId: string, id: string, suspect: number, now = new Date()) {
  if (!Number.isInteger(suspect) || suspect < 0 || suspect >= SUSPECTS.length) fail('bad_suspect', t('Непознат заподозрян.'));
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(lostCases).where(and(eq(lostCases.id, id), eq(lostCases.userId, userId))).for('update');
    if (!row || row.closedAt) fail('case_closed', t('Случаят е приключен.'), 409);
    const solved = culpritOf(row!.seed) === suspect;
    const company = await companyForUser(tx, userId);
    if (solved) {
      await post(tx, company.id, [{ category: 'lost_cargo', amountCents: LOST.rewardCents, description: t('Намерена пратка: {0}', row!.goods), idempotencyKey: `lost:${row!.id}` }]);
      await postCoins(tx, userId, { amount: LOST.coins, reason: 'lost_cargo', description: t('Изгубена пратка'), idempotencyKey: `lost-coins:${row!.id}` });
      await tx.insert(userBadges).values({ userId, badge: 'detective', awardedAt: now }).onConflictDoNothing();
    } else {
      await tx.update(companies).set({ reputation: sql`greatest(0, ${companies.reputation} + ${LOST.wrongReputation})` }).where(eq(companies.id, company.id));
    }
    await tx.update(lostCases).set({ accused: SUSPECTS[suspect], solved, closedAt: now }).where(eq(lostCases.id, id));
    return { solved, culprit: culpritOf(row!.seed) };
  });
}
