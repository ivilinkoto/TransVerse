import { and, desc, eq, lte } from 'drizzle-orm';
import { FINE_RULES, INSURANCE, insurancePriceCents, VIOLATION_LABELS, type Violation } from '@/lib/game/fines';
import { powerUnitModel, trailerModel } from '@/lib/game/catalog';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { fines, trailers, vehicles } from '@/server/db/schema';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';

const eur = (cents: number) => `${Math.round(cents / 100).toLocaleString('bg-BG')} €`;

/** A roadside check found a risk the player took: the fine waits to be paid or appealed (once per delivery and violation). */
export async function issueFine(tx: Tx, f: { companyId: string; userId: string; deliveryId: string; violation: Violation; amountCents: number; at: Date }) {
  const rows = await tx
    .insert(fines)
    .values({ companyId: f.companyId, userId: f.userId, deliveryId: f.deliveryId, violation: f.violation, amountCents: f.amountCents, dueAt: new Date(f.at.getTime() + FINE_RULES.dueHours * 3_600_000) })
    .onConflictDoNothing()
    .returning({ id: fines.id });
  if (!rows.length) return;
  await notify(tx, f.userId, 'warning', `Глоба: ${VIOLATION_LABELS[f.violation].toLowerCase()}`, `Пътна полиция те спря: ${eur(f.amountCents)}. Плати или обжалвай до ${FINE_RULES.dueHours} часа — после се удържа автоматично с ${Math.round(FINE_RULES.latePayShare * 100)}% надбавка.`, '/game/finance#fines');
}

async function ownFine(tx: Tx, userId: string, fineId: string) {
  const company = await companyForUser(tx, userId);
  const [f] = await tx.select().from(fines).where(and(eq(fines.id, fineId), eq(fines.companyId, company.id))).for('update');
  if (!f) fail('fine_not_found', 'Глобата не е намерена.', 404);
  if (f!.status !== 'unpaid') fail('fine_closed', 'Глобата вече е приключена.', 409);
  return f!;
}

export async function payFine(db: Database, userId: string, fineId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const f = await ownFine(tx, userId, fineId);
    await post(tx, f.companyId, [{ category: 'fines', amountCents: -f.amountCents, description: `Глоба: ${VIOLATION_LABELS[f.violation as Violation].toLowerCase()}`, idempotencyKey: `fine:${f.id}`, refType: 'fine', refId: f.id }], { requireFunds: true });
    await tx.update(fines).set({ status: 'paid', resolvedAt: now }).where(eq(fines.id, f.id));
  });
}

/** One appeal per fine: dropped, or the fine grows by the court costs. `roll` is for tests. */
export async function appealFine(db: Database, userId: string, fineId: string, now = new Date(), roll = Math.random()) {
  return db.transaction(async (tx) => {
    const f = await ownFine(tx, userId, fineId);
    if (f.appealed) fail('already_appealed', 'Глобата вече е обжалвана.', 409);
    if (roll < FINE_RULES.appealWinChance) {
      await tx.update(fines).set({ status: 'dropped', appealed: true, resolvedAt: now, note: 'Отменена след обжалване.' }).where(eq(fines.id, f.id));
      return { won: true, amountCents: 0 };
    }
    const amount = Math.round(f.amountCents * (1 + FINE_RULES.appealLossShare));
    await tx.update(fines).set({ appealed: true, amountCents: amount, note: `Жалбата е отхвърлена: +${Math.round(FINE_RULES.appealLossShare * 100)}% разноски.` }).where(eq(fines.id, f.id));
    return { won: false, amountCents: amount };
  });
}

/** Worker: fines past their deadline are taken with the surcharge (the balance may go negative). */
export async function collectOverdueFines(db: Database, now = new Date()): Promise<number> {
  const due = await db.select().from(fines).where(and(eq(fines.status, 'unpaid'), lte(fines.dueAt, now))).limit(200);
  let n = 0;
  for (const f of due) {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(fines).where(and(eq(fines.id, f.id), eq(fines.status, 'unpaid'))).for('update', { skipLocked: true });
      if (!row) return;
      const amount = Math.round(row.amountCents * (1 + FINE_RULES.latePayShare));
      await post(tx, row.companyId, [{ category: 'fines', amountCents: -amount, description: `Неплатена глоба (+${Math.round(FINE_RULES.latePayShare * 100)}%): ${VIOLATION_LABELS[row.violation as Violation].toLowerCase()}`, idempotencyKey: `fine:${row.id}`, refType: 'fine', refId: row.id }]);
      await tx.update(fines).set({ status: 'auto_paid', amountCents: amount, resolvedAt: now }).where(eq(fines.id, row.id));
      await notify(tx, row.userId, 'warning', 'Неплатена глоба е удържана', `${eur(amount)} с надбавка за закъснение.`, '/game/finance#fines');
      n++;
    });
  }
  return n;
}

export async function finesOf(db: DbOrTx, companyId: string, limit = 20) {
  return db.select().from(fines).where(eq(fines.companyId, companyId)).orderBy(desc(fines.createdAt)).limit(limit);
}

/** Insures a vehicle (and its trailer) for 30 more days. */
export async function buyInsurance(db: Database, userId: string, vehicleId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, company.id))).for('update');
    if (!v || v.soldAt) fail('vehicle_not_found', 'Превозното средство не е намерено.', 404);
    if (v!.ownership === 'rented') fail('rented', 'Наетите камиони са застраховани от наемодателя.');
    const price = await insuranceQuote(tx, v!);
    const from = v!.insuredUntil && v!.insuredUntil > now ? v!.insuredUntil : now;
    const until = new Date(from.getTime() + INSURANCE.days * 86_400_000);
    if (until.getTime() - now.getTime() > 3 * INSURANCE.days * 86_400_000) fail('too_far', 'Застраховката може да се плати най-много 90 дни напред.');
    await post(tx, company.id, [{ category: 'insurance', amountCents: -price, description: `Застраховка ${v!.plate} до ${until.toLocaleDateString('bg-BG', { timeZone: 'Europe/Sofia' })}`, idempotencyKey: `insurance:${v!.id}:${until.toISOString()}`, refType: 'vehicle', refId: v!.id }], { requireFunds: true });
    await tx.update(vehicles).set({ insuredUntil: until }).where(eq(vehicles.id, v!.id));
    return { until, price };
  });
}

/** Insurance price of a vehicle with its coupled trailer. */
export async function insuranceQuote(db: DbOrTx, v: { id: string; modelId: string }) {
  const [t] = await db.select({ modelId: trailers.modelId }).from(trailers).where(eq(trailers.vehicleId, v.id));
  return insurancePriceCents(powerUnitModel(v.modelId).priceCents + (t ? trailerModel(t.modelId).priceCents : 0));
}
