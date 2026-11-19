import { seededRandom } from './road-events';

/**
 * 1.3.3 „Жп линия“: a player's own freight trains. A train is a locomotive and
 * wagons of four kinds; it stands at a real freight terminal (a GeoNames city)
 * and runs only along real rail corridors between them. At each terminal the
 * board offers block-train orders (300–1500 t) for the lines that start there;
 * a train takes one if it has enough wagons of the right kind, pays the track
 * fee and the energy at the departure, and gets paid on arrival. The lines,
 * terminals and distances are real; the brands are invented and the prices,
 * timetables and orders are game data (labelled so in the game).
 *
 * Anyone can own a train from level 15; a member of a player company from
 * level 12, with a better pay, a cheaper track and one more train.
 */

export type LocoId = 'danubia-d22' | 'balkan-e40' | 'rila-e60';
export type WagonType = 'container' | 'tank' | 'covered' | 'hopper';

export interface LocoModel {
  name: string;
  /** Electric locomotives need an electrified line; diesel ones run anywhere. */
  electric: boolean;
  maxWagons: number;
  priceCents: number;
  /** Energy (diesel or electricity) per train-km, loaded; empty runs cost 60 %. */
  energyCentsPerKm: number;
}

export const LOCOS: Record<LocoId, LocoModel> = {
  'danubia-d22': { name: 'Danubia D22 Diesel', electric: false, maxWagons: 18, priceCents: 420_000_00, energyCentsPerKm: 260 },
  'balkan-e40': { name: 'Balkan Rail E40', electric: true, maxWagons: 24, priceCents: 560_000_00, energyCentsPerKm: 120 },
  'rila-e60': { name: 'Rila Rail E60 Heavy', electric: true, maxWagons: 32, priceCents: 780_000_00, energyCentsPerKm: 150 },
};
export const LOCO_IDS = Object.keys(LOCOS) as LocoId[];

export interface WagonModel {
  name: string;
  tons: number;
  priceCents: number;
  /** How the order pays next to the base rate (dangerous goods pay more, bulk less). */
  payFactor: number;
  /** What such orders carry (for the board). */
  goods: string[];
}

export const WAGONS: Record<WagonType, WagonModel> = {
  container: { name: 'Платформа за контейнери', tons: 60, priceCents: 32_000_00, payFactor: 1.15, goods: ['Контейнери'] },
  tank: { name: 'Цистерна', tons: 65, priceCents: 38_000_00, payFactor: 1.25, goods: ['Горива', 'Химикали'] },
  covered: { name: 'Покрит вагон', tons: 50, priceCents: 34_000_00, payFactor: 1.1, goods: ['Стоки на палети', 'Хартия'] },
  hopper: { name: 'Хопер', tons: 70, priceCents: 30_000_00, payFactor: 0.9, goods: ['Зърно', 'Въглища', 'Чакъл'] },
};
export const WAGON_TYPES = Object.keys(WAGONS) as WagonType[];

export const TRAINS = {
  minLevel: 15,
  maxTrains: 3,
  /** Wagons a new train starts with at least (of one kind). */
  minWagons: 5,
  /** Freight rate per ton-km, cents (before the wagon's factor) — far below a truck's. */
  centsPerTonKm: 2.6,
  /** Track access fee per train-km, cents (paid at every departure, loaded or empty). */
  trackCentsPerKm: 240,
  emptyEnergyShare: 0.6,
  /** The board: a new set of orders every 4 hours, two per line and direction. */
  windowHours: 4,
  ordersPerLine: 2,
  tons: { min: 300, max: 1500, step: 50 },
  sellBack: 0.5,
  /** In a player company: unlocked earlier, paid more, a cheaper track, one more train. */
  company: { minLevel: 12, payBonus: 0.1, trackDiscount: 0.25, extraTrains: 1 },
} as const;

export interface RailTerminal {
  /** GeoNames id of the city with the freight terminal. */
  id: number;
  name: string;
  country: string;
}

/** Freight terminals (real cities with rail freight yards). */
export const RAIL_TERMINALS: RailTerminal[] = [
  { id: 727011, name: 'София', country: 'BG' },
  { id: 728193, name: 'Пловдив', country: 'BG' },
  { id: 732770, name: 'Бургас', country: 'BG' },
  { id: 726050, name: 'Варна', country: 'BG' },
  { id: 727523, name: 'Русе', country: 'BG' },
  { id: 731233, name: 'Горна Оряховица', country: 'BG' },
  { id: 726848, name: 'Стара Загора', country: 'BG' },
  { id: 725905, name: 'Видин', country: 'BG' },
  { id: 734077, name: 'Солун', country: 'GR' },
  { id: 264371, name: 'Атина', country: 'GR' },
  { id: 787657, name: 'Ниш', country: 'RS' },
  { id: 792680, name: 'Белград', country: 'RS' },
  { id: 683506, name: 'Букурещ', country: 'RO' },
  { id: 680963, name: 'Кюстенджа', country: 'RO' },
  { id: 680332, name: 'Крайова', country: 'RO' },
  { id: 683844, name: 'Брашов', country: 'RO' },
  { id: 742394, name: 'Истанбул (Халкалъ)', country: 'TR' },
  { id: 3054643, name: 'Будапеща', country: 'HU' },
  { id: 2761369, name: 'Виена', country: 'AT' },
  { id: 2761524, name: 'Велс', country: 'AT' },
  { id: 715429, name: 'Сегед', country: 'HU' },
  { id: 2911298, name: 'Хамбург', country: 'DE' },
  { id: 2867714, name: 'Мюнхен', country: 'DE' },
  { id: 2934691, name: 'Дуйсбург', country: 'DE' },
  { id: 2747891, name: 'Ротердам', country: 'NL' },
  { id: 3164527, name: 'Верона', country: 'IT' },
  { id: 3067696, name: 'Прага', country: 'CZ' },
  { id: 3197753, name: 'Копер', country: 'SI' },
];

export const terminal = (id: number) => RAIL_TERMINALS.find((t) => t.id === id) ?? null;

export interface RailLine {
  id: string;
  a: number;
  b: number;
  /** Rail distance, km (real, rounded). */
  km: number;
  /** A freight train's time on the line with loading, real hours (game data). */
  hours: number;
  /** Electrified all the way (else only diesel locomotives). */
  electric: boolean;
}

/** Real rail corridors between the terminals; they run both ways. */
export const RAIL_LINES: RailLine[] = [
  // Bulgaria
  { id: 'sofia-plovdiv', a: 727011, b: 728193, km: 156, hours: 3, electric: true },
  { id: 'plovdiv-burgas', a: 728193, b: 732770, km: 294, hours: 5, electric: true },
  { id: 'plovdiv-stara-zagora', a: 728193, b: 726848, km: 95, hours: 2, electric: true },
  { id: 'stara-zagora-gorna', a: 726848, b: 731233, km: 170, hours: 4, electric: true },
  { id: 'sofia-gorna', a: 727011, b: 731233, km: 285, hours: 5, electric: true },
  { id: 'gorna-varna', a: 731233, b: 726050, km: 233, hours: 4, electric: true },
  { id: 'ruse-gorna', a: 727523, b: 731233, km: 112, hours: 2, electric: true },
  { id: 'ruse-varna', a: 727523, b: 726050, km: 225, hours: 4, electric: true },
  { id: 'sofia-vidin', a: 727011, b: 725905, km: 260, hours: 5, electric: true },
  // Across the borders
  { id: 'sofia-thessaloniki', a: 727011, b: 734077, km: 330, hours: 8, electric: false },
  { id: 'thessaloniki-athens', a: 734077, b: 264371, km: 500, hours: 9, electric: true },
  { id: 'sofia-nis', a: 727011, b: 787657, km: 160, hours: 4, electric: false },
  { id: 'nis-belgrade', a: 787657, b: 792680, km: 245, hours: 5, electric: true },
  { id: 'belgrade-budapest', a: 792680, b: 3054643, km: 350, hours: 8, electric: true },
  { id: 'plovdiv-istanbul', a: 728193, b: 742394, km: 425, hours: 9, electric: true },
  { id: 'ruse-bucharest', a: 727523, b: 683506, km: 75, hours: 3, electric: false },
  { id: 'vidin-craiova', a: 725905, b: 680332, km: 110, hours: 3, electric: false },
  { id: 'bucharest-constanta', a: 683506, b: 680963, km: 225, hours: 4, electric: true },
  { id: 'bucharest-brasov', a: 683506, b: 683844, km: 166, hours: 4, electric: true },
  // Central Europe
  { id: 'budapest-constanta', a: 3054643, b: 680963, km: 1_010, hours: 26, electric: true },
  { id: 'vienna-budapest', a: 2761369, b: 3054643, km: 250, hours: 5, electric: true },
  { id: 'wels-szeged', a: 2761524, b: 715429, km: 520, hours: 10, electric: true },
  { id: 'koper-budapest', a: 3197753, b: 3054643, km: 560, hours: 12, electric: true },
  { id: 'duisburg-vienna', a: 2934691, b: 2761369, km: 1_080, hours: 22, electric: true },
  { id: 'rotterdam-duisburg', a: 2747891, b: 2934691, km: 230, hours: 5, electric: true },
  { id: 'hamburg-munich', a: 2911298, b: 2867714, km: 790, hours: 14, electric: true },
  { id: 'hamburg-prague', a: 2911298, b: 3067696, km: 650, hours: 12, electric: true },
  { id: 'hamburg-budapest', a: 2911298, b: 3054643, km: 1_250, hours: 28, electric: true },
  { id: 'munich-verona', a: 2867714, b: 3164527, km: 430, hours: 9, electric: true },
  { id: 'duisburg-istanbul', a: 2934691, b: 742394, km: 2_560, hours: 48, electric: true },
];

export const railLine = (id: string) => RAIL_LINES.find((l) => l.id === id) ?? null;

/** The lines from a terminal, each with the terminal at its other end. */
export const linesFrom = (terminalId: number) =>
  RAIL_LINES.filter((l) => l.a === terminalId || l.b === terminalId).map((l) => ({ line: l, to: l.a === terminalId ? l.b : l.a }));

export type Wagons = Partial<Record<WagonType, number>>;
export const wagonCount = (w: Wagons) => WAGON_TYPES.reduce((s, k) => s + (w[k] ?? 0), 0);
export const wagonsValue = (w: Wagons) => WAGON_TYPES.reduce((s, k) => s + (w[k] ?? 0) * WAGONS[k].priceCents, 0);

/** Wagons of one kind an order needs. */
export const wagonsFor = (type: WagonType, tons: number) => Math.ceil(tons / WAGONS[type].tons);

export interface TrainRun {
  lineId: string;
  from: number;
  to: number;
  departAt: string;
  arriveAt: string;
  /** null: an empty run to another terminal. */
  orderId: string | null;
  wagonType: WagonType | null;
  goods: string | null;
  tons: number;
  /** Paid on arrival. */
  payCents: number;
  /** Paid at the departure (track and energy). */
  costCents: number;
}

export interface Train {
  id: string;
  ownerId: string;
  loco: LocoId;
  wagons: Wagons;
  /** The terminal it stands at (or left, while on a run). */
  at: number;
  run: TrainRun | null;
  boughtAt: string;
  runs: number;
  tons: number;
  earnedCents: number;
}

export interface TrainOrder {
  id: string;
  lineId: string;
  from: number;
  to: number;
  km: number;
  hours: number;
  electric: boolean;
  wagonType: WagonType;
  goods: string;
  tons: number;
  /** Base pay (before the company bonus). */
  payCents: number;
  /** The order can be taken until then (the next board). */
  until: number;
}

/** The board window an instant belongs to. */
export const boardWindow = (t: number) => Math.floor(t / (TRAINS.windowHours * 3_600_000));

/**
 * The orders at a terminal in the window of `t` — the same for every player
 * (deterministic). Which of them are taken is kept on the server.
 */
export function ordersAt(terminalId: number, t: number, open: (country: string) => boolean = () => true): TrainOrder[] {
  const w = boardWindow(t);
  const until = (w + 1) * TRAINS.windowHours * 3_600_000;
  const out: TrainOrder[] = [];
  for (const { line, to } of linesFrom(terminalId)) {
    const dest = terminal(to);
    const here = terminal(terminalId);
    if (!dest || !here || !open(dest.country) || !open(here.country)) continue;
    for (let i = 0; i < TRAINS.ordersPerLine; i++) {
      const id = `${line.id}:${terminalId}:${w}:${i}`;
      const r = seededRandom(id);
      const wagonType = WAGON_TYPES[Math.floor(r() * WAGON_TYPES.length)]!;
      const goods = WAGONS[wagonType].goods[Math.floor(r() * WAGONS[wagonType].goods.length)]!;
      const steps = (TRAINS.tons.max - TRAINS.tons.min) / TRAINS.tons.step;
      const tons = TRAINS.tons.min + TRAINS.tons.step * Math.floor(r() * (steps + 1));
      const market = 0.9 + r() * 0.3;
      out.push({ id, lineId: line.id, from: terminalId, to, km: line.km, hours: line.hours, electric: line.electric, wagonType, goods, tons, payCents: orderPay(tons, line.km, wagonType, market), until });
    }
  }
  return out;
}

export const orderPay = (tons: number, km: number, type: WagonType, market = 1) => Math.round(tons * km * TRAINS.centsPerTonKm * WAGONS[type].payFactor * market);

/** Track fee and energy for a run (cents). */
export function runCost(loco: LocoId, km: number, loaded: boolean, inCompany: boolean) {
  const track = Math.round(km * TRAINS.trackCentsPerKm * (inCompany ? 1 - TRAINS.company.trackDiscount : 1));
  const energy = Math.round(km * LOCOS[loco].energyCentsPerKm * (loaded ? 1 : TRAINS.emptyEnergyShare));
  return { track, energy, total: track + energy };
}

/** What an order pays this player (the company bonus on top). */
export const payFor = (order: Pick<TrainOrder, 'payCents'>, inCompany: boolean) => Math.round(order.payCents * (inCompany ? 1 + TRAINS.company.payBonus : 1));

/** Why this train cannot take this order, or null. */
export function cannotTake(train: Pick<Train, 'loco' | 'wagons' | 'run' | 'at'>, order: Pick<TrainOrder, 'from' | 'electric' | 'wagonType' | 'tons'>): string | null {
  if (train.run) return 'busy';
  if (train.at !== order.from) return 'elsewhere';
  if (LOCOS[train.loco].electric && !order.electric) return 'diesel_only';
  if ((train.wagons[order.wagonType] ?? 0) < wagonsFor(order.wagonType, order.tons)) return 'wagons';
  return null;
}

export const trainLimits = (inCompany: boolean) => ({
  minLevel: inCompany ? TRAINS.company.minLevel : TRAINS.minLevel,
  maxTrains: TRAINS.maxTrains + (inCompany ? TRAINS.company.extraTrains : 0),
});
