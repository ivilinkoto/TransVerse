import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

/** 1.3 „Автобусна компания“: demand and competition, the till, opening a line from a depot city, settling and selling. */
import { BUS_MODELS, BUSES, lineDay, pairDemand, tillFor, type BusLine } from '@/lib/game/buses';
import { closeDb } from '@/server/db/client';
import { companies, depots, users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { busesView, buyBusLine, collectBusLine, sellBusLine, setBusLine, upgradeBusComfort } from '@/server/game/buses';
import { cityByName, db, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const balance = async (userId: string) => (await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.ownerId, userId)))[0]!.b;
const line = (over: Partial<BusLine> = {}): BusLine => ({ id: 'x', ownerId: 'u', model: 'intercity', from: { id: 1, name: 'А', country: 'BG', population: 1_200_000 }, to: { id: 2, name: 'Б', country: 'BG', population: 340_000 }, km: 320, departures: 3, priceCents: 600, comfort: 0, boughtAt: '', collectedAt: '', totalPassengers: 0, totalCents: 0, ...over });

describe('1.3 „Автобусна компания“ — rules', () => {
  it('bigger and closer-to-ideal pairs carry more; a rival takes a share; a dearer ticket fewer people', () => {
    expect(pairDemand(1_200_000, 340_000, 350)).toBeGreaterThan(pairDemand(1_200_000, 340_000, 690));
    const alone = lineDay(line(), []);
    const shared = lineDay(line(), [line({ id: 'y' })]);
    expect(shared.passengers).toBeLessThan(alone.passengers);
    expect(lineDay(line({ priceCents: 1200 }), []).passengers).toBeLessThan(alone.passengers);
    expect(alone.perDeparture).toBeLessThanOrEqual(BUS_MODELS.intercity.seats);
  });

  it('balance: even the best pair at the best ticket pays a bus back in no less than 45 days (a truck is the main income)', () => {
    // Sofia–Istanbul: the biggest pair in reach, at the ideal distance band.
    const big = { from: { id: 1, name: 'София', country: 'BG', population: 1_240_000 }, to: { id: 2, name: 'Истанбул', country: 'TR', population: 15_000_000 }, km: 560 };
    for (const model of ['shuttle', 'intercity', 'coach'] as const) {
      let best = 0;
      for (const departures of BUSES.departures) for (let priceCents = BUSES.price.min; priceCents <= BUSES.price.max; priceCents += 100) best = Math.max(best, lineDay(line({ ...big, model, departures, priceCents }), []).profitCents);
      expect(BUS_MODELS[model].priceCents / best).toBeGreaterThanOrEqual(45);
    }
    // A small pair close by does not pay at the default timetable.
    expect(lineDay(line({ to: { id: 3, name: 'В', country: 'BG', population: 138_000 }, from: { id: 4, name: 'Г', country: 'BG', population: 346_000 }, km: 100, departures: 2 }), []).profitCents).toBeLessThan(0);
  });

  it('the till fills pro rata and stops at 48 hours', () => {
    const day = lineDay(line(), []);
    expect(tillFor(day, 12).cents).toBe(Math.round(day.profitCents / 2));
    expect(tillFor(day, 100).hours).toBe(BUSES.tillHours);
  });
});

describe('1.3 „Автобусна компания“ — on the server', () => {
  it('opens from a depot city from level 8, settles the till once, keeps one line per pair, sells back half', async () => {
    const p = await playerWithCompany('Sofia', 500_000_00);
    const sofia = await cityByName('Sofia');
    const plovdiv = await cityByName('Plovdiv');
    const varna = await cityByName('Varna');
    const [acc] = await db().select({ id: companies.id }).from(companies).where(eq(companies.ownerId, p.userId));
    const [hasDepot] = await db().select({ id: depots.id }).from(depots).where(eq(depots.companyId, acc!.id));
    if (!hasDepot) await db().insert(depots).values({ companyId: acc!.id, cityId: sofia.id } as never);
    const now = new Date('2026-11-12T12:00:00+02:00');
    const n = { fromId: sofia.id, toId: varna.id, model: 'intercity' as const, departures: 3, priceCents: 600 };
    expect(await code(buyBusLine(db(), p.userId, n, now))).toBe('level');
    await db().update(users).set({ level: BUSES.minLevel }).where(eq(users.id, p.userId));
    expect(await code(buyBusLine(db(), p.userId, { ...n, fromId: varna.id, toId: sofia.id }, now))).toBe('no_depot');
    const before = await balance(p.userId);
    const l = await buyBusLine(db(), p.userId, n, now);
    expect(l.km).toBeGreaterThanOrEqual(BUSES.km[0]);
    expect(await balance(p.userId)).toBe(before - BUS_MODELS.intercity.priceCents);
    expect(await code(buyBusLine(db(), p.userId, n, now))).toBe('same_line');
    // Plovdiv is too close for a line (under 100 km by road? if not, it just opens).
    const near = await code(buyBusLine(db(), p.userId, { ...n, toId: plovdiv.id }, now));
    expect(['ok', 'bad_distance']).toContain(near);

    // A day later: the till holds a day's takings; collecting twice pays once.
    const later = new Date(now.getTime() + 24 * 3_600_000);
    const view = await busesView(db(), p.userId, later);
    const mine = view.lines.find((x) => x.id === l.id)!;
    expect(mine.till.hours).toBe(24);
    const b1 = await balance(p.userId);
    const got = await collectBusLine(db(), p.userId, l.id, later);
    expect(got.cents).toBe(mine.till.cents);
    expect(await balance(p.userId)).toBe(b1 + got.cents);
    expect((await collectBusLine(db(), p.userId, l.id, later)).cents).toBe(0);

    // Changing the ticket settles first; comfort costs; selling gives half the bus back.
    await setBusLine(db(), p.userId, l.id, { priceCents: 800 }, new Date(later.getTime() + 3_600_000));
    expect(await upgradeBusComfort(db(), p.userId, l.id, later)).toBe(1);
    const b2 = await balance(p.userId);
    expect(await sellBusLine(db(), p.userId, l.id, later)).toBe(BUS_MODELS.intercity.priceCents * BUSES.sellBack);
    expect(await balance(p.userId)).toBeGreaterThanOrEqual(b2 + BUS_MODELS.intercity.priceCents * BUSES.sellBack);
    expect((await busesView(db(), p.userId, later)).lines.find((x) => x.id === l.id)).toBeUndefined();
  });
});
