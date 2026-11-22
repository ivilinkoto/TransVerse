import { seededRandom } from './road-events';

/**
 * 1.3.3 „Жп линия“: a player's own freight trains. A train is a locomotive and
 * wagons of four kinds; it stands at a real freight terminal (a GeoNames city)
 * and runs over a network of real rail lines between neighbouring terminals.
 * A run to a far terminal goes through the ones between (a short technical
 * stop at each) and waits at the borders. A locomotive pulls only so many tons
 * — fewer on hilly and mountain lines — and a heavier train runs slower and
 * uses more energy. At each terminal the board offers block-train orders
 * (300–1500 t) to the neighbours and to terminals further away; the track fee
 * and the energy are paid at the departure, the order on arrival.
 *
 * The terminals, the lines and the towns they pass are real; the brands are
 * invented and the prices, power figures, times and orders are game data
 * (labelled so in the game).
 *
 * Anyone can own a train from level 25 (with the rail licence, from the same
 * level); a member of a player company from level 12 when the company holds
 * the licence, with a better pay, a cheaper track and one more train.
 */

export type LocoId = 'danubia-d22' | 'balkan-e40' | 'rila-e60';
export type WagonType = 'container' | 'tank' | 'covered' | 'hopper';
export type Grade = 'flat' | 'hilly' | 'mountain';

export interface LocoModel {
  name: string;
  /** Electric locomotives need an electrified line; diesel ones run anywhere. */
  electric: boolean;
  /** Power, kW (game data, in the range of real freight locomotives). */
  powerKw: number;
  /** The heaviest train (wagons and load) it pulls on a flat line, tons. */
  maxTons: number;
  maxWagons: number;
  priceCents: number;
  /** Energy (diesel or electricity) per train-km for a 1000 t train on a flat line. */
  energyCentsPerKm: number;
}

export const LOCOS: Record<LocoId, LocoModel> = {
  'danubia-d22': { name: 'Danubia D22 Diesel', electric: false, powerKw: 2_200, maxTons: 1_600, maxWagons: 22, priceCents: 420_000_00, energyCentsPerKm: 260 },
  'balkan-e40': { name: 'Balkan Rail E40', electric: true, powerKw: 4_000, maxTons: 2_000, maxWagons: 26, priceCents: 560_000_00, energyCentsPerKm: 120 },
  'rila-e60': { name: 'Rila Rail E60 Heavy', electric: true, powerKw: 6_400, maxTons: 2_700, maxWagons: 32, priceCents: 780_000_00, energyCentsPerKm: 150 },
};
export const LOCO_IDS = Object.keys(LOCOS) as LocoId[];

export interface WagonModel {
  name: string;
  /** Load, tons. */
  tons: number;
  /** Empty weight, tons. */
  tare: number;
  priceCents: number;
  /** How the order pays next to the base rate (dangerous goods pay more, bulk less). */
  payFactor: number;
  /** What such orders carry (for the board). */
  goods: string[];
}

export const WAGONS: Record<WagonType, WagonModel> = {
  container: { name: 'Платформа за контейнери', tons: 60, tare: 20, priceCents: 32_000_00, payFactor: 1.15, goods: ['Контейнери'] },
  tank: { name: 'Цистерна', tons: 65, tare: 24, priceCents: 38_000_00, payFactor: 1.25, goods: ['Горива', 'Химикали'] },
  covered: { name: 'Покрит вагон', tons: 50, tare: 26, priceCents: 34_000_00, payFactor: 1.1, goods: ['Стоки на палети', 'Хартия'] },
  hopper: { name: 'Хопер', tons: 70, tare: 22, priceCents: 30_000_00, payFactor: 0.9, goods: ['Зърно', 'Въглища', 'Чакъл'] },
};
export const WAGON_TYPES = Object.keys(WAGONS) as WagonType[];

/** How much of its flat-line weight a locomotive pulls up a line, the energy it needs there, and the label. */
export const GRADES: Record<Grade, { pull: number; energy: number; label: string }> = {
  flat: { pull: 1, energy: 1, label: 'равнинна' },
  hilly: { pull: 0.8, energy: 1.15, label: 'хълмиста' },
  mountain: { pull: 0.6, energy: 1.3, label: 'планинска' },
};

export const TRAINS = {
  minLevel: 25,
  maxTrains: 3,
  /** Wagons a new train starts with at least (of one kind). */
  minWagons: 5,
  /** Freight rate per ton-km, cents (before the wagon's factor) — far below a truck's. */
  centsPerTonKm: 2.6,
  /** Track access fee per train-km, cents (paid at every departure, loaded or empty). */
  trackCentsPerKm: 240,
  /** A short technical stop at each terminal on the way (crew, checks), hours. */
  stopHours: 0.5,
  /** The board: a new set of orders every 4 hours — two per neighbour, and a few to terminals further away. */
  windowHours: 4,
  ordersPerLine: 2,
  farOrders: 3,
  far: { minStops: 2, maxStops: 5, maxKm: 2_000 },
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
  { id: 715429, name: 'Сегед', country: 'HU' },
  { id: 2761369, name: 'Виена', country: 'AT' },
  { id: 2761524, name: 'Велс', country: 'AT' },
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
  /** A freight train's time on the line with a medium load, real hours (game data). */
  hours: number;
  /** Electrified all the way (else only diesel locomotives). */
  electric: boolean;
  grade: Grade;
  /** GeoNames ids of real towns the line passes, from a to b (for the map). */
  via: number[];
  /** The border crossing on the line and the wait there (game data), hours. */
  border?: { name: string; hours: number };
}

/** Real rail lines between neighbouring terminals; they run both ways. */
export const RAIL_LINES: RailLine[] = [
  // Bulgaria
  { id: 'sofia-plovdiv', a: 727011, b: 728193, km: 156, hours: 3, electric: true, grade: 'hilly', via: [728378] },
  { id: 'plovdiv-stara-zagora', a: 728193, b: 726848, km: 95, hours: 2, electric: true, grade: 'flat', via: [732452] },
  { id: 'stara-zagora-burgas', a: 726848, b: 732770, km: 200, hours: 4, electric: true, grade: 'flat', via: [728742, 725578, 730559] },
  { id: 'stara-zagora-gorna', a: 726848, b: 731233, km: 170, hours: 4, electric: true, grade: 'mountain', via: [730496, 725993] },
  { id: 'sofia-gorna', a: 727011, b: 731233, km: 285, hours: 5, electric: true, grade: 'hilly', via: [728203] },
  { id: 'gorna-varna', a: 731233, b: 726050, km: 233, hours: 4, electric: true, grade: 'flat', via: [727233] },
  { id: 'ruse-gorna', a: 727523, b: 731233, km: 112, hours: 2, electric: true, grade: 'flat', via: [] },
  { id: 'ruse-varna', a: 727523, b: 726050, km: 225, hours: 4, electric: true, grade: 'flat', via: [727696] },
  { id: 'sofia-vidin', a: 727011, b: 725905, km: 260, hours: 5, electric: true, grade: 'hilly', via: [725712, 729114] },
  // Across the borders
  { id: 'sofia-thessaloniki', a: 727011, b: 734077, km: 330, hours: 8, electric: false, grade: 'hilly', via: [728330, 726872, 733191, 727447], border: { name: 'Кулата – Промахон', hours: 2 } },
  { id: 'thessaloniki-athens', a: 734077, b: 264371, km: 500, hours: 9, electric: true, grade: 'hilly', via: [735914, 258576, 258620] },
  { id: 'sofia-nis', a: 727011, b: 787657, km: 160, hours: 4, electric: false, grade: 'hilly', via: [787050], border: { name: 'Калотина – Димитровград', hours: 2 } },
  { id: 'nis-belgrade', a: 787657, b: 792680, km: 245, hours: 5, electric: true, grade: 'flat', via: [789923] },
  { id: 'belgrade-budapest', a: 792680, b: 3054643, km: 350, hours: 8, electric: true, grade: 'flat', via: [3194360, 3189595, 3050434], border: { name: 'Суботица – Келебия', hours: 2 } },
  { id: 'plovdiv-istanbul', a: 728193, b: 742394, km: 425, hours: 9, electric: true, grade: 'flat', via: [732263, 730442, 747712, 748893], border: { name: 'Свиленград – Капъкуле', hours: 3 } },
  { id: 'ruse-bucharest', a: 727523, b: 683506, km: 75, hours: 2, electric: false, grade: 'flat', via: [677106], border: { name: 'Русе – Гюргево', hours: 1.5 } },
  { id: 'vidin-craiova', a: 725905, b: 680332, km: 110, hours: 3, electric: false, grade: 'flat', via: [683034], border: { name: 'Видин – Калафат', hours: 1.5 } },
  { id: 'craiova-bucharest', a: 680332, b: 683506, km: 209, hours: 4, electric: true, grade: 'flat', via: [666767, 670609] },
  { id: 'bucharest-constanta', a: 683506, b: 680963, km: 225, hours: 4, electric: true, grade: 'flat', via: [673636] },
  { id: 'bucharest-brasov', a: 683506, b: 683844, km: 166, hours: 4, electric: true, grade: 'mountain', via: [670474] },
  // Central Europe
  { id: 'budapest-craiova', a: 3054643, b: 680332, km: 640, hours: 15, electric: true, grade: 'hilly', via: [686254, 665087, 674531], border: { name: 'Лекьошхаза – Куртич', hours: 2 } },
  { id: 'budapest-szeged', a: 3054643, b: 715429, km: 191, hours: 4, electric: true, grade: 'flat', via: [3050434] },
  { id: 'vienna-budapest', a: 2761369, b: 3054643, km: 250, hours: 5, electric: true, grade: 'flat', via: [3052009], border: { name: 'Хедешхалом', hours: 0.5 } },
  { id: 'wels-vienna', a: 2761524, b: 2761369, km: 200, hours: 4, electric: true, grade: 'flat', via: [2772400] },
  { id: 'munich-wels', a: 2867714, b: 2761524, km: 225, hours: 5, electric: true, grade: 'hilly', via: [2766824], border: { name: 'Залцбург', hours: 0.5 } },
  { id: 'koper-budapest', a: 3197753, b: 3054643, km: 560, hours: 12, electric: true, grade: 'mountain', via: [3196359, 3202781, 3042638, 3044774], border: { name: 'Ходош – Ориссентпетер', hours: 1 } },
  { id: 'duisburg-vienna', a: 2934691, b: 2761369, km: 1_080, hours: 22, electric: true, grade: 'hilly', via: [2886242, 2925533, 2805615, 2861650, 2849483, 2855328, 2772400], border: { name: 'Пасау', hours: 0.5 } },
  { id: 'rotterdam-duisburg', a: 2747891, b: 2934691, km: 230, hours: 5, electric: true, grade: 'flat', via: [2759661], border: { name: 'Емерих', hours: 0.5 } },
  { id: 'hamburg-munich', a: 2911298, b: 2867714, km: 790, hours: 14, electric: true, grade: 'hilly', via: [2910831, 2805615, 2861650] },
  { id: 'hamburg-prague', a: 2911298, b: 3067696, km: 650, hours: 12, electric: true, grade: 'flat', via: [2935022], border: { name: 'Бад Шандау', hours: 0.5 } },
  { id: 'prague-budapest', a: 3067696, b: 3054643, km: 530, hours: 11, electric: true, grade: 'hilly', via: [3078610, 3060972], border: { name: 'Бржецлав и Щурово', hours: 1 } },
  { id: 'munich-verona', a: 2867714, b: 3164527, km: 430, hours: 9, electric: true, grade: 'mountain', via: [2775220, 3181913, 3165243], border: { name: 'Куфщайн и Бренер', hours: 1 } },
];

export const railLine = (id: string) => RAIL_LINES.find((l) => l.id === id) ?? null;
export const otherEnd = (line: RailLine, from: number) => (line.a === from ? line.b : line.a);

/** The lines from a terminal, each with the terminal at its other end. */
export const linesFrom = (terminalId: number) =>
  RAIL_LINES.filter((l) => l.a === terminalId || l.b === terminalId).map((l) => ({ line: l, to: otherEnd(l, terminalId) }));

export interface RailPath {
  from: number;
  to: number;
  lines: string[];
  /** Terminals in order, both ends included. */
  stops: number[];
  km: number;
  electric: boolean;
  /** The steepest line on the way decides how much a locomotive pulls. */
  pull: number;
  borders: { name: string; hours: number }[];
}

/**
 * The quickest way from a terminal to every other one (Dijkstra by hours with
 * the stops and borders), through the open countries only. Deterministic.
 */
export function pathsFrom(from: number, open: (country: string) => boolean = () => true, electricOnly = false): Map<number, RailPath> {
  const best = new Map<number, { cost: number; prev: number | null; line: RailLine | null }>([[from, { cost: 0, prev: null, line: null }]]);
  const done = new Set<number>();
  for (;;) {
    let cur: number | null = null;
    for (const [id, v] of best) if (!done.has(id) && (cur === null || v.cost < best.get(cur)!.cost || (v.cost === best.get(cur)!.cost && id < cur))) cur = id;
    if (cur === null) break;
    done.add(cur);
    for (const { line, to } of linesFrom(cur)) {
      const dest = terminal(to);
      if (!dest || !open(dest.country) || (electricOnly && !line.electric)) continue;
      const cost = best.get(cur)!.cost + line.hours + (line.border?.hours ?? 0) + TRAINS.stopHours;
      const known = best.get(to);
      if (!known || cost < known.cost) best.set(to, { cost, prev: cur, line });
    }
  }
  const out = new Map<number, RailPath>();
  for (const to of best.keys()) {
    if (to === from) continue;
    const lines: RailLine[] = [];
    const stops = [to];
    for (let at = to; at !== from; ) {
      const v = best.get(at)!;
      lines.unshift(v.line!);
      at = v.prev!;
      stops.unshift(at);
    }
    out.set(to, {
      from, to, lines: lines.map((l) => l.id), stops,
      km: lines.reduce((s, l) => s + l.km, 0),
      electric: lines.every((l) => l.electric),
      pull: Math.min(...lines.map((l) => GRADES[l.grade].pull)),
      borders: lines.flatMap((l) => (l.border ? [l.border] : [])),
    });
  }
  return out;
}

export type Wagons = Partial<Record<WagonType, number>>;
export const wagonCount = (w: Wagons) => WAGON_TYPES.reduce((s, k) => s + (w[k] ?? 0), 0);
export const wagonsValue = (w: Wagons) => WAGON_TYPES.reduce((s, k) => s + (w[k] ?? 0) * WAGONS[k].priceCents, 0);
export const tareTons = (w: Wagons) => WAGON_TYPES.reduce((s, k) => s + (w[k] ?? 0) * WAGONS[k].tare, 0);

/** Wagons of one kind an order needs. */
export const wagonsFor = (type: WagonType, tons: number) => Math.ceil(tons / WAGONS[type].tons);

/** The heaviest train a locomotive pulls over a path (the steepest line decides). */
export const pullOver = (loco: LocoId, path: Pick<RailPath, 'pull'>) => Math.floor(LOCOS[loco].maxTons * path.pull);

export interface RunLeg {
  kind: 'run' | 'stop' | 'border';
  /** The line (a run, or the border on it). */
  lineId?: string;
  from: number;
  to: number;
  /** Epoch ms */
  start: number;
  end: number;
  note?: string;
}

/**
 * The timetable of a run: every line in turn (a heavier train for its
 * locomotive is slower — 0.85× to 1.15× the line's time), the border wait on
 * it and a short stop at each terminal between.
 */
export function runLegs(path: RailPath, loco: LocoId, grossTons: number, start: number): RunLeg[] {
  const legs: RunLeg[] = [];
  let t = start;
  path.lines.forEach((id, i) => {
    const line = railLine(id)!;
    const from = path.stops[i]!, to = path.stops[i + 1]!;
    const load = Math.min(1, grossTons / (LOCOS[loco].maxTons * GRADES[line.grade].pull));
    const h = line.hours * (0.85 + 0.3 * load);
    // The border is half way along the line.
    if (line.border) {
      const half = (h / 2) * 3_600_000;
      legs.push({ kind: 'run', lineId: id, from, to, start: t, end: t + half });
      t += half;
      legs.push({ kind: 'border', lineId: id, from, to, start: t, end: t + line.border.hours * 3_600_000, note: line.border.name });
      t += line.border.hours * 3_600_000;
      legs.push({ kind: 'run', lineId: id, from, to, start: t, end: t + half });
      t += half;
    } else {
      legs.push({ kind: 'run', lineId: id, from, to, start: t, end: t + h * 3_600_000 });
      t += h * 3_600_000;
    }
    if (i < path.lines.length - 1) {
      legs.push({ kind: 'stop', from: to, to, start: t, end: t + TRAINS.stopHours * 3_600_000 });
      t += TRAINS.stopHours * 3_600_000;
    }
  });
  return legs;
}

/** Track fee and energy for a run (cents): energy grows with the train's weight and the hills. */
export function runCost(loco: LocoId, path: Pick<RailPath, 'lines'>, grossTons: number, inCompany: boolean) {
  const lines = path.lines.map((id) => railLine(id)!);
  const km = lines.reduce((s, l) => s + l.km, 0);
  const track = Math.round(km * TRAINS.trackCentsPerKm * (inCompany ? 1 - TRAINS.company.trackDiscount : 1));
  const weight = 0.4 + 0.6 * (grossTons / 1000);
  const energy = Math.round(lines.reduce((s, l) => s + l.km * GRADES[l.grade].energy, 0) * LOCOS[loco].energyCentsPerKm * weight);
  return { track, energy, total: track + energy };
}

export interface TrainRun {
  /** The lines in order (and the terminals between in `stops`). */
  lines: string[];
  stops: number[];
  from: number;
  to: number;
  departAt: string;
  arriveAt: string;
  legs: RunLeg[];
  /** null: an empty run to another terminal. */
  orderId: string | null;
  wagonType: WagonType | null;
  goods: string | null;
  tons: number;
  grossTons: number;
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

export interface TrainOrder extends RailPath {
  id: string;
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

function makeOrder(id: string, path: RailPath, until: number): TrainOrder {
  const r = seededRandom(id);
  const wagonType = WAGON_TYPES[Math.floor(r() * WAGON_TYPES.length)]!;
  const goods = WAGONS[wagonType].goods[Math.floor(r() * WAGONS[wagonType].goods.length)]!;
  const steps = (TRAINS.tons.max - TRAINS.tons.min) / TRAINS.tons.step;
  const tons = TRAINS.tons.min + TRAINS.tons.step * Math.floor(r() * (steps + 1));
  const market = 0.9 + r() * 0.3;
  return { ...path, id, wagonType, goods, tons, payCents: orderPay(tons, path.km, wagonType, market), until };
}

/**
 * The orders at a terminal in the window of `t` — the same for every player
 * (deterministic): two to each neighbour and a few to terminals further away
 * along the network. Which of them are taken is kept on the server.
 */
export function ordersAt(terminalId: number, t: number, open: (country: string) => boolean = () => true): TrainOrder[] {
  const here = terminal(terminalId);
  if (!here || !open(here.country)) return [];
  const w = boardWindow(t);
  const until = (w + 1) * TRAINS.windowHours * 3_600_000;
  const paths = pathsFrom(terminalId, open);
  const out: TrainOrder[] = [];
  for (const { to } of linesFrom(terminalId)) {
    const path = paths.get(to);
    if (!path) continue;
    for (let i = 0; i < TRAINS.ordersPerLine; i++) out.push(makeOrder(`${terminalId}-${to}:${w}:${i}`, path, until));
  }
  const far = [...paths.values()].filter((p) => p.stops.length - 1 >= TRAINS.far.minStops && p.stops.length - 1 <= TRAINS.far.maxStops && p.km <= TRAINS.far.maxKm).sort((a, b) => a.to - b.to);
  const r = seededRandom(`far:${terminalId}:${w}`);
  for (let i = 0; i < TRAINS.farOrders && far.length; i++) {
    const path = far.splice(Math.floor(r() * far.length), 1)[0]!;
    out.push(makeOrder(`${terminalId}-${path.to}:${w}:f${i}`, path, until));
  }
  return out;
}

export const orderPay = (tons: number, km: number, type: WagonType, market = 1) => Math.round(tons * km * TRAINS.centsPerTonKm * WAGONS[type].payFactor * market);

/** What an order pays this player (the company bonus on top). */
export const payFor = (order: Pick<TrainOrder, 'payCents'>, inCompany: boolean) => Math.round(order.payCents * (inCompany ? 1 + TRAINS.company.payBonus : 1));

/** The train's weight with a load: the wagons and the goods, tons. */
export const grossFor = (train: Pick<Train, 'wagons'>, cargoTons: number) => tareTons(train.wagons) + cargoTons;

/** Why this train cannot take this order, or null. */
export function cannotTake(train: Pick<Train, 'loco' | 'wagons' | 'run' | 'at'>, order: Pick<TrainOrder, 'from' | 'electric' | 'wagonType' | 'tons' | 'pull'>): string | null {
  if (train.run) return 'busy';
  if (train.at !== order.from) return 'elsewhere';
  if (LOCOS[train.loco].electric && !order.electric) return 'diesel_only';
  if ((train.wagons[order.wagonType] ?? 0) < wagonsFor(order.wagonType, order.tons)) return 'wagons';
  if (grossFor(train, order.tons) > pullOver(train.loco, order)) return 'too_heavy';
  return null;
}

export const trainLimits = (inCompany: boolean) => ({
  minLevel: inCompany ? TRAINS.company.minLevel : TRAINS.minLevel,
  maxTrains: TRAINS.maxTrains + (inCompany ? TRAINS.company.extraTrains : 0),
});

/** Where a train on a run is now: the leg it is on and how far along the whole run (0–1). */
export function runProgress(run: Pick<TrainRun, 'legs' | 'departAt' | 'arriveAt'>, now: number) {
  const leg = run.legs.find((l) => now < l.end) ?? run.legs[run.legs.length - 1] ?? null;
  const start = new Date(run.departAt).getTime(), end = new Date(run.arriveAt).getTime();
  return { leg, share: Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start))) };
}

type LatLonPt = [number, number];

/**
 * Where a train is on the map: along its line's real towns (a → b, turned for
 * the other way) by the time on the run, at the border half way, at a stop on
 * its terminal; standing at its terminal when it has no run.
 */
export function trainPosition(train: Pick<Train, 'at' | 'run'>, lines: Map<string, LatLonPt[]>, places: Map<number, LatLonPt>, now: number): LatLonPt | null {
  const run = train.run;
  if (!run || now >= new Date(run.arriveAt).getTime()) return places.get(run && now >= new Date(run.arriveAt).getTime() ? run.to : train.at) ?? null;
  const { leg } = runProgress(run, now);
  if (!leg) return places.get(train.at) ?? null;
  if (leg.kind === 'stop') return places.get(leg.from) ?? null;
  const line = leg.lineId ? railLine(leg.lineId) : null;
  const coords = line ? lines.get(line.id) : null;
  if (!line || !coords?.length) return places.get(leg.from) ?? null;
  const way = leg.from === line.a ? coords : [...coords].reverse();
  let frac = 0.5;
  if (leg.kind === 'run') {
    const parts = run.legs.filter((l) => l.kind === 'run' && l.lineId === leg.lineId && l.from === leg.from);
    const i = parts.indexOf(leg);
    frac = (i + Math.min(1, Math.max(0, (now - leg.start) / Math.max(1, leg.end - leg.start)))) / parts.length;
  }
  return along(way, frac);
}

/** A point at a share of a polyline's length (flat distances are enough at this scale). */
function along(points: LatLonPt[], frac: number): LatLonPt {
  if (points.length < 2) return points[0]!;
  const k = Math.cos((points[0]![0] * Math.PI) / 180);
  const seg = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i]![0], (p[1] - points[i]![1]) * k));
  let left = seg.reduce((s, d) => s + d, 0) * frac;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i]! || i === seg.length - 1) {
      const f = seg[i]! ? Math.min(1, left / seg[i]!) : 0;
      const a = points[i]!, b = points[i + 1]!;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    left -= seg[i]!;
  }
  return points[points.length - 1]!;
}
