/**
 * 1.2.5 „Първи сняг“: the first named season (from 13 November 2026) and what
 * comes with it — the pass of version 2, weekly pass tasks, titles, clearing
 * the roads together and „Крал на снега“. Game data.
 */
export const FIRST_SNOW = {
  /** A season that starts inside this window takes this name and theme. */
  name: 'Първи сняг',
  theme: 'first_snow',
  from: '2026-11-10T00:00:00+02:00',
  to: '2026-12-10T00:00:00+02:00',
  paintColor: '#93c5fd',
  truck: 'rila-nordik-plow',
} as const;

/** Titles: a name shown next to the player in the chat and the rankings (one at a time). */
export const TITLES: Record<string, { label: string; color: string }> = {
  'first-snow-icebreaker': { label: 'Ледоразбивач', color: '#7dd3fc' },
  'first-snow-50': { label: 'Покорител на първия сняг', color: '#e0f2fe' },
  'snow-king': { label: 'Крал на снега', color: '#fde68a' },
  'snow-prince': { label: 'Принц на снега', color: '#cbd5e1' },
  'road-clearer': { label: 'Разчиствач на пътища', color: '#fbbf24' },
};
export const isTitle = (id: string) => id in TITLES;

/** Weekly pass tasks: three a week from this list (the same for everybody), each worth pass points. */
export type PassTaskKind = 'deliveries' | 'km' | 'ontime' | 'reefer' | 'convoy' | 'countries' | 'long' | 'winter' | 'heavy';
export interface PassTask { id: string; kind: PassTaskKind; target: number; label: string }
export const PASS_TASKS: PassTask[] = [
  { id: 'deliveries-15', kind: 'deliveries', target: 15, label: 'Направи 15 доставки' },
  { id: 'km-3000', kind: 'km', target: 3_000, label: 'Измини 3 000 км с товар' },
  { id: 'ontime-10', kind: 'ontime', target: 10, label: '10 доставки навреме' },
  { id: 'reefer-3', kind: 'reefer', target: 3, label: 'Достави 3 хладилни товара' },
  { id: 'convoy-2', kind: 'convoy', target: 2, label: 'Карай 2 курса в конвой' },
  { id: 'countries-3', kind: 'countries', target: 3, label: 'Достави в 3 различни държави' },
  { id: 'long-2', kind: 'long', target: 2, label: '2 курса над 800 км' },
  { id: 'winter-4', kind: 'winter', target: 4, label: 'Достави 4 зимни товара' },
  { id: 'heavy-200', kind: 'heavy', target: 200, label: 'Превози 200 тона' },
];
export const PASS_TASK = { perWeek: 3, points: 3_000 } as const;

/** The three tasks of an ISO week, chosen the same way for everybody (winter loads only in weeks that reach their dates). */
export function weekTasks(week: string, winterOk = true): PassTask[] {
  let h = 0;
  for (const ch of week) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  const pool = PASS_TASKS.filter((x) => winterOk || x.kind !== 'winter');
  const out: PassTask[] = [];
  while (out.length < PASS_TASK.perWeek && pool.length) {
    h = (h * 1103515245 + 12345) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0]!);
  }
  return out;
}

/** What one delivery adds to each kind of task. */
export function taskIncrements(f: { loadedKm: number; late: boolean; cargoType: string; convoy: boolean; destCountry: string; tons: number; holiday: string | null }, seen: string[]): Record<PassTaskKind, number> {
  return {
    deliveries: 1,
    km: Math.round(f.loadedKm),
    ontime: f.late ? 0 : 1,
    reefer: f.cargoType === 'refrigerated' ? 1 : 0,
    convoy: f.convoy ? 1 : 0,
    countries: seen.includes(f.destCountry) ? 0 : 1,
    long: f.loadedKm >= 800 ? 1 : 0,
    winter: f.holiday === 'winter' || f.holiday === 'prewinter' ? 1 : 0,
    heavy: Math.round(f.tons),
  };
}

/**
 * Clearing the roads together: salt, sand and lye delivered to a country under
 * snow, ice or a blizzard count for the day; at this many tonnes the roads there
 * are one step easier for the rest of the day (a blizzard becomes ice, ice snow,
 * snow clear) and everyone who helped gets pass points.
 */
export const PLOW = {
  tonsPerDay: 150,
  goods: ['Сол за пътищата', 'Пясък за опесъчаване', 'Луга за тротоари', 'Пясък за зимно поддържане'],
  pointsPerTon: 40,
  /** „Разчиствач на пътища“: tonnes cleared in a season for the title. */
  titleTons: 300,
} as const;

/** „Крал на снега“: tonnes delivered through snow, ice or closed passes in the season; the top three get titles. */
export const SNOW_KING = { places: [{ title: 'snow-king', coins: 150 }, { title: 'snow-prince', coins: 80 }, { title: 'snow-prince', coins: 50 }] } as const;
export const SNOW_EVENTS = ['snow', 'ice', 'pass_closed'] as const;
