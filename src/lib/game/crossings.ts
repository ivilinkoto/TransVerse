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
  /** v1.7: a sea line between two mainland ports — a choice instead of the road, like a train. */
  optional?: boolean;
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
  // v1.7 "Цяла Европа": the islands of the western Mediterranean (real lines; the mainland port first).
  { id: 'reggio-messina', kind: 'ferry', a: 2523630, b: 2524170, aName: 'Реджо Калабрия', bName: 'Месина', km: 13, hours: 0.5, countries: ['IT'], ticketCents: 60_00 },
  { id: 'naples-palermo', kind: 'ferry', a: 3172394, b: 2523920, aName: 'Неапол', bName: 'Палермо', km: 315, hours: 10, countries: ['IT'], ticketCents: 510_00 },
  { id: 'livorno-olbia', kind: 'ferry', a: 3174659, b: 3172087, aName: 'Ливорно', bName: 'Олбия', km: 280, hours: 8, countries: ['IT'], ticketCents: 460_00 },
  { id: 'genoa-porto-torres', kind: 'ferry', a: 3176219, b: 3170069, aName: 'Генуа', bName: 'Порто Торес', km: 370, hours: 11, countries: ['IT'], ticketCents: 590_00 },
  { id: 'civitavecchia-cagliari', kind: 'ferry', a: 3178587, b: 2525473, aName: 'Чивитавекия', bName: 'Каляри', km: 430, hours: 14, countries: ['IT'], ticketCents: 680_00 },
  { id: 'marseille-ajaccio', kind: 'ferry', a: 2995469, b: 3038334, aName: 'Марсилия', bName: 'Аячо', km: 330, hours: 12, countries: ['FR'], ticketCents: 530_00 },
  { id: 'nice-bastia', kind: 'ferry', a: 2990440, b: 3034640, aName: 'Ница', bName: 'Бастия', km: 200, hours: 6, countries: ['FR'], ticketCents: 340_00 },
  { id: 'barcelona-palma', kind: 'ferry', a: 3128760, b: 2512989, aName: 'Барселона', bName: 'Палма', km: 215, hours: 7, countries: ['ES'], ticketCents: 360_00 },
  { id: 'valencia-palma', kind: 'ferry', a: 2509954, b: 2512989, aName: 'Валенсия', bName: 'Палма', km: 260, hours: 8, countries: ['ES'], ticketCents: 420_00 },
  { id: 'valencia-ibiza', kind: 'ferry', a: 2509954, b: 2516479, aName: 'Валенсия', bName: 'Ибиса', km: 200, hours: 6, countries: ['ES'], ticketCents: 340_00 },
  { id: 'barcelona-mao', kind: 'ferry', a: 3128760, b: 2514301, aName: 'Барселона', bName: 'Маон', km: 240, hours: 9, countries: ['ES'], ticketCents: 400_00 },
  { id: 'barcelona-ciutadella', kind: 'ferry', a: 3128760, b: 3124967, aName: 'Барселона', bName: 'Сиудадела', km: 210, hours: 8, countries: ['ES'], ticketCents: 360_00 },
  // v1.7: sea lines across the Adriatic, the Ionian and the western Mediterranean (real lines), chosen instead of the road.
  { id: 'bari-patras', kind: 'ferry', a: 3182351, b: 255683, aName: 'Бари', bName: 'Патра', km: 560, hours: 16, countries: ['IT', 'GR'], ticketCents: 900_00, optional: true },
  { id: 'ancona-patras', kind: 'ferry', a: 3183089, b: 255683, aName: 'Анкона', bName: 'Патра', km: 1_000, hours: 22, countries: ['IT', 'GR'], ticketCents: 1_450_00, optional: true },
  { id: 'bari-durres', kind: 'ferry', a: 3182351, b: 3185728, aName: 'Бари', bName: 'Дуръс', km: 230, hours: 9, countries: ['IT', 'AL'], ticketCents: 380_00, optional: true },
  { id: 'bari-bar', kind: 'ferry', a: 3182351, b: 3204509, aName: 'Бари', bName: 'Бар', km: 200, hours: 9, countries: ['IT', 'ME'], ticketCents: 340_00, optional: true },
  { id: 'ancona-split', kind: 'ferry', a: 3183089, b: 3190261, aName: 'Анкона', bName: 'Сплит', km: 230, hours: 11, countries: ['IT', 'HR'], ticketCents: 380_00, optional: true },
  { id: 'genoa-barcelona', kind: 'ferry', a: 3176219, b: 3128760, aName: 'Генуа', bName: 'Барселона', km: 650, hours: 19, countries: ['IT', 'ES'], ticketCents: 1_050_00, optional: true },
  { id: 'civitavecchia-barcelona', kind: 'ferry', a: 3178587, b: 3128760, aName: 'Чивитавекия', bName: 'Барселона', km: 520, hours: 20, countries: ['IT', 'ES'], ticketCents: 860_00, optional: true },
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
  // v1.7: Цяла Европа.
  { id: 'sicily', name: 'Сицилия', box: [36.6, 12.3, 38.32, 15.6], lines: ['reggio-messina', 'naples-palermo'] },
  { id: 'sardinia', name: 'Сардиния', box: [38.85, 8.1, 41.3, 9.85], lines: ['livorno-olbia', 'genoa-porto-torres', 'civitavecchia-cagliari'] },
  { id: 'corsica', name: 'Корсика', box: [41.35, 8.5, 43.05, 9.6], lines: ['marseille-ajaccio', 'nice-bastia'] },
  { id: 'mallorca', name: 'Майорка', box: [39.25, 2.3, 39.98, 3.5], lines: ['barcelona-palma', 'valencia-palma'] },
  { id: 'ibiza', name: 'Ибиса', box: [38.6, 1.1, 39.15, 1.65], lines: ['valencia-ibiza'] },
  { id: 'menorca', name: 'Менорка', box: [39.8, 3.75, 40.1, 4.35], lines: ['barcelona-mao', 'barcelona-ciutadella'] },
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
export function railOptions(from: { lat: number; lon: number }, to: { lat: number; lon: number }, terminals: Map<number, { lat: number; lon: number }>, roadKm?: number, sea = false) {
  const direct = haversineKm([from.lat, from.lon], [to.lat, to.lon]);
  const out: { line: CrossingLine; reversed: boolean; roadKm: number }[] = [];
  // v1.7: a sea line is worth it when the road to and from the ports plus the crossing is clearly shorter than the road all the way.
  if (sea && roadKm) {
    for (const line of CROSSING_LINES.filter((l) => l.optional)) {
      for (const reversed of [false, true]) {
        const start = terminals.get(reversed ? line.b : line.a);
        const end = terminals.get(reversed ? line.a : line.b);
        if (!start || !end) continue;
        const before = haversineKm([from.lat, from.lon], [start.lat, start.lon]) * 1.25;
        const after = haversineKm([end.lat, end.lon], [to.lat, to.lon]) * 1.25;
        if (before + line.km + after <= roadKm * 0.8) out.push({ line, reversed, roadKm: before + after });
      }
    }
  }
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
