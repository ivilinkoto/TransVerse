import { haversineKm } from '@/lib/geo/geometry';

/**
 * Ferries and trains (v1.4 „Отвъд пътя“). The lines are real — ferries from
 * Piraeus to the islands, intermodal trains on real rail corridors between
 * real terminals — the timetable and the prices are game data (labelled so
 * in the game). On a crossing the truck rides on board: no fuel, tolls or
 * wear for that part, the driver rests, and a ticket is paid instead.
 */

export type CrossingKind = 'ferry' | 'rail';

export interface CrossingLine {
  id: string;
  kind: CrossingKind;
  /** GeoNames ids of the two terminals (the line runs both ways). */
  a: number;
  b: number;
  aName: string;
  bName: string;
  /** Length on water / rail, km (real distance of the line, rounded). */
  km: number;
  /** Real sailing / train time, hours (the driver rests meanwhile). */
  hours: number;
  /** Countries the line passes (licences, road conditions). */
  countries: string[];
  /** Ticket for a truck, cents (game data). */
  ticketCents: number;
}

export const CROSSING_LINES: CrossingLine[] = [
  { id: 'piraeus-heraklion', kind: 'ferry', a: 255274, b: 261745, aName: 'Пирея', bName: 'Ираклио', km: 325, hours: 9, countries: ['GR'], ticketCents: 520_00 },
  { id: 'piraeus-chania', kind: 'ferry', a: 255274, b: 260114, aName: 'Пирея', bName: 'Ханя', km: 285, hours: 9, countries: ['GR'], ticketCents: 480_00 },
  { id: 'piraeus-rhodes', kind: 'ferry', a: 255274, b: 400666, aName: 'Пирея', bName: 'Родос', km: 455, hours: 15, countries: ['GR'], ticketCents: 690_00 },
  { id: 'piraeus-kos', kind: 'ferry', a: 255274, b: 259245, aName: 'Пирея', bName: 'Кос', km: 375, hours: 11, countries: ['GR'], ticketCents: 590_00 },
  { id: 'piraeus-mytilene', kind: 'ferry', a: 255274, b: 256866, aName: 'Пирея', bName: 'Митилини', km: 345, hours: 12, countries: ['GR'], ticketCents: 560_00 },
  { id: 'piraeus-chios', kind: 'ferry', a: 255274, b: 259973, aName: 'Пирея', bName: 'Хиос', km: 285, hours: 8, countries: ['GR'], ticketCents: 470_00 },
  { id: 'hamburg-munich', kind: 'rail', a: 2911298, b: 2867714, aName: 'Хамбург', bName: 'Мюнхен', km: 790, hours: 14, countries: ['DE'], ticketCents: 690_00 },
  { id: 'hamburg-budapest', kind: 'rail', a: 2911298, b: 3054643, aName: 'Хамбург', bName: 'Будапеща', km: 1_250, hours: 30, countries: ['DE', 'AT', 'HU'], ticketCents: 1_050_00 },
  { id: 'duisburg-vienna', kind: 'rail', a: 2934691, b: 2761369, aName: 'Дуисбург', bName: 'Виена', km: 1_080, hours: 24, countries: ['DE', 'AT'], ticketCents: 930_00 },
  { id: 'wels-szeged', kind: 'rail', a: 2761524, b: 715429, aName: 'Велс', bName: 'Сегед', km: 520, hours: 10, countries: ['AT', 'HU'], ticketCents: 470_00 },
  { id: 'budapest-constanta', kind: 'rail', a: 3054643, b: 680963, aName: 'Будапеща', bName: 'Кюстенджа', km: 1_010, hours: 30, countries: ['HU', 'RO'], ticketCents: 880_00 },
  { id: 'duisburg-istanbul', kind: 'rail', a: 2934691, b: 742394, aName: 'Дуисбург', bName: 'Истанбул (Халкалъ)', km: 2_560, hours: 72, countries: ['DE', 'AT', 'HU', 'RS', 'BG', 'TR'], ticketCents: 1_950_00 },
];

export const crossingLine = (id: string) => CROSSING_LINES.find((l) => l.id === id) ?? null;

/** "Ферибот Пирея → Ираклио" in the direction of travel. */
export const crossingNote = (line: CrossingLine, reversed: boolean) => `${line.kind === 'ferry' ? 'Ферибот' : 'Влак'} ${reversed ? line.bName : line.aName} → ${reversed ? line.aName : line.bName}`;

/** Islands reached only by ferry (bounding boxes of the real islands) and their lines. */
export const ISLANDS = [
  { id: 'crete', name: 'Крит', box: [34.8, 23.4, 35.75, 26.4], lines: ['piraeus-heraklion', 'piraeus-chania'] },
  { id: 'rhodes', name: 'Родос', box: [35.85, 27.65, 36.5, 28.3], lines: ['piraeus-rhodes'] },
  { id: 'kos', name: 'Кос', box: [36.65, 26.9, 36.95, 27.4], lines: ['piraeus-kos'] },
  { id: 'lesvos', name: 'Лесбос', box: [38.95, 25.8, 39.45, 26.7], lines: ['piraeus-mytilene'] },
  { id: 'chios', name: 'Хиос', box: [38.1, 25.8, 38.65, 26.2], lines: ['piraeus-chios'] },
] as const;

export function islandOf(p: { lat: number; lon: number }) {
  return ISLANDS.find(({ box: [s, w, n, e] }) => p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e) ?? null;
}

/** Game timetable: ferries leave every full hour, trains every half hour (Sofia clock). */
export const DEPARTURE_EVERY_MIN: Record<CrossingKind, number> = { ferry: 60, rail: 30 };
/** Game minutes on board: a ferry hour is 3 game minutes, a train km 0.04 (cheaper in time than the road's 0.09). */
export const onBoardGameMinutes = (line: CrossingLine) => Math.max(10, Math.round(line.kind === 'ferry' ? line.hours * 3 : line.km * 0.04));
/** Boarding before the departure, game minutes. */
export const BOARDING_GAME_MIN = 5;

/** The next departure at or after `t` (epoch ms) for a line kind. */
export function nextDeparture(kind: CrossingKind, t: number): number {
  const every = DEPARTURE_EVERY_MIN[kind] * 60_000;
  return Math.ceil(t / every) * every;
}

/**
 * A train worth taking between two cities: the road to the first terminal and
 * from the second one together are short next to the rail part, and the whole
 * way is not much longer than the direct road (straight lines, for planning).
 */
export function railOptions(from: { lat: number; lon: number }, to: { lat: number; lon: number }, terminals: Map<number, { lat: number; lon: number }>) {
  const direct = haversineKm([from.lat, from.lon], [to.lat, to.lon]);
  const out: { line: CrossingLine; reversed: boolean; roadKm: number }[] = [];
  for (const line of CROSSING_LINES.filter((l) => l.kind === 'rail')) {
    for (const reversed of [false, true]) {
      const start = terminals.get(reversed ? line.b : line.a);
      const end = terminals.get(reversed ? line.a : line.b);
      if (!start || !end) continue;
      const before = haversineKm([from.lat, from.lon], [start.lat, start.lon]);
      const after = haversineKm([end.lat, end.lon], [to.lat, to.lon]);
      const railStraight = haversineKm([start.lat, start.lon], [end.lat, end.lon]);
      if (before + after <= railStraight * 0.35 && before + railStraight + after <= direct * 1.3 && railStraight >= 300) out.push({ line, reversed, roadKm: before + after });
    }
  }
  return out.sort((x, y) => x.roadKm - y.roadKm);
}
