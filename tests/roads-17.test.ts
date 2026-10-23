import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { ECONOMY } from '@/lib/game/economy';
import { applyDrivingBans, banEndsAt, countryTollCents, LEZ, lezFeeCents, TOLL_VIGNETTE_CENTS } from '@/lib/game/europe-roads';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, vehicles } from '@/server/db/schema';
import { acceptContract } from '@/server/game/deliveries';
import { db, grantLicences, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('the roads of Europe', () => {
  it('weekend bans by local time; back-to-back windows count as one', () => {
    // Sunday 10:00 in Berlin (summer time: UTC+2) — the ban ends at 22:00 local.
    expect(banEndsAt('DE', Date.parse('2027-04-18T08:00:00Z'))).toBe(Date.parse('2027-04-18T20:00:00Z'));
    expect(banEndsAt('DE', Date.parse('2027-04-19T08:00:00Z'))).toBeNull(); // Monday
    // Saturday 23:00 in Switzerland: the night, then the whole Sunday, then the Monday night until 05:00.
    expect(banEndsAt('CH', Date.parse('2027-04-17T21:00:00Z'))).toBe(Date.parse('2027-04-19T03:00:00Z'));
    expect(banEndsAt('BG', Date.parse('2027-04-18T08:00:00Z'))).toBeNull();
  });

  it('the truck waits at the border of a country with a ban; later segments move on', () => {
    const t = Date.parse('2027-04-18T06:00:00Z'); // Sunday 08:00 in Vienna
    const segs = [
      { kind: 'loading', leg: 'loaded', start: t - 3_600_000, end: t, fromKm: 0, toKm: 0 },
      { kind: 'drive', leg: 'loaded', start: t, end: t + 3_600_000, fromKm: 0, toKm: 100 },
      { kind: 'border', leg: 'loaded', start: t + 3_600_000, end: t + 4_200_000, fromKm: 100, toKm: 100 },
      { kind: 'drive', leg: 'loaded', start: t + 4_200_000, end: t + 7_800_000, fromKm: 100, toKm: 200 },
    ];
    // From Slovenia (no ban) into Austria (a ban until 22:00 on Sunday).
    const r = applyDrivingBans(segs, { loaded: { start: 'SI', borders: [{ km: 100, to: 'AT' }] } });
    expect(r.waits.map((w) => w.country)).toEqual(['AT']);
    const last = r.segments.at(-1)!;
    expect(new Date(last.start).toISOString()).toBe('2027-04-18T20:00:00.000Z'); // 22:00 in Vienna
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
});
