import { and, eq, isNull } from 'drizzle-orm';
import { SPRING_CUP } from '@/lib/game/tournament';
import type { Database } from '@/server/db/client';
import { plateAuctions, tournamentEntries, tournamentMatches, trailerHires } from '@/server/db/schema';
import { recordAudit } from './admin';
import { postCoins } from './game/coins';
import { companyForUser } from './game/company';
import { fail } from './game/errors';
import { post } from './game/finance';
import { notify } from './game/notify';
import { giveBack } from './game/trailer-hire';
import { t } from '@/i18n/t';

type Staff = { id: string; role: string };

/** Staff stop a plate auction: the leading bid goes back, nobody wins (v1.7). */
export async function adminCancelPlateAuction(db: Database, actor: Staff, weekKey: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(plateAuctions).where(and(eq(plateAuctions.weekKey, weekKey), isNull(plateAuctions.settledAt))).for('update');
    if (!a) fail('not_found', t('Търгът не е намерен или вече е приключил.'), 404);
    if (a!.bidUserId && a!.bidCoins) {
      await postCoins(tx, a!.bidUserId, { amount: a!.bidCoins, reason: 'plate_auction', description: t('Върната оферта: търгът за „{0}“ е спрян', a!.plate), idempotencyKey: `plate-cancel:${a!.weekKey}` });
      await notify(tx, a!.bidUserId, 'info', () => t('Търгът за номер „{0}“ е спрян', a!.plate), () => t('Екипът спря търга. Твоите {0} TC са върнати.', a!.bidCoins), '/game/plates');
    }
    await tx.update(plateAuctions).set({ settledAt: now, bidUserId: null, bidCoins: null }).where(eq(plateAuctions.weekKey, a!.weekKey));
    await recordAudit(tx, actor.id, 'plate_auction_cancel', a!.bidUserId, { weekKey, plate: a!.plate, refunded: a!.bidCoins ?? 0 });
    return { refunded: a!.bidCoins ?? 0 };
  });
}

/** Staff end a trailer hire now: the trailer goes back, the unused days are paid back to the renter by the owner (v1.7). */
export async function adminEndTrailerHire(db: Database, actor: Staff, hireId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [h] = await tx.select().from(trailerHires).where(and(eq(trailerHires.id, hireId), isNull(trailerHires.endedAt))).for('update');
    if (!h) fail('not_found', t('Наемът не е намерен или вече е свършил.'), 404);
    let refund = 0;
    if (h!.renterId && h!.until) {
      const left = Math.max(0, Math.floor((h!.until.getTime() - now.getTime()) / 86_400_000));
      refund = left * h!.pricePerDayCents;
    }
    if (h!.renterId) {
      if (!(await giveBack(tx, h!.id, now))) fail('trailer_busy', t('Ремаркето е на курс — прекрати наема след края му.'));
    } else {
      await tx.update(trailerHires).set({ endedAt: now }).where(eq(trailerHires.id, h!.id));
    }
    if (refund && h!.renterId) {
      const renter = await companyForUser(tx, h!.renterId);
      const owner = await companyForUser(tx, h!.ownerId);
      // Both personal accounts, in a fixed order.
      const steps = [
        { id: owner.id, posting: { category: 'trailer_hire' as const, amountCents: -refund, description: t('Върнат наем за ремарке (решение на екипа)'), idempotencyKey: `trailer-hire:${h!.id}:staff-refund-out`, refType: 'trailer', refId: h!.trailerId } },
        { id: renter.id, posting: { category: 'trailer_hire' as const, amountCents: refund, description: t('Върнат наем за ремарке (решение на екипа)'), idempotencyKey: `trailer-hire:${h!.id}:staff-refund-in`, refType: 'trailer', refId: h!.trailerId } },
      ].sort((a, b) => a.id.localeCompare(b.id));
      for (const s of steps) await post(tx, s.id, [s.posting]);
    }
    await recordAudit(tx, actor.id, 'trailer_hire_end', h!.renterId, { hireId, refund });
    return { refund };
  });
}

/** Staff take a driver off the cup before it starts (v1.7). */
export async function adminRemoveCupEntrant(db: Database, actor: Staff, userId: string) {
  return db.transaction(async (tx) => {
    const [started] = await tx.select({ slot: tournamentMatches.slot }).from(tournamentMatches).where(eq(tournamentMatches.tournament, SPRING_CUP.key)).limit(1);
    if (started) fail('started', t('Купата вече започна.'));
    const [row] = await tx.delete(tournamentEntries).where(and(eq(tournamentEntries.tournament, SPRING_CUP.key), eq(tournamentEntries.userId, userId))).returning();
    if (!row) fail('not_found', t('Шофьорът не е записан.'), 404);
    await notify(tx, userId, 'info', () => t('{0}: записването ти е махнато', SPRING_CUP.title), () => t('Екипът махна записването ти за купата. За въпроси — Поддръжка.'), '/game/support');
    await recordAudit(tx, actor.id, 'cup_remove_entrant', userId, { tournament: SPRING_CUP.key });
    return { removed: true };
  });
}
