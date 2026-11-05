/**
 * 1.2.3 „Съвети за линията“ (feature `lane_tips`): a player who delivered on
 * a lane may leave one short tip for it; others vote it up or down. A tip with
 * a score of −3 or less is hidden. No links, 3–140 characters.
 */
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, contracts, deliveries, laneTipVotes, laneTips, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { fail } from './errors';
import { t } from '@/i18n/t';

export const LANE_TIPS = { minLength: 3, maxLength: 140, hideAt: -3 } as const;
const LINK = /(https?:\/\/|www\.|discord\.gg|\.(com|net|org|bg|ru)\b)/i;

export const laneTipSchema = z.object({ originCityId: z.number().int().positive(), destCityId: z.number().int().positive(), body: z.string().trim().min(LANE_TIPS.minLength).max(LANE_TIPS.maxLength) });

async function requireLive(db: DbOrTx, userId: string) {
  if (!(await featureFor(db, userId, 'lane_tips'))) fail('not_released', t('Това идва със следващото обновление.'), 403);
}

/** Has the player delivered on this lane (own account)? */
export async function droveLane(db: DbOrTx, userId: string, originCityId: number, destCityId: number) {
  const [row] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed'), eq(contracts.originCityId, originCityId), eq(contracts.destCityId, destCityId)))
    .limit(1);
  return !!row;
}

/** The lanes the player has delivered on (for the board: who may write a tip). */
export async function lanesDriven(db: DbOrTx, userId: string) {
  const rows = await db
    .selectDistinct({ o: contracts.originCityId, d: contracts.destCityId })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed')))
    .limit(1000);
  return new Set(rows.map((r) => `${r.o}:${r.d}`));
}

export async function addLaneTip(db: Database, userId: string, input: z.infer<typeof laneTipSchema>) {
  await requireLive(db, userId);
  const body = input.body.replace(/\s+/g, ' ').trim();
  if (LINK.test(body)) fail('no_links', t('Съветите са без линкове.'));
  if (!(await droveLane(db, userId, input.originCityId, input.destCityId))) fail('not_driven', t('Съвет пише само който е карал по тази линия.'), 403);
  const [tip] = await db
    .insert(laneTips)
    .values({ userId, originCityId: input.originCityId, destCityId: input.destCityId, body })
    .onConflictDoUpdate({ target: [laneTips.userId, laneTips.originCityId, laneTips.destCityId], set: { body, score: 0, createdAt: new Date() } })
    .returning();
  // A rewritten tip starts again from zero votes.
  await db.delete(laneTipVotes).where(eq(laneTipVotes.tipId, tip!.id));
  return tip!;
}

export async function voteLaneTip(db: Database, userId: string, tipId: string, value: 1 | -1) {
  await requireLive(db, userId);
  return db.transaction(async (tx) => {
    const [tip] = await tx.select().from(laneTips).where(eq(laneTips.id, tipId)).for('update');
    if (!tip) fail('tip_not_found', t('Съветът не е намерен.'), 404);
    if (tip!.userId === userId) fail('own_tip', t('Не можеш да гласуваш за свой съвет.'));
    const [old] = await tx.select().from(laneTipVotes).where(and(eq(laneTipVotes.tipId, tipId), eq(laneTipVotes.userId, userId)));
    const delta = value - (old?.value ?? 0);
    if (!delta) return tip!.score;
    await tx.insert(laneTipVotes).values({ tipId, userId, value }).onConflictDoUpdate({ target: [laneTipVotes.tipId, laneTipVotes.userId], set: { value } });
    await tx.update(laneTips).set({ score: sql`${laneTips.score} + ${delta}` }).where(eq(laneTips.id, tipId));
    return tip!.score + delta;
  });
}

export async function deleteLaneTip(db: Database, userId: string, tipId: string) {
  const [tip] = await db.select({ userId: laneTips.userId }).from(laneTips).where(eq(laneTips.id, tipId));
  if (!tip) fail('tip_not_found', t('Съветът не е намерен.'), 404);
  const [me] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  if (tip!.userId !== userId && me?.role === 'player') fail('forbidden', t('Можеш да изтриеш само свой съвет.'), 403);
  await db.delete(laneTips).where(eq(laneTips.id, tipId));
}

/** The best tip of each lane (hidden ones left out), for the board. */
export async function bestTips(db: DbOrTx, lanes: { o: number; d: number }[], viewerId: string) {
  if (!lanes.length) return new Map<string, { id: string; body: string; username: string; score: number; mine: boolean }>();
  const origins = [...new Set(lanes.map((l) => l.o))];
  const rows = await db
    .select({ id: laneTips.id, o: laneTips.originCityId, d: laneTips.destCityId, body: laneTips.body, score: laneTips.score, userId: laneTips.userId, username: users.username })
    .from(laneTips)
    .innerJoin(users, eq(users.id, laneTips.userId))
    .where(and(inArray(laneTips.originCityId, origins), gt(laneTips.score, LANE_TIPS.hideAt)))
    .orderBy(desc(laneTips.score), desc(laneTips.createdAt))
    .limit(2000);
  const want = new Set(lanes.map((l) => `${l.o}:${l.d}`));
  const out = new Map<string, { id: string; body: string; username: string; score: number; mine: boolean }>();
  for (const r of rows) {
    const k = `${r.o}:${r.d}`;
    if (want.has(k) && !out.has(k)) out.set(k, { id: r.id, body: r.body, username: r.username, score: r.score, mine: r.userId === viewerId });
  }
  return out;
}
