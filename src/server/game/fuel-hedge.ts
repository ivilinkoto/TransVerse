import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { fuelLocks } from '@/server/db/schema';
import { DIESEL_CENTS_PER_LITRE, fuelPriceCents } from '@/lib/game/fuel';
import { t } from '@/i18n/t';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';

/**
 * 1.1.4.2 „Пазар на горивото“: litres bought ahead at today's average diesel
 * price. Each delivery in the next 7 days burns them first: the trip's real
 * fuel bill is refunded for those litres, so the saving (or loss) is the
 * difference. Litres left at the end are sold back at that day's price.
 */
export const FUEL_LOCK = { days: 7, minLitres: 500, maxLitres: 30_000, maxOpen: 2 };

/** Today's average diesel price over the game's countries (stotinki a litre). */
export function averageDieselCents(now: Date) {
  const codes = Object.keys(DIESEL_CENTS_PER_LITRE);
  return Math.round(codes.reduce((s, c) => s + fuelPriceCents(c, now), 0) / codes.length);
}

export async function fuelLocksOf(db: DbOrTx, companyId: string, now = new Date()) {
  return db.select().from(fuelLocks).where(and(eq(fuelLocks.companyId, companyId), gt(fuelLocks.endsAt, now))).orderBy(asc(fuelLocks.createdAt));
}

export async function lockFuel(db: Database, userId: string, litres: number, now = new Date()) {
  const l = Math.round(litres);
  if (l < FUEL_LOCK.minLitres || l > FUEL_LOCK.maxLitres) fail('bad_litres', t('Между {0} и {1} литра.', FUEL_LOCK.minLitres, FUEL_LOCK.maxLitres));
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    if ((await fuelLocksOf(tx, company.id, now)).length >= FUEL_LOCK.maxOpen) fail('locks_full', t('Най-много {0} покупки наведнъж.', FUEL_LOCK.maxOpen));
    const price = averageDieselCents(now);
    const [row] = await tx.insert(fuelLocks).values({ companyId: company.id, litres: l, litresLeft: l, priceCents: price, endsAt: new Date(now.getTime() + FUEL_LOCK.days * 86_400_000) }).returning();
    await post(tx, company.id, [{ category: 'fuel_hedge', amountCents: -l * price, description: t('Гориво напред: {0} л по {1} лв.', l, (price / 100).toFixed(2)), idempotencyKey: `fuel-lock:${row!.id}` }], { requireFunds: true });
    return row!;
  });
}

/** After a delivery: the litres come from the bought fuel first; the trip's fuel for them is refunded. */
export async function burnLockedFuel(tx: Tx, companyId: string, deliveryId: string, litres: number, fuelCents: number, now: Date) {
  if (litres <= 0 || fuelCents <= 0) return 0;
  const perLitre = fuelCents / litres;
  let need = litres;
  let refund = 0;
  for (const lock of await fuelLocksOf(tx, companyId, now)) {
    if (need <= 0) break;
    const take = Math.min(need, lock.litresLeft);
    if (take <= 0) continue;
    await tx.update(fuelLocks).set({ litresLeft: sql`${fuelLocks.litresLeft} - ${take}` }).where(eq(fuelLocks.id, lock.id));
    refund += take * perLitre;
    need -= take;
  }
  const cents = Math.round(refund);
  if (cents) await post(tx, companyId, [{ category: 'fuel_hedge', amountCents: cents, description: t('Гориво от купеното напред ({0} л)', Math.round(litres - need)), idempotencyKey: `delivery:${deliveryId}:fuel-lock` }]);
  return cents;
}

/** Worker: the litres left at the end are sold back at the day's price. */
export async function closeFuelLocks(db: Database, now = new Date()) {
  const due = await db.select().from(fuelLocks).where(and(lte(fuelLocks.endsAt, now), gt(fuelLocks.litresLeft, 0)));
  const price = averageDieselCents(now);
  for (const lock of due) {
    await db.transaction(async (tx) => {
      const cents = Math.round(lock.litresLeft * price);
      await post(tx, lock.companyId, [{ category: 'fuel_hedge', amountCents: cents, description: t('Непохарчено гориво: {0} л обратно по {1} лв.', Math.round(lock.litresLeft), (price / 100).toFixed(2)), idempotencyKey: `fuel-lock-end:${lock.id}` }]);
      await tx.update(fuelLocks).set({ litresLeft: 0 }).where(eq(fuelLocks.id, lock.id));
    });
  }
  return due.length;
}
