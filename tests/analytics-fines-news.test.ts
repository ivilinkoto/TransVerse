import { describe, expect, it } from 'vitest';
import { analyze, type DeliveryRow } from '@/lib/game/analytics';

const row = (o: Partial<DeliveryRow>): DeliveryRow => ({
  id: 'x', completedAt: new Date('2026-10-17T10:00:00Z'), vehicleId: 'v1', driverId: 'd1', coDriverId: null, originCityId: 1, destCityId: 2, cargoType: 'pallets',
  emptyKm: 0, loadedKm: 100, tons: 5, rewardCents: 300_00, payoutCents: 200_00, late: false, fuelLitres: 20, fuelCents: 30_00, ...o,
});

describe('analytics', () => {
  it('totals, groups (a team counts for both drivers) and one row per day', () => {
    const from = new Date('2026-10-12T00:00:00Z');
    const a = analyze([row({}), row({ vehicleId: 'v2', coDriverId: 'd2', payoutCents: -50_00, late: true, destCityId: 3 }), row({ completedAt: new Date('2026-10-15T10:00:00Z') })], from, 7);
    expect(a).toMatchObject({ trips: 3, km: 300, netCents: 350_00, revenueCents: 900_00 });
    expect(a.onTimeShare).toBeCloseTo(2 / 3);
    expect(a.litresPer100).toBeCloseTo(20);
    expect(a.vehicles.map((v) => [v.key, v.netCents])).toEqual([['v1', 400_00], ['v2', -50_00]]);
    expect(a.drivers.find((d) => d.key === 'd2')!.trips).toBe(1);
    expect(a.lanes[0]!.key).toBe('1>2');
    expect(a.daily).toHaveLength(7);
    expect(a.daily.find((d) => d.day === '2026-10-17')!.trips).toBe(2);
  });
});
