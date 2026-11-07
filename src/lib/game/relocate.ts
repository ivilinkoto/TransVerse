/**
 * 1.2.3.3: a free truck drives empty to any city (for a convoy's start, a
 * cheaper market…). It pays by the distance and arrives after the drive —
 * not in a minute like the way home to a depot.
 */
import { haversineKm, type LatLon } from '@/lib/geo/geometry';

export const RELOCATE = {
  /** Straight line × this ≈ the road. */
  roadFactor: 1.25,
  /** A fixed part (paperwork, the driver) and a price per road km (fuel, tolls, wear). */
  baseCents: 80_00,
  centsPerKm: 85,
  /** Average speed of the empty run (rests included). */
  kmh: 72,
  minMinutes: 10,
  maxHours: 14,
} as const;

/** Distance (road km), price and drive time from one city to another. */
export function relocateQuote(from: LatLon, to: LatLon) {
  const km = Math.round(haversineKm(from, to) * RELOCATE.roadFactor);
  const costCents = RELOCATE.baseCents + Math.round(km * RELOCATE.centsPerKm);
  const minutes = Math.round(Math.min(RELOCATE.maxHours * 60, Math.max(RELOCATE.minMinutes, (km / RELOCATE.kmh) * 60)));
  return { km, costCents, minutes };
}
