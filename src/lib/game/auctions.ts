import type { CargoType } from './cargo';

/**
 * Special loads on auction: a few times a day a rare, valuable load is put up
 * for 15 minutes. Players bid the lowest price they will haul it for; the
 * lowest bid wins and gets the load as a private job, plus ТрансКоин on
 * delivery. Game data (fictional loads).
 */
export interface SpecialLoad {
  id: string;
  title: string;
  goods: string;
  cargo: CargoType;
  tons: [number, number];
  coins: number;
}

export const SPECIAL_LOADS: SpecialLoad[] = [
  { id: 'transformer', title: 'Трансформатор за подстанция', goods: 'Силов трансформатор', cargo: 'special', tons: [28, 38], coins: 40 },
  { id: 'yacht', title: 'Яхта за пристанището', goods: 'Моторна яхта', cargo: 'special', tons: [18, 26], coins: 35 },
  { id: 'helicopter', title: 'Хеликоптер за авиоизложение', goods: 'Хеликоптер (без перки)', cargo: 'special', tons: [12, 18], coins: 35 },
  { id: 'statue', title: 'Музеен експонат', goods: 'Антична статуя в каса', cargo: 'pallets', tons: [2, 5], coins: 25 },
  { id: 'medicine', title: 'Спешни лекарства за болница', goods: 'Ваксини и лекарства', cargo: 'refrigerated', tons: [3, 8], coins: 25 },
  { id: 'supercars', title: 'Спортни автомобили за салон', goods: 'Нови спортни автомобили', cargo: 'vehicles', tons: [8, 14], coins: 30 },
  { id: 'bridge', title: 'Греди за нов мост', goods: 'Стоманени греди', cargo: 'steel', tons: [20, 26], coins: 30 },
  { id: 'organ', title: 'Орган за концертна зала', goods: 'Концертен орган в части', cargo: 'pallets', tons: [6, 12], coins: 25 },
];

export const AUCTION_RULES = {
  minutes: 15,
  /** Auctions start at these hours (Sofia) every day. */
  hours: [10, 14, 18, 21],
  /** The opening (highest) price, as a multiple of the market reward for the load. */
  startMultiplier: 2.2,
  /** No bid below this share of the opening price. */
  floorShare: 0.4,
  /** A new bid must beat the lowest by at least this share. */
  stepShare: 0.01,
  /** A bid in the last minute adds a minute (at most this many times). */
  extendMs: 60_000,
  maxExtensions: 5,
  /** The winner has this long to send a truck. */
  sendHours: 3,
  forfeitReputation: 5,
} as const;

/** Highest bid allowed now: the opening price, or a step below the current lowest. */
export function maxBidCents(startCents: number, lowestCents: number | null): number {
  if (lowestCents == null) return startCents;
  return Math.floor(lowestCents * (1 - AUCTION_RULES.stepShare));
}

export function floorBidCents(startCents: number): number {
  return Math.ceil(startCents * AUCTION_RULES.floorShare);
}
