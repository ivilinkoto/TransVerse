/**
 * 1.3 „Автобусна компания“: passenger lines next to the freight. A player buys a
 * bus for a line from one of their depot cities to a big city 100–700 km away,
 * sets the departures a day and the ticket price. Passengers come by the two
 * cities' size, the distance, the price, the comfort and the other players on
 * the same pair of cities. The takings pile up in the line's till (up to 48 h)
 * and the player collects them. Brands are invented; all figures are game data.
 */
export type BusModelId = 'shuttle' | 'intercity' | 'coach';

export const BUS_MODELS: Record<BusModelId, { name: string; seats: number; priceCents: number; costPerKmCents: number }> = {
  shuttle: { name: 'Vitosha Shuttle 20', seats: 20, priceCents: 60_000_00, costPerKmCents: 110 },
  intercity: { name: 'Rila Intercity 12', seats: 49, priceCents: 120_000_00, costPerKmCents: 170 },
  coach: { name: 'Balkan Tourer 15', seats: 61, priceCents: 200_000_00, costPerKmCents: 210 },
};
export const BUS_MODEL_IDS = Object.keys(BUS_MODELS) as BusModelId[];

export const BUSES = {
  minLevel: 8,
  maxLines: 5,
  km: [100, 700] as const,
  departures: [1, 2, 3, 4] as const,
  /** Ticket price per 100 km (cents): allowed range and the reference the demand is measured against. */
  price: { min: 300, max: 1000, ref: 600 },
  comfort: { maxLevel: 3, demandPerLevel: 0.1, costCents: [20_000_00, 40_000_00, 70_000_00] as const },
  /** The till keeps at most this many hours of takings. */
  tillHours: 48,
  sellBack: 0.5,
} as const;

export interface BusLine {
  id: string;
  ownerId: string;
  model: BusModelId;
  from: { id: number; name: string; country: string; population: number };
  to: { id: number; name: string; country: string; population: number };
  km: number;
  departures: number;
  priceCents: number;
  comfort: number;
  boughtAt: string;
  /** Takings are counted from here. */
  collectedAt: string;
  totalPassengers: number;
  totalCents: number;
}

/** Passengers a day between two cities for all carriers together. */
export function pairDemand(popA: number, popB: number, km: number): number {
  const size = Math.sqrt(popA * popB) / 6000;
  const dist = Math.max(0.3, Math.min(1, 1 - Math.abs(km - 350) / 700));
  return Math.min(120, Math.round(size * dist));
}

/**
 * How the ticket price moves the passengers: square of the reference over the price,
 * between 0.15 and 1.6 (a dear ticket empties the bus; 1.3 balance before the release:
 * the best lines paid back in under two weeks, far above a truck, with no work).
 */
export const priceAppeal = (priceCents: number) => Math.max(0.15, Math.min(1.6, (BUSES.price.ref / priceCents) ** 2));

/** How attractive a line is: cheaper and more comfortable carry more. */
export function lineWeight(l: Pick<BusLine, 'priceCents' | 'comfort' | 'departures' | 'model'>): number {
  const price = priceAppeal(l.priceCents);
  return l.departures * BUS_MODELS[l.model].seats * price * (1 + BUSES.comfort.demandPerLevel * l.comfort);
}

/** One line's day: passengers per departure (its share of the pair's demand, up to the seats) and the money. */
export function lineDay(line: BusLine, rivals: Pick<BusLine, 'priceCents' | 'comfort' | 'departures' | 'model'>[]) {
  const demand = pairDemand(line.from.population, line.to.population, line.km);
  const mine = lineWeight(line);
  const total = mine + rivals.reduce((s, r) => s + lineWeight(r), 0);
  const priceFactor = priceAppeal(line.priceCents);
  const wanted = demand * priceFactor * (1 + BUSES.comfort.demandPerLevel * line.comfort) * (mine / total);
  const perDeparture = Math.min(BUS_MODELS[line.model].seats, Math.floor(wanted / line.departures));
  const fare = Math.round((line.priceCents * line.km) / 100);
  const revenue = perDeparture * fare * line.departures;
  const cost = Math.round(line.km * BUS_MODELS[line.model].costPerKmCents * line.departures);
  return { demand, perDeparture, passengers: perDeparture * line.departures, revenueCents: revenue, costCents: cost, profitCents: revenue - cost };
}

/** What the till holds after `hours` (capped), as whole departures (pro rata). */
export function tillFor(day: ReturnType<typeof lineDay>, hours: number) {
  const h = Math.max(0, Math.min(BUSES.tillHours, hours));
  // `|| 0`: a losing line with nothing in the till must not give -0.
  return { passengers: Math.floor((day.passengers * h) / 24), cents: Math.round((day.profitCents * h) / 24) || 0, hours: h };
}

/** Lines between the same two cities (in either direction) compete. */
export const samePair = (a: Pick<BusLine, 'from' | 'to'>, b: Pick<BusLine, 'from' | 'to'>) =>
  (a.from.id === b.from.id && a.to.id === b.to.id) || (a.from.id === b.to.id && a.to.id === b.from.id);
