import { and, count, eq, inArray, isNull, or } from 'drizzle-orm';
import { PREDICTIONS } from '@/lib/game/predictions';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, DbOrTx } from '@/server/db/client';
import { companyBattles, organizations, predictions } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { fail } from './errors';
import { notify } from './notify';
import { t } from '@/i18n/t';

/** This week's battles with the player's picks. */
export async function predictionBoard(db: DbOrTx, userId: string, now = new Date()) {
  const a = alias(organizations, 'a');
  const b = alias(organizations, 'b');
  const rows = await db
    .select({ id: companyBattles.id, weekKey: companyBattles.weekKey, endsAt: companyBattles.endsAt, status: companyBattles.status, winnerId: companyBattles.winnerId, aId: a.id, aName: a.name, aTag: a.tag, bId: b.id, bName: b.name, bTag: b.tag })
    .from(companyBattles)
    .innerJoin(a, eq(a.id, companyBattles.aId))
    .innerJoin(b, eq(b.id, companyBattles.bId))
    .where(eq(companyBattles.status, 'active'))
    .limit(50);
  const mine = rows.length ? await db.select().from(predictions).where(and(eq(predictions.userId, userId), inArray(predictions.battleId, rows.map((r) => r.id)))) : [];
  const used = rows[0] ? (await db.select({ n: count() }).from(predictions).where(and(eq(predictions.userId, userId), eq(predictions.weekKey, rows[0].weekKey))))[0]?.n ?? 0 : 0;
  return {
    left: Math.max(0, PREDICTIONS.perWeek - used),
    battles: rows.map((r) => ({ ...r, open: r.endsAt.getTime() - PREDICTIONS.closeHours * 3_600_000 > now.getTime(), pick: mine.find((p) => p.battleId === r.id)?.pickOrgId ?? null })),
  };
}

/** A free pick: who wins this battle. */
export async function predictBattle(db: Database, userId: string, battleId: string, pickOrgId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'predictions', now))) fail('not_released', t('Това идва със следващото обновление.'), 403);
  return db.transaction(async (tx) => {
    const [battle] = await tx.select().from(companyBattles).where(and(eq(companyBattles.id, battleId), eq(companyBattles.status, 'active')));
    if (!battle) fail('no_battle', t('Битката вече не е активна.'), 404);
    if (pickOrgId !== battle!.aId && pickOrgId !== battle!.bId) fail('bad_pick', t('Избери една от двете компании.'));
    if (battle!.endsAt.getTime() - PREDICTIONS.closeHours * 3_600_000 <= now.getTime()) fail('closed', t('Прогнозите за тази битка са затворени.'));
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(predictions).where(and(eq(predictions.userId, userId), eq(predictions.weekKey, battle!.weekKey)));
    if (n >= PREDICTIONS.perWeek) fail('limit', t('До {0} прогнози на седмица.', PREDICTIONS.perWeek));
    const [row] = await tx.insert(predictions).values({ userId, battleId, pickOrgId, weekKey: battle!.weekKey, createdAt: now }).onConflictDoNothing().returning();
    if (!row) fail('already', t('Вече направи прогноза за тази битка.'), 409);
    return row!;
  });
}

/** Worker: the picks of ended battles — right ones earn ТрансКоин. */
export async function settlePredictions(db: Database) {
  const open = await db
    .select({ p: predictions, status: companyBattles.status, winnerId: companyBattles.winnerId })
    .from(predictions)
    .innerJoin(companyBattles, eq(companyBattles.id, predictions.battleId))
    .where(and(isNull(predictions.correct), or(eq(companyBattles.status, 'done'))))
    .limit(500);
  for (const r of open) {
    const correct = !!r.winnerId && r.winnerId === r.p.pickOrgId;
    await db.transaction(async (tx) => {
      const [mine] = await tx.update(predictions).set({ correct }).where(and(eq(predictions.id, r.p.id), isNull(predictions.correct))).returning();
      if (!mine || !correct) return;
      await postCoins(tx, r.p.userId, { amount: PREDICTIONS.coins, reason: 'event_reward', description: t('Точна прогноза за битка'), idempotencyKey: `prediction:${r.p.id}` });
      await notify(tx, r.p.userId, 'success', () => t('Познал си! 🔮'), () => t('Прогнозата ти за битката беше точна — +{0} TC.', PREDICTIONS.coins), '/game/predictions');
    });
  }
  return open.length;
}
