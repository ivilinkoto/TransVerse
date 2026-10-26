import type { CargoType } from './cargo';
import { seededRandom } from './road-events';
import { seasonalFactor } from './seasonality';

/**
 * Trading: players buy goods where they are produced, keep them in the
 * warehouse of their depot and haul them themselves to sell where they are
 * consumed. All prices are game data. They depend on the country (goods are
 * cheaper in Bulgaria than in Germany), on the market's demand and move a
 * little every day, so time and place both matter.
 */
export const TRADE_BASE_CENTS_PER_TON: Record<CargoType, number> = {
  pallets: 450_00,
  refrigerated: 600_00,
  bulk: 180_00,
  container: 350_00,
  liquid: 300_00,
  special: 1_200_00,
  steel: 520_00,
  vehicles: 2_400_00,
};

/** Price level of a country (1 = average). */
export const COUNTRY_PRICE_LEVEL: Record<string, number> = {
  BG: 0.85, RO: 0.88, MK: 0.82, RS: 0.87, TR: 0.86, AL: 0.84, ME: 0.88, BA: 0.86, XK: 0.82, MD: 0.8, UA: 0.82,
  GR: 1.0, HU: 0.95, HR: 0.98, SI: 1.03, SK: 0.97, CZ: 1.0, PL: 0.95,
  AT: 1.15, DE: 1.2, IT: 1.1, FR: 1.12, NL: 1.18, BE: 1.15, LU: 1.2, CH: 1.3, DK: 1.22, SE: 1.2, NO: 1.3, FI: 1.15,
  ES: 1.02, PT: 0.95,
  // v2.0.
  BY: 0.78, RU: 0.84, GE: 0.78, AM: 0.78, EE: 1.0, LV: 0.94, LT: 0.93,
};

/** "Разчисти склада" (v1.5): goods that sat this long can be sold off at once, for a share of what they cost. */
export const CLEARANCE = { minDays: 3, share: 0.7 } as const;

export const TRADE_RULES = {
  /** Producers sell below the country price, consumers pay the country price × demand. */
  buyFactor: 0.92,
  sellFactor: 1.0,
  /** Daily movement of every price: ±12 %. */
  dailySwing: 0.12,
  /** Warehouse space per depot place, tonnes. */
  tonsPerSlot: 15,
  /** Smallest lot, tonnes. */
  minTons: 0.5,
} as const;

const sofiaDay = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now);
const swing = (cityId: number, cargo: string, side: string, now: Date) => 1 + (seededRandom(`${cityId}:${cargo}:${side}:${sofiaDay(now)}`)() * 2 - 1) * TRADE_RULES.dailySwing;
const level = (country: string) => COUNTRY_PRICE_LEVEL[country] ?? 1;

/** What a producer city asks per tonne today (euro cents). */
export function buyPriceCents(city: { id: number; countryCode: string }, cargo: CargoType, now: Date): number {
  return Math.round(TRADE_BASE_CENTS_PER_TON[cargo] * level(city.countryCode) * TRADE_RULES.buyFactor * swing(city.id, cargo, 'buy', now) * goodsSeason(cargo, now, 'buy'));
}

/**
 * Seasonal prices of goods (v1.6, balance): a cargo in season (by the freight
 * demand of the month) sells for more, and the producers ask a little more too
 * — half as much, so stocking up before the season pays off.
 */
export function goodsSeason(cargo: CargoType, now: Date, side: 'buy' | 'sell') {
  const f = seasonalFactor(cargo, now);
  return side === 'sell' ? f : 1 + (f - 1) / 2;
}

/** What a consumer city pays per tonne today (euro cents), given its demand for the cargo. */
export function sellPriceCents(city: { id: number; countryCode: string }, cargo: CargoType, demand: number, now: Date): number {
  return Math.round(TRADE_BASE_CENTS_PER_TON[cargo] * level(city.countryCode) * TRADE_RULES.sellFactor * demand * swing(city.id, cargo, 'sell', now) * goodsSeason(cargo, now, 'sell'));
}

export const warehouseCapacityTons = (slots: number) => slots * TRADE_RULES.tonsPerSlot;
