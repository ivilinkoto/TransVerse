import type { CargoType } from './cargo';

/**
 * Simulated economic profile of a real city. These are GAME DATA derived
 * deterministically from population and port access — not real statistics.
 */
export interface MarketProfileEntry {
  cargoType: CargoType;
  produces: boolean;
  consumes: boolean;
}

/** Population threshold for a city to take part in the freight market. */
export function isFreightHub(city: { population: number; country: string }): boolean {
  return city.population >= (city.country === 'BG' ? 25_000 : 60_000);
}

function hash(id: number, salt: number): number {
  let x = (id ^ (salt * 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function deriveMarketProfile(city: { id: number; population: number }, hasPort: boolean): MarketProfileEntry[] {
  const p = city.population;
  const h = (salt: number) => hash(city.id, salt);
  const entries: MarketProfileEntry[] = [
    { cargoType: 'pallets', produces: p >= 100_000 || h(1) < 0.6, consumes: true },
    { cargoType: 'refrigerated', produces: h(2) < 0.4, consumes: p >= 50_000 || h(3) < 0.5 },
    { cargoType: 'bulk', produces: p < 300_000 && h(4) < 0.4, consumes: hasPort || p >= 200_000 || h(5) < 0.3 },
    { cargoType: 'container', produces: hasPort || p >= 500_000, consumes: hasPort || p >= 500_000 },
    { cargoType: 'liquid', produces: (hasPort && h(6) < 0.6) || h(7) < 0.12, consumes: p >= 80_000 || h(8) < 0.3 },
    { cargoType: 'special', produces: p >= 200_000 && h(9) < 0.5, consumes: p >= 300_000 || h(10) < 0.25 },
  ];
  return entries.filter((e) => e.produces || e.consumes);
}
