import { and, asc, eq, lte } from 'drizzle-orm';
import { money } from '@/lib/format';
import { powerUnitModel } from '@/lib/game/catalog';
import { LEASE, payoffCents } from '@/lib/game/leasing';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, drivers, trailers, vehicleLeases, vehicles } from '@/server/db/schema';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { logActivity, notify } from './notify';

export type VehicleLease = typeof vehicleLeases.$inferSelect;

/** A leased truck cannot be sold or listed until it is paid off. */
export async function assertNotLeased(tx: DbOrTx, vehicleId: string) {
  const [l] = await tx.select({ id: vehicleLeases.id }).from(vehicleLeases).where(and(eq(vehicleLeases.vehicleId, vehicleId), eq(vehicleLeases.status, 'active')));
  if (l) fail('leased', 'Камионът е на лизинг — първо изплати лизинга (Финанси → Лизинг).');
}

/** The account's leases, running first. */
export async function leasesOf(db: DbOrTx, companyId: string) {
  const rows = await db
    .select({ lease: vehicleLeases, plate: vehicles.plate, modelId: vehicles.modelId })
    .from(vehicleLeases)
    .innerJoin(vehicles, eq(vehicles.id, vehicleLeases.vehicleId))
    .where(eq(vehicleLeases.companyId, companyId))
    .orderBy(asc(vehicleLeases.status), asc(vehicleLeases.nextDueAt));
  return rows.map((r) => ({ ...r.lease, plate: r.plate, model: powerUnitModel(r.modelId).name, payoffCents: r.lease.status === 'active' ? payoffCents(r.lease) : 0 }));
}

/** Takes the truck back: off its crew and trailer, out of the fleet. */
async function repossess(tx: Tx, lease: VehicleLease, ownerId: string, plate: string, now: Date) {
  await tx.update(trailers).set({ vehicleId: null }).where(eq(trailers.vehicleId, lease.vehicleId));
  await tx.update(drivers).set({ vehicleId: null }).where(eq(drivers.vehicleId, lease.vehicleId));
  await tx.update(drivers).set({ coVehicleId: null }).where(eq(drivers.coVehicleId, lease.vehicleId));
  await tx.update(vehicles).set({ status: 'repossessed', soldAt: now }).where(eq(vehicles.id, lease.vehicleId));
  await tx.update(vehicleLeases).set({ status: 'repossessed', endedAt: now }).where(eq(vehicleLeases.id, lease.id));
  await notify(tx, ownerId, 'warning', `Лизинговата компания взе ${plate}`, `${LEASE.maxMissed} вноски подред не бяха платени. Платеното дотук не се връща.`, '/game/finance#leases');
  await logActivity(tx, ownerId, 'lease_repossessed', { leaseId: lease.id, vehicleId: lease.vehicleId });
}

/**
 * Worker: takes the instalments that are due. One that cannot be paid counts
 * as missed (the player is warned); after LEASE.maxMissed in a row the truck
 * is taken back — when it is not on a trip (otherwise once it arrives).
 */
export async function collectLeases(db: Database, now = new Date()) {
  const due = await db.select({ id: vehicleLeases.id }).from(vehicleLeases).where(and(eq(vehicleLeases.status, 'active'), lte(vehicleLeases.nextDueAt, now))).limit(200);
  let handled = 0;
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [l] = await tx.select().from(vehicleLeases).where(and(eq(vehicleLeases.id, id), eq(vehicleLeases.status, 'active'))).for('update', { skipLocked: true });
      if (!l || l.nextDueAt > now) return;
      const [account] = await tx.select({ ownerId: companies.ownerId, balance: companies.balanceCents }).from(companies).where(eq(companies.id, l.companyId)).for('update');
      const [v] = await tx.select({ plate: vehicles.plate, status: vehicles.status }).from(vehicles).where(eq(vehicles.id, l.vehicleId));
      if (!account || !v) return;
      handled++;
      // Behind on payments: the truck goes back as soon as it is not on a trip.
      if (l.missed >= LEASE.maxMissed) {
        if (v.status === 'idle' || v.status === 'listed') await repossess(tx, l, account.ownerId, v.plate, now);
        return;
      }
      const n = l.paid + l.missed + 1;
      const next = new Date(l.nextDueAt.getTime() + LEASE.periodDays * 86_400_000);
      if (account.balance < l.weeklyCents) {
        const missed = l.missed + 1;
        await tx.update(vehicleLeases).set({ missed, nextDueAt: missed >= LEASE.maxMissed ? now : next }).where(eq(vehicleLeases.id, l.id));
        await notify(tx, account.ownerId, 'warning', `Пропусната лизингова вноска за ${v.plate}`, missed >= LEASE.maxMissed ? `Това е ${missed}-ра пропусната вноска подред — лизинговата компания взема камиона.` : `Нямаше ${money(l.weeklyCents)} в баланса. При още ${LEASE.maxMissed - missed} пропусната вноска камионът се връща на лизинговата компания.`, '/game/finance#leases');
        if (missed >= LEASE.maxMissed && (v.status === 'idle' || v.status === 'listed')) await repossess(tx, { ...l, missed }, account.ownerId, v.plate, now);
        return;
      }
      await post(tx, l.companyId, [{ category: 'lease', amountCents: -l.weeklyCents, description: `Лизингова вноска ${l.paid + 1}/${l.payments} за ${v.plate}`, idempotencyKey: `lease:${l.id}:${n}`, refType: 'vehicle', refId: l.vehicleId }]);
      const paid = l.paid + 1;
      const done = paid >= l.payments;
      await tx.update(vehicleLeases).set({ paid, missed: 0, nextDueAt: next, status: done ? 'paid' : 'active', endedAt: done ? now : null }).where(eq(vehicleLeases.id, l.id));
      if (done) await notify(tx, account.ownerId, 'achievement', `${v.plate} е изцяло твой`, 'Лизингът е изплатен — камионът вече може и да се продава.', '/game/fleet');
    });
  }
  return handled;
}

/** Pays the rest of a lease at once (with half of the interest ahead waived). */
export async function payOffLease(db: Database, userId: string, leaseId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const account = await companyForUser(tx, userId);
    const [l] = await tx.select().from(vehicleLeases).where(and(eq(vehicleLeases.id, leaseId), eq(vehicleLeases.companyId, account.id))).for('update');
    if (!l || l.status !== 'active') fail('lease_not_found', 'Няма такъв лизинг.', 404);
    const [v] = await tx.select({ plate: vehicles.plate, status: vehicles.status }).from(vehicles).where(eq(vehicles.id, l!.vehicleId));
    const amount = payoffCents(l!);
    await post(tx, account.id, [{ category: 'lease', amountCents: -amount, description: `Предсрочно изплащане на лизинга за ${v?.plate ?? ''}`, idempotencyKey: `lease:${l!.id}:payoff`, refType: 'vehicle', refId: l!.vehicleId }], { requireFunds: true });
    await tx.update(vehicleLeases).set({ paid: l!.payments, missed: 0, status: 'paid', endedAt: now }).where(eq(vehicleLeases.id, l!.id));
    await logActivity(tx, userId, 'lease_paid_off', { leaseId: l!.id, amount });
    return amount;
  });
}
