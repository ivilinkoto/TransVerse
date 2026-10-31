/**
 * 1.1.4.1 „Голям рейс“: every week three legs between big cities of different
 * countries. Drive all three (any order, any truck of yours) and get the badge
 * „Голям рейс“ (once) and ТрансКоин (each week). Game data.
 */
export const BIG_RUN = {
  legs: 3,
  coins: 20,
  badge: 'big-run',
  /** A leg is this long (straight line, km). */
  minKm: 250,
  maxKm: 900,
  /** Its loads pay a little more than the market. */
  multiplier: 1.15,
};

export interface BigRunCity {
  id: number;
  nameBg: string;
  countryCode: string;
  lat: number;
  lon: number;
}

export interface BigRunLeg {
  from: BigRunCity;
  to: BigRunCity;
}

const km = (a: BigRunCity, b: BigRunCity) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

/** A small seeded random (the same week gives the same run everywhere). */
function seeded(key: string) {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** The week's chain A → B → C → D: each leg in another country, within the leg length. */
export function pickBigRun(week: string, cities: readonly BigRunCity[]): BigRunLeg[] {
  const rand = seeded(`big-run:${week}`);
  for (let attempt = 0; attempt < 200; attempt++) {
    const chain: BigRunCity[] = [cities[Math.floor(rand() * cities.length)]!];
    while (chain.length <= BIG_RUN.legs) {
      const last = chain.at(-1)!;
      const next = cities.filter((c) => c.countryCode !== last.countryCode && !chain.includes(c) && km(last, c) >= BIG_RUN.minKm && km(last, c) <= BIG_RUN.maxKm);
      if (!next.length) break;
      chain.push(next[Math.floor(rand() * next.length)]!);
    }
    if (chain.length === BIG_RUN.legs + 1) return chain.slice(1).map((to, i) => ({ from: chain[i]!, to }));
  }
  return [];
}
