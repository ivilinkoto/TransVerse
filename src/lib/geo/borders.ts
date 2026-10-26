import { t as tr } from '@/i18n/t';

/**
 * Closed land borders (v2.0), as they are for freight in reality. The game
 * takes no side: a closed border is a fact of the road, like a mountain
 * pass in winter. A route that would cross one goes round it through real,
 * open crossings (`DETOURS`).
 */
export const CLOSED_BORDERS: readonly { a: string; b: string; note: string }[] = [
  { a: 'UA', b: 'RU', note: 'Границата между Украйна и Русия е затворена от 2022 г.' },
  { a: 'UA', b: 'BY', note: 'Границата между Украйна и Беларус е затворена от 2022 г.' },
  { a: 'AM', b: 'TR', note: 'Границата между Армения и Турция е затворена от 1993 г.' },
];

const closed = new Set(CLOSED_BORDERS.flatMap((b) => [`${b.a}-${b.b}`, `${b.b}-${b.a}`]));
export const isClosedBorder = (from: string, to: string) => closed.has(`${from}-${to}`);

/** The first closed border a route crosses, or null. */
export const closedCrossing = (borders: readonly { from: string; to: string }[]) => borders.find((b) => isClosedBorder(b.from, b.to)) ?? null;

/** Why a border is closed (for the route panel). */
export function closedBorderNote(from: string, to: string): string | null {
  const b = CLOSED_BORDERS.find((x) => (x.a === from && x.b === to) || (x.a === to && x.b === from));
  return b ? tr(b.note) : null;
}

/** A real border crossing a detour goes through. */
export interface Waypoint {
  lat: number;
  lon: number;
  /** The border it is on, in the direction of travel. */
  from: string;
  to: string;
  name: string;
}

/**
 * The way round each closed border, from its first country: Ukraine through
 * Poland (Yahodyn–Dorohusk, then Terespol–Brest into Belarus, and on to
 * Russia), Armenia through Georgia (Bagratashen–Sadakhlo, then Vale–Türkgözü).
 */
export const DETOURS: Record<string, readonly Waypoint[]> = {
  'UA-BY': [
    { lat: 51.1906, lon: 23.8064, from: 'UA', to: 'PL', name: 'Ягодин – Дорохуск' },
    { lat: 52.0768, lon: 23.6577, from: 'PL', to: 'BY', name: 'Тереспол – Брест' },
  ],
  'UA-RU': [
    { lat: 51.1906, lon: 23.8064, from: 'UA', to: 'PL', name: 'Ягодин – Дорохуск' },
    { lat: 52.0768, lon: 23.6577, from: 'PL', to: 'BY', name: 'Тереспол – Брест' },
  ],
  'AM-TR': [
    { lat: 41.244, lon: 44.818, from: 'AM', to: 'GE', name: 'Баграташен – Садахло' },
    { lat: 41.5682, lon: 42.7695, from: 'GE', to: 'TR', name: 'Вале – Тюркгьозю' },
  ],
};

/** The crossings to go through instead of a closed border `from` → `to` (in the direction of travel). */
export function detourFor(from: string, to: string): readonly Waypoint[] {
  const ahead = DETOURS[`${from}-${to}`];
  if (ahead) return ahead;
  const back = DETOURS[`${to}-${from}`];
  return back ? [...back].reverse().map((w) => ({ ...w, from: w.to, to: w.from })) : [];
}
