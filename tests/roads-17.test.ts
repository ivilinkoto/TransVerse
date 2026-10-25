import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { ECONOMY } from '@/lib/game/economy';
import { countryTollCents, LEZ, lezFeeCents, TOLL_VIGNETTE_CENTS, withoutBanWaits } from '@/lib/game/europe-roads';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, vehicles } from '@/server/db/schema';
import { acceptContract, dropDrivingBanWaits } from '@/server/game/deliveries';
import { db, grantLicences, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('the roads of Europe', () => {
  it('October 2026: a trip under way drops what is left of a weekend-ban wait and arrives earlier', () => {
    const t = Date.parse('2027-04-18T06:00:00Z');
    const h = 3_600_000;
    const segs = [
      { kind: 'drive', leg: 'loaded', start: t, end: t + h, fromKm: 0, toKm: 100 },
      { kind: 'border', leg: 'loaded', start: t + h, end: t + 1.2 * h, fromKm: 100, toKm: 100 },
      { kind: 'incident', leg: 'loaded', start: t + 1.2 * h, end: t + 14 * h, fromKm: 100, toKm: 100, note: 'Забрана за движение (AT) до 22:00' },
      { kind: 'drive', leg: 'loaded', start: t + 14 * h, end: t + 15 * h, fromKm: 100, toKm: 200 },
    ];
    // Two hours into the wait: those two hours stay, the rest goes.
    const now = t + 3.2 * h;
    const r = withoutBanWaits(segs, now);
    expect(r.savedMs).toBe(10.8 * h);
    expect(r.segments.map((x) => x.kind)).toEqual(['drive', 'border', 'incident', 'drive']);
    expect(r.segments[2]!.end).toBe(now);
    expect(r.segments.at(-1)!.end).toBe(now + h);
    // Before the wait: all of it goes. No wait: nothing changes.
    expect(withoutBanWaits(segs, t).segments.map((x) => x.kind)).toEqual(['drive', 'border', 'drive']);
    expect(withoutBanWaits(segs.filter((x) => x.kind !== 'incident'), t).savedMs).toBe(0);
  });

  it('tolls by country: per km at each country level, a vignette once; low-emission zones', () => {
    const base = ECONOMY.tollCentsPerKm;
    expect(countryTollCents('DE', 100, [], base)).toBe(Math.round(100 * base * 1.6));
    expect(countryTollCents('RO', 300, [], base)).toBe(TOLL_VIGNETTE_CENTS.RO);
    expect(countryTollCents('AT', 200, [{ km: 100, to: 'CH' }], base)).toBe(Math.round(100 * base * 2 + 100 * base * 2.6));
    expect(lezFeeCents([2988507, 3173435], { electric: false, van: false })).toBe(2 * LEZ.feeCents);
    expect(lezFeeCents([2988507], { electric: true, van: false })).toBe(0);
    expect(lezFeeCents([2988507], { electric: false, van: true })).toBe(LEZ.feeCents * LEZ.vanShare);
  });

  it('a trip to Paris pays the zone fee and the tolls of each country', async () => {
    const p = await newPlayer();
    await grantLicences(p.userId, 'international', 'customs');
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, truck!.id));
    const c = await makeContract('Sofia', 'Paris', { windowMinutes: 10 * 24 * 60 });
    const d = await acceptContract(db(), p.userId, c.id, truck!.id);
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    const costs = row!.estimatedCosts as { lezCents: number; tollCents: number };
    expect(costs.lezCents).toBe(LEZ.feeCents);
    expect(costs.tollCents).toBeGreaterThan(0);
  });

  it('October 2026: new trips have no ban wait; a trip that has one loses it on the next run', async () => {
    const p = await newPlayer('Sofia');
    await grantLicences(p.userId, 'international', 'customs');
    const c = await makeContract('Sofia', 'Munich', { windowMinutes: 5 * 24 * 60 });
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    const d = await acceptContract(db(), p.userId, c.id, truck!.id);
    const segs = d.schedule as { kind: string; note?: string; start: number; end: number }[];
    expect(segs.some((x) => x.note?.startsWith('Забрана за движение'))).toBe(false);
    // As a trip accepted before October 2026: a 10-hour wait before the last segment.
    const wait = 10 * 3_600_000;
    const last = segs.at(-1)!;
    const withWait = [...segs.slice(0, -1).map((x) => x), { ...last, kind: 'incident', end: last.start + wait, note: 'Забрана за движение (DE) до 22:00' }, { ...last, start: last.start + wait, end: last.end + wait }];
    await db().update(deliveries).set({ schedule: withWait, etaAt: new Date(last.end + wait) }).where(eq(deliveries.id, d.id));
    expect(await dropDrivingBanWaits(db(), new Date(segs[0]!.start))).toBeGreaterThanOrEqual(1);
    const [after] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(Math.abs(after!.etaAt.getTime() - last.end)).toBeLessThan(2);
    expect(await dropDrivingBanWaits(db(), new Date(segs[0]!.start))).toBe(0);
  });
});
