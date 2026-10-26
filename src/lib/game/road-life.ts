import { hash } from './missions';

/**
 * Life along the road (v1.8):
 * - Postcards: a loaded trip whose real route passes within 10 km of a real
 *   landmark brings its postcard into the player's collection (coordinates
 *   are the landmarks' own; the cards are drawn by the game).
 * - Hitchhikers: now and then someone waves at the edge of the town where a
 *   trip starts. Take them along (within half an hour) and they pay a little
 *   on arrival. The people are fictional.
 */
export interface Landmark {
  id: string;
  name: string;
  country: string;
  emoji: string;
  lat: number;
  lon: number;
}

export const LANDMARKS: Landmark[] = [
  { id: 'rila-monastery', name: 'Рилски манастир', country: 'BG', emoji: '⛪', lat: 42.1335, lon: 23.3403 },
  { id: 'plovdiv-theatre', name: 'Античният театър в Пловдив', country: 'BG', emoji: '🏛️', lat: 42.1467, lon: 24.751 },
  { id: 'tsarevets', name: 'Царевец, Велико Търново', country: 'BG', emoji: '🏰', lat: 43.0843, lon: 25.6524 },
  { id: 'belogradchik', name: 'Белоградчишките скали', country: 'BG', emoji: '🪨', lat: 43.6237, lon: 22.683 },
  { id: 'nessebar', name: 'Старият Несебър', country: 'BG', emoji: '⛵', lat: 42.659, lon: 27.7356 },
  { id: 'bran', name: 'Замъкът Бран', country: 'RO', emoji: '🏰', lat: 45.5149, lon: 25.3672 },
  { id: 'palace-parliament', name: 'Дворецът на парламента, Букурещ', country: 'RO', emoji: '🏛️', lat: 44.4275, lon: 26.0875 },
  { id: 'acropolis', name: 'Акрополът', country: 'GR', emoji: '🏛️', lat: 37.9715, lon: 23.7257 },
  { id: 'meteora', name: 'Метеора', country: 'GR', emoji: '⛰️', lat: 39.7217, lon: 21.6306 },
  { id: 'white-tower', name: 'Бялата кула, Солун', country: 'GR', emoji: '🗼', lat: 40.6264, lon: 22.9484 },
  { id: 'hagia-sophia', name: 'Света София, Истанбул', country: 'TR', emoji: '🕌', lat: 41.0086, lon: 28.9802 },
  { id: 'kalemegdan', name: 'Калемегдан, Белград', country: 'RS', emoji: '🏰', lat: 44.8231, lon: 20.45 },
  { id: 'ohrid', name: 'Самуиловата крепост, Охрид', country: 'MK', emoji: '🏞️', lat: 41.1172, lon: 20.7944 },
  { id: 'budapest-parliament', name: 'Парламентът в Будапеща', country: 'HU', emoji: '🏛️', lat: 47.507, lon: 19.0456 },
  { id: 'schonbrunn', name: 'Дворецът Шьонбрун, Виена', country: 'AT', emoji: '🏰', lat: 48.1845, lon: 16.3122 },
  { id: 'neuschwanstein', name: 'Замъкът Нойшванщайн', country: 'DE', emoji: '🏰', lat: 47.5576, lon: 10.7498 },
  { id: 'brandenburg-gate', name: 'Бранденбургската врата, Берлин', country: 'DE', emoji: '🏛️', lat: 52.5163, lon: 13.3777 },
  { id: 'cologne-cathedral', name: 'Кьолнската катедрала', country: 'DE', emoji: '⛪', lat: 50.9413, lon: 6.9583 },
  { id: 'wawel', name: 'Вавел, Краков', country: 'PL', emoji: '🏰', lat: 50.054, lon: 19.9354 },
  { id: 'charles-bridge', name: 'Карловият мост, Прага', country: 'CZ', emoji: '🌉', lat: 50.0865, lon: 14.4114 },
  { id: 'bratislava-castle', name: 'Братиславският замък', country: 'SK', emoji: '🏰', lat: 48.1421, lon: 17.1003 },
  { id: 'bled', name: 'Бледското езеро', country: 'SI', emoji: '🏞️', lat: 46.3636, lon: 14.0938 },
  { id: 'dubrovnik', name: 'Старият град на Дубровник', country: 'HR', emoji: '🏰', lat: 42.6407, lon: 18.1077 },
  { id: 'plitvice', name: 'Плитвишките езера', country: 'HR', emoji: '💧', lat: 44.8654, lon: 15.582 },
  { id: 'mostar', name: 'Старият мост, Мостар', country: 'BA', emoji: '🌉', lat: 43.3373, lon: 17.815 },
  { id: 'kotor', name: 'Котор', country: 'ME', emoji: '⛵', lat: 42.4247, lon: 18.7712 },
  { id: 'berat', name: 'Берат', country: 'AL', emoji: '🏘️', lat: 40.7058, lon: 19.9522 },
  { id: 'prizren', name: 'Призрен', country: 'XK', emoji: '🕌', lat: 42.2139, lon: 20.7397 },
  { id: 'colosseum', name: 'Колизеумът, Рим', country: 'IT', emoji: '🏟️', lat: 41.8902, lon: 12.4922 },
  { id: 'pisa', name: 'Наклонената кула в Пиза', country: 'IT', emoji: '🗼', lat: 43.723, lon: 10.3966 },
  { id: 'venice', name: 'Площад „Сан Марко“, Венеция', country: 'IT', emoji: '🚤', lat: 45.434, lon: 12.3388 },
  { id: 'eiffel', name: 'Айфеловата кула', country: 'FR', emoji: '🗼', lat: 48.8584, lon: 2.2945 },
  { id: 'mont-saint-michel', name: 'Мон Сен Мишел', country: 'FR', emoji: '🏰', lat: 48.6361, lon: -1.5115 },
  { id: 'sagrada-familia', name: 'Саграда Фамилия, Барселона', country: 'ES', emoji: '⛪', lat: 41.4036, lon: 2.1744 },
  { id: 'alhambra', name: 'Алхамбра, Гранада', country: 'ES', emoji: '🏰', lat: 37.1761, lon: -3.5881 },
  { id: 'belem', name: 'Кулата Белем, Лисабон', country: 'PT', emoji: '🗼', lat: 38.6916, lon: -9.216 },
  { id: 'kinderdijk', name: 'Вятърните мелници на Киндердейк', country: 'NL', emoji: '🌬️', lat: 51.8833, lon: 4.639 },
  { id: 'atomium', name: 'Атомиумът, Брюксел', country: 'BE', emoji: '⚛️', lat: 50.8949, lon: 4.3415 },
  { id: 'luxembourg-bock', name: 'Казематите Бок, Люксембург', country: 'LU', emoji: '🏰', lat: 49.6116, lon: 6.1366 },
  { id: 'chillon', name: 'Замъкът Шийон', country: 'CH', emoji: '🏰', lat: 46.4142, lon: 6.9275 },
  // v2.0: the east and the Caucasus.
  { id: 'red-square', name: 'Червеният площад, Москва', country: 'RU', emoji: '🏰', lat: 55.7539, lon: 37.6208 },
  { id: 'hermitage', name: 'Ермитажът, Санкт Петербург', country: 'RU', emoji: '🏛️', lat: 59.9398, lon: 30.3146 },
  { id: 'kazan-kremlin', name: 'Казанският кремъл', country: 'RU', emoji: '🕌', lat: 55.7986, lon: 49.1064 },
  { id: 'pechersk-lavra', name: 'Киево-Печерската лавра', country: 'UA', emoji: '⛪', lat: 50.4347, lon: 30.5572 },
  { id: 'lviv-old-town', name: 'Старият град на Лвов', country: 'UA', emoji: '🏘️', lat: 49.8419, lon: 24.0315 },
  { id: 'mir-castle', name: 'Мирският замък', country: 'BY', emoji: '🏰', lat: 53.4513, lon: 26.4729 },
  { id: 'trakai', name: 'Замъкът Тракай', country: 'LT', emoji: '🏰', lat: 54.6522, lon: 24.9336 },
  { id: 'riga-old-town', name: 'Старата Рига', country: 'LV', emoji: '⛪', lat: 56.9475, lon: 24.1069 },
  { id: 'tallinn-old-town', name: 'Старият град на Талин', country: 'EE', emoji: '🏰', lat: 59.437, lon: 24.745 },
  { id: 'orheiul-vechi', name: 'Стария Орхей', country: 'MD', emoji: '⛰️', lat: 47.3036, lon: 28.9614 },
  { id: 'narikala', name: 'Нарикала, Тбилиси', country: 'GE', emoji: '🏰', lat: 41.6878, lon: 44.8086 },
  { id: 'jvari', name: 'Манастирът Джвари, Мцхета', country: 'GE', emoji: '⛪', lat: 41.8383, lon: 44.7333 },
  { id: 'yerevan-cascade', name: 'Каскадата, Ереван', country: 'AM', emoji: '🪜', lat: 40.1912, lon: 44.5152 },
  { id: 'khor-virap', name: 'Хор Вирап', country: 'AM', emoji: '⛪', lat: 39.8783, lon: 44.5761 },
];

export const POSTCARDS = { radiusKm: 10, xp: 100, coins: 3, badges: { 10: 'postcards-10', [LANDMARKS.length]: 'postcards-all' } as Record<number, string> } as const;

/** The landmarks a polyline passes within `radiusKm` of (cheap: a bounding box first, then every point). */
export function landmarksAlong(points: readonly [number, number][], radiusKm: number = POSTCARDS.radiusKm, landmarks: readonly Landmark[] = LANDMARKS): Landmark[] {
  if (!points.length) return [];
  const pad = radiusKm / 80; // ≥ radius in degrees of longitude up to ~55°N
  let [minLat, maxLat, minLon, maxLon] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [la, lo] of points) {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo;
    if (lo > maxLon) maxLon = lo;
  }
  const near = landmarks.filter((l) => l.lat >= minLat - pad && l.lat <= maxLat + pad && l.lon >= minLon - pad && l.lon <= maxLon + pad);
  if (!near.length) return [];
  // Long straight pieces (approximate lines) are checked every few kilometres.
  const dense: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    dense.push(a);
    const b = points[i + 1];
    if (!b) break;
    const steps = Math.floor(kmBetween(a, b) / 3);
    for (let s = 1; s < steps; s++) dense.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }
  return near.filter((l) => dense.some((p) => kmBetween(p, [l.lat, l.lon]) <= radiusKm));
}

function kmBetween(a: readonly [number, number], b: readonly [number, number]) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// ── Hitchhikers ──────────────────────────────────────────────────────────

/** Fictional people waving at the roadside: who they are and what they say on arrival. */
export const HITCHHIKERS = [
  { name: 'Мария', who: 'студентка с раница', bye: 'Мария стигна навреме за изпита и ти махна от прозореца на университета.' },
  { name: 'Иван', who: 'музикант с китара', bye: 'Иван ти изсвири една песен на паркинга — за късмет по пътя.' },
  { name: 'Баба Пена', who: 'баба с буркани за внуците', bye: 'Баба Пена ти остави буркан лютеница „за из път“.' },
  { name: 'Георги', who: 'турист с огромна карта', bye: 'Георги отбеляза на картата си още една отметка и ти благодари.' },
  { name: 'Елена', who: 'фотографка с тежък статив', bye: 'Елена те снима до камиона — „за изложбата“.' },
  { name: 'Стефан', who: 'шофьор, чийто камион е на сервиз', bye: 'Стефан ти даде съвет за пряк път и номера на добър сервиз.' },
  { name: 'Нина', who: 'медицинска сестра след нощна смяна', bye: 'Нина заспа още на втория километър и се събуди точно навреме.' },
  { name: 'Петър', who: 'рибар с въдици', bye: 'Петър обеща, че следващия път ще ти донесе риба.' },
] as const;

export const HITCHHIKE = {
  /** Share of trips with someone waving at the start. */
  chance: 0.15,
  /** How long they wait for the truck to pick them up (from the trip's start). */
  waitMin: 30,
  centsPerKm: 12,
  minCents: 30_00,
  maxCents: 250_00,
  xp: 60,
} as const;

/** Whether someone waves at the start of this trip, and who (deterministic by the trip). */
export function hitchhikerFor(deliveryId: string): number | null {
  const h = hash(`hitch:${deliveryId}`);
  if ((h % 1000) / 1000 >= HITCHHIKE.chance) return null;
  return Math.floor(h / 1000) % HITCHHIKERS.length;
}

/** What a hitchhiker pays for the ride (by the loaded kilometres). */
export const hitchhikeFare = (km: number) => Math.round(Math.min(HITCHHIKE.maxCents, Math.max(HITCHHIKE.minCents, km * HITCHHIKE.centsPerKm)));
