import { and, eq, inArray } from 'drizzle-orm';
import { money } from '@/lib/format';
import { marketSalaryCents, MOODS, REQUEST_TEXT, type DriverRequest } from '@/lib/game/moods';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, drivers, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { companyForUser } from './company';
import { fail } from './errors';
import { notify } from './notify';

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Is the driver in a truck that is on a trip now? */
async function driving(db: DbOrTx, d: { vehicleId: string | null; coVehicleId: string | null }) {
  const seats = [d.vehicleId, d.coVehicleId].filter((x): x is string => !!x);
  if (!seats.length) return false;
  const [busy] = await db.select({ id: vehicles.id }).from(vehicles).where(and(inArray(vehicles.id, seats), eq(vehicles.status, 'on_delivery')));
  return !!busy;
}

/**
 * Worker, once a day: loyalty follows the pay, and the drivers ask — for a
 * day off, for a raise, or say they have an offer elsewhere. Answers that
 * did not come in time: a request is dropped; an offer means the driver
 * leaves (no severance).
 */
export async function driverMoods(db: Database, now = new Date(), random = Math.random) {
  const rows = await db.select({ d: drivers, ownerId: companies.ownerId }).from(drivers).innerJoin(companies, eq(companies.id, drivers.companyId)).where(eq(drivers.isOwner, false));
  let asked = 0;
  for (const { d, ownerId } of rows) {
    if (!(await featureFor(db, ownerId, 'driver_moods', now))) continue;
    // An answer that is late.
    if (d.request && d.requestAt && d.requestAt.getTime() + MOODS.answerHours * 3_600_000 <= now.getTime()) {
      if (d.request === 'offer') {
        // On a trip: leaves after it (the next run).
        if (await driving(db, d)) continue;
        await db.delete(drivers).where(eq(drivers.id, d.id));
        await notify(db, ownerId, 'warning', `${d.name} напусна`, 'Прие офертата на друга компания. Наеми нов шофьор от „Шофьори“.', '/game/staff');
        continue;
      }
      await db.update(drivers).set({ request: null, requestAt: null, loyalty: clamp(d.loyalty - 10) }).where(eq(drivers.id, d.id));
      continue;
    }
    const fair = d.salaryCentsPerDay >= marketSalaryCents(d.skill);
    const low = d.salaryCentsPerDay < marketSalaryCents(d.skill) * 0.9;
    const loyalty = clamp(d.loyalty + (fair ? MOODS.fairDaily : 0) - (low ? MOODS.lowDaily : 0));
    let request: DriverRequest | null = d.request as DriverRequest | null;
    if (!request) {
      if (loyalty < MOODS.offerBelow) request = 'offer';
      else if (loyalty < MOODS.raiseBelow && d.skill >= 2) request = 'raise';
      else if ((!d.lastVacationAt || d.lastVacationAt.getTime() + MOODS.vacationEveryDays * 86_400_000 < now.getTime()) && random() < MOODS.vacationChance) request = 'vacation';
    }
    await db.update(drivers).set({ loyalty, ...(request && !d.request ? { request, requestAt: now } : {}) }).where(eq(drivers.id, d.id));
    if (request && !d.request) {
      asked++;
      const body = request === 'raise' ? `Иска +${Math.round(MOODS.raiseShare * 100)} % заплата (${money(Math.round(d.salaryCentsPerDay * (1 + MOODS.raiseShare)))} на ден).` : request === 'offer' ? `Ако не му вдигнеш заплатата с ${Math.round(MOODS.counterShare * 100)} % до ${MOODS.answerHours} часа, ще напусне.` : 'Иска един почивен ден — дотогава няма да кара.';
      await notify(db, ownerId, request === 'offer' ? 'warning' : 'info', `${d.name} ${REQUEST_TEXT[request]}`, body, `/game/staff?driver=${d.id}`);
    }
  }
  return asked;
}

/** The player's answer to a driver's request. */
export async function answerDriver(db: Database, userId: string, driverId: string, accept: boolean, now = new Date()) {
  if (!(await featureFor(db, userId, 'driver_moods', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [d] = await tx.select().from(drivers).where(and(eq(drivers.id, driverId), eq(drivers.companyId, company.id))).for('update');
    if (!d || !d.request) fail('no_request', 'Шофьорът няма искане.', 404);
    const request = d!.request as DriverRequest;
    if (request === 'vacation') {
      await tx.update(drivers).set(accept ? { request: null, requestAt: null, vacationUntil: new Date(now.getTime() + MOODS.vacationHours * 3_600_000), lastVacationAt: now, loyalty: clamp(d!.loyalty + 10) } : { request: null, requestAt: null, lastVacationAt: now, loyalty: clamp(d!.loyalty - 10) }).where(eq(drivers.id, d!.id));
    } else if (request === 'raise') {
      await tx.update(drivers).set(accept ? { request: null, requestAt: null, salaryCentsPerDay: Math.round(d!.salaryCentsPerDay * (1 + MOODS.raiseShare)), loyalty: clamp(d!.loyalty + 20) } : { request: null, requestAt: null, loyalty: clamp(d!.loyalty - 15) }).where(eq(drivers.id, d!.id));
    } else if (accept) {
      await tx.update(drivers).set({ request: null, requestAt: null, salaryCentsPerDay: Math.round(d!.salaryCentsPerDay * (1 + MOODS.counterShare)), loyalty: 60 }).where(eq(drivers.id, d!.id));
    } else {
      if (await driving(tx, d!)) fail('driver_busy', 'Шофьорът е на курс — ще напусне след него, ако не му вдигнеш заплатата.');
      await tx.delete(drivers).where(eq(drivers.id, d!.id));
    }
    return { request, accept };
  });
}

/** Is the driver on a day off now? */
export const onVacation = (d: { vacationUntil: Date | null } | null | undefined, now: Date) => !!d?.vacationUntil && d.vacationUntil > now;
