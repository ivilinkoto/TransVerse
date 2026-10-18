import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { canCouple, combinationCapability, couplingError, powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { clientBonusCents, clientFailReputation, clientTerms } from '@/lib/game/clients';
import { CREW_RULES, crewEffects, dutyAt, restLeftMin, traitPointsLeft } from '@/lib/game/crew';
import { buildGameTrip, planTrip, scheduleEnd } from '@/lib/game/schedule';
import { closeDb } from '@/server/db/client';
import { clientContracts, companies, contracts, deliveries, driverCandidates, drivers, ledgerEntries, vehicles } from '@/server/db/schema';
import { acceptClientContract, clientOffers, declineClientContract, sendClientLoad, settleClientContracts } from '@/server/game/clients';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyTrailer, buyVehicle, coupleTrailer } from '@/server/game/fleet';
import { assignDriver, hireDriver, trainDriver } from '@/server/game/staff';
import { cityByName, db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const leg = (km: number) => ({ km, durationS: (km / 70) * 3600, borderKms: [] });

describe('crew rules', () => {
  it('a tired driver rests early, a team drives on; game time follows', () => {
    const base = { startAt: 0, empty: null, loaded: leg(700), speedFactor: 1, timeScale: 1 };
    const fresh = planTrip(base);
    const tired = planTrip({ ...base, crew: { startDutyMin: 480, team: false, extraDailyMin: 0 } });
    const team = planTrip({ ...base, crew: { startDutyMin: 0, team: true, extraDailyMin: 0 } });
    // 700 km = 10 h at the wheel: one rest when rested, a rest after one hour when tired.
    expect(fresh.segments.filter((s) => s.kind === 'rest')).toHaveLength(1);
    const firstRest = (t: typeof fresh) => t.segments.find((s) => s.kind === 'rest')!.fromKm;
    expect(firstRest(tired)).toBeLessThan(firstRest(fresh) / 3);
    expect(team.segments.some((s) => s.kind === 'rest' || s.kind === 'break')).toBe(false);
    expect(team.endDutyMin).toBeCloseTo(600, 0);
    // Game minutes: a tired driver makes a 300 km trip longer, a team makes the 700 km one shorter.
    const game = (km: number, crew?: Parameters<typeof planTrip>[0]['crew']) => {
      const t = buildGameTrip({ ...base, loaded: leg(km), crew });
      return scheduleEnd(t.segments) - t.segments[0]!.start;
    };
    expect(game(300, { startDutyMin: 480, team: false, extraDailyMin: 0 })).toBeGreaterThan(game(300));
    expect(game(700, { startDutyMin: 0, team: true, extraDailyMin: 0 })).toBeLessThan(game(700));
    expect(game(300, { startDutyMin: 0, team: false, extraDailyMin: 0 })).toBe(game(300));
  });

  it('rest, skill points and the crew effects', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const d = { dutyMin: 300, restedAt: new Date(now.getTime() + 5 * 60_000), traits: { eco: 2, long: 1 } };
    expect(dutyAt(d, now)).toBe(300);
    expect(restLeftMin(d, now)).toBe(5);
    expect(dutyAt(d, new Date(now.getTime() + 6 * 60_000))).toBe(0);
    expect(traitPointsLeft(4, d.traits)).toBe(0);
    expect(traitPointsLeft(5, d.traits)).toBe(1);
    const co = { dutyMin: 0, restedAt: null, traits: { safe: 1, long: 2 } };
    const fx = crewEffects(d, co, now);
    expect(fx).toMatchObject({ startDutyMin: 300, team: true, extraDailyMin: 3 * CREW_RULES.longBonusMin });
    expect(fx.fuel).toBeCloseTo(0.94);
    expect(fx.eventChance).toBeCloseTo(0.8);
  });
});

describe('trailers', () => {
  it('drawbar trailers go behind rigid trucks of the same body and add their payload', () => {
    const rigid = powerUnitModel('hemus-r12-box');
    const frigo = powerUnitModel('hemus-r12-frigo');
    const tractor = powerUnitModel('danubia-t440');
    expect(canCouple(rigid, trailerModel('drawbar-box'))).toBe(true);
    expect(couplingError(frigo, trailerModel('drawbar-box'))).toContain('същата надстройка');
    expect(couplingError(rigid, trailerModel('curtain-13'))).toContain('влекач');
    expect(couplingError(tractor, trailerModel('drawbar-box'))).toContain('соло камиони');
    expect(combinationCapability({ unit: rigid, trailer: trailerModel('drawbar-box') })).toEqual({ bodies: ['box'], payloadTons: 17.5 });
    expect(combinationCapability({ unit: tractor, trailer: trailerModel('flatbed-13') }).bodies).toEqual(['flatbed']);
  });

  it('a rigid truck with a drawbar trailer takes a load too heavy for it alone; a car carrier hauls cars', async () => {
    const { userId, hq } = await playerWithCompany();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, userId));
    await db().update(companies).set({ balanceCents: 1_000_000_00 }).where(eq(companies.id, account!.id));
    await db().execute(sql`update users set level = 5, xp = 99999 where id = ${userId}`);
    const rigid = await buyVehicle(db(), userId, 'hemus-r12-box', hq.id);
    const drawbar = await buyTrailer(db(), userId, 'drawbar-box', hq.id);
    const [self] = await db().select().from(drivers).where(and(eq(drivers.companyId, account!.id), eq(drivers.isOwner, true)));
    await assignDriver(db(), userId, self!.id, rigid.id);
    const heavy = await makeContract('Sofia', 'Plovdiv', { weightTons: 15 });
    expect(await code(acceptContract(db(), userId, heavy.id, rigid.id))).toBe('incompatible');
    await coupleTrailer(db(), userId, rigid.id, drawbar.id);
    expect((await acceptContract(db(), userId, heavy.id, rigid.id)).status).toBe('in_progress');

    const tractor = await buyVehicle(db(), userId, 'danubia-t440', hq.id);
    const carrier = await buyTrailer(db(), userId, 'car-carrier', hq.id);
    expect(await code(coupleTrailer(db(), userId, rigid.id, carrier.id))).toBe('vehicle_busy');
    await coupleTrailer(db(), userId, tractor.id, carrier.id);
    const cars = await makeContract('Sofia', 'Varna', { cargoType: 'vehicles', weightTons: 12, goods: 'Нови леки автомобили', minLevel: 4 });
    const pool = await db().insert(driverCandidates).values({ companyId: account!.id, name: 'Тест Шофьор', skill: 2, salaryCentsPerDay: 100_00, expiresAt: new Date(Date.now() + 3_600_000) }).returning();
    const hired = await hireDriver(db(), userId, pool[0]!.id);
    await assignDriver(db(), userId, hired.id, tractor.id);
    expect((await acceptContract(db(), userId, cars.id, tractor.id)).status).toBe('in_progress');
  });
});

describe('drivers', () => {
  it('a team shares the hours of a trip; the hours carry over to the next one until the driver has rested', async () => {
    const { userId, hq } = await playerWithCompany();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, userId));
    await db().update(companies).set({ balanceCents: 1_000_000_00 }).where(eq(companies.id, account!.id));
    const truck = await buyVehicle(db(), userId, 'hemus-r12-box', hq.id);
    const pool = await db()
      .insert(driverCandidates)
      .values([1, 3].map((skill, i) => ({ companyId: account!.id, name: `Шофьор ${i}`, skill, salaryCentsPerDay: 100_00, expiresAt: new Date(Date.now() + 3_600_000) })))
      .returning();
    const a = await hireDriver(db(), userId, pool[0]!.id);
    const b = await hireDriver(db(), userId, pool[1]!.id);
    await assignDriver(db(), userId, a.id, truck.id);
    await assignDriver(db(), userId, b.id, truck.id, 'co');

    // Skill points: one per skill level above the first.
    expect(await code(trainDriver(db(), userId, a.id, 'eco'))).toBe('no_points');
    await trainDriver(db(), userId, b.id, 'long');
    await trainDriver(db(), userId, b.id, 'long');
    expect(await code(trainDriver(db(), userId, b.id, 'eco'))).toBe('no_points');

    const job = await makeContract('Sofia', 'Varna');
    const d = await acceptContract(db(), userId, job.id, truck.id);
    expect(d.coDriverId).toBe(b.id);
    expect(d.endDutyMin).toBeGreaterThan(0);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account!.id);
    const crew = await db().select().from(drivers).where(sql`${drivers.id} in (${a.id}, ${b.id})`);
    for (const x of crew) {
      expect(x.dutyMin).toBeCloseTo(d.endDutyMin / 2, 3);
      expect(x.restedAt!.getTime()).toBe(d.etaAt.getTime() + CREW_RULES.restGameMin * 60_000);
    }

    // Solo again right away: the hours count, the same trip takes longer than with a rested driver.
    await assignDriver(db(), userId, b.id, null);
    await db().update(drivers).set({ dutyMin: 500, restedAt: new Date(Date.now() + 3_600_000) }).where(eq(drivers.id, a.id));
    const back = await makeContract('Varna', 'Sofia');
    const tired = await acceptContract(db(), userId, back.id, truck.id);
    const [fresh] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(tired.coDriverId).toBeNull();
    expect(tired.schedule as unknown[]).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'rest' })]));
    expect(tired.etaAt.getTime() - tired.startedAt.getTime()).toBeGreaterThan(fresh!.etaAt.getTime() - fresh!.startedAt.getTime());
  });
});

describe('client contracts', () => {
  it('terms: better pay per load, a bonus that late loads reduce, reputation at stake', () => {
    const t = clientTerms('pallets', 10, 400, 6);
    expect(t.minReputation).toBe(20);
    expect(t.durationHours).toBe(60);
    expect(t.bonusCents).toBeGreaterThan(0);
    expect(clientBonusCents(1_000_00, 4, 1)).toBe(750_00);
    expect(clientFailReputation(5, 2)).toBe(7);
  });

  it('offers, accept, haul every load, bonus; a missed deadline costs reputation', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const offers = await clientOffers(db(), p.userId);
    expect(offers.length).toBeGreaterThan(0);
    expect(await clientOffers(db(), p.userId)).toHaveLength(offers.length); // no re-roll
    for (const o of offers) expect(o.cargoType).toBe('pallets'); // the rented rigid carries pallets
    await declineClientContract(db(), p.userId, offers[0]!.id);
    expect((await clientOffers(db(), p.userId)).map((o) => o.id)).not.toContain(offers[0]!.id);

    // A small contract made to measure, so the test does not depend on the random offer.
    const sofia = await cityByName('Sofia');
    const [route] = await db().select({ id: contracts.routeId, km: contracts.distanceKm }).from(contracts).where(eq(contracts.id, (await makeContract('Sofia', 'Plovdiv')).id));
    const plovdiv = await cityByName('Plovdiv');
    const [cc] = await db()
      .insert(clientContracts)
      .values({ companyId: account!.id, client: 'Тест Клиент ООД', cargoType: 'pallets', goods: 'Мебели', originCityId: sofia.id, destCityId: plovdiv.id, routeId: route!.id, distanceKm: route!.km, tonsPerLoad: 2, loadsTotal: 2, rewardPerLoadCents: 600_00, bonusCents: 300_00, minReputation: 30, durationHours: 36, offerExpiresAt: new Date(Date.now() + 3_600_000) })
      .returning();
    expect(await code(acceptClientContract(db(), p.userId, cc!.id))).toBe('reputation_required');
    await db().update(companies).set({ reputation: 35 }).where(eq(companies.id, account!.id));
    await acceptClientContract(db(), p.userId, cc!.id);

    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const first = await sendClientLoad(db(), p.userId, cc!.id, truck!.id);
    await settleDueDeliveries(db(), new Date(first.etaAt.getTime() + 1000), account!.id);
    // The truck is now in Plovdiv: it drives back empty to Sofia for the second load.
    const second = await sendClientLoad(db(), p.userId, cc!.id, truck!.id);
    expect(second.emptyKm).toBeGreaterThan(0);
    expect(await code(sendClientLoad(db(), p.userId, cc!.id, truck!.id))).toBe('all_loads_sent');
    await settleDueDeliveries(db(), new Date(second.etaAt.getTime() + 1000), account!.id);
    const [done] = await db().select().from(clientContracts).where(eq(clientContracts.id, cc!.id));
    expect(done).toMatchObject({ status: 'completed', loadsDone: 2, loadsLate: 0 });
    const bonus = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, account!.id), eq(ledgerEntries.category, 'client_bonus')));
    expect(bonus.map((b) => b.amountCents)).toEqual([300_00]);

    // Missed deadline.
    const [late] = await db()
      .insert(clientContracts)
      .values({ companyId: account!.id, client: 'Бавен Клиент ЕООД', cargoType: 'pallets', goods: 'Мебели', originCityId: sofia.id, destCityId: plovdiv.id, routeId: route!.id, distanceKm: route!.km, tonsPerLoad: 2, loadsTotal: 3, rewardPerLoadCents: 600_00, bonusCents: 300_00, durationHours: 36, offerExpiresAt: new Date(Date.now() + 3_600_000) })
      .returning();
    await acceptClientContract(db(), p.userId, late!.id);
    await db().update(clientContracts).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(clientContracts.id, late!.id));
    const [before] = await db().select({ r: companies.reputation }).from(companies).where(eq(companies.id, account!.id));
    expect(await settleClientContracts(db())).toBeGreaterThanOrEqual(1);
    const [after] = await db().select({ r: companies.reputation }).from(companies).where(eq(companies.id, account!.id));
    expect(before!.r - after!.r).toBeCloseTo(clientFailReputation(3, 0), 5);
    expect((await db().select().from(clientContracts).where(eq(clientContracts.id, late!.id)))[0]!.status).toBe('failed');
  });
});
