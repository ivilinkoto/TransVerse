/**
 * 1.4 „Зимни игри на компаниите“: two weeks in December when the companies compete in five
 * disciplines with what their members already play. Every discipline is a ranking of
 * companies; its first three take gold, silver and bronze (and money for the treasury), and
 * the medal table (gold first, then silver, then bronze) decides the champion of the Games.
 * Also „Най-красивата коледна база“: players vote for the bases. Game data.
 */
export const WINTER_GAMES = {
  /** Sofia time; the Games and the base contest run inside this window. */
  from: '2026-12-14T00:00:00+02:00',
  to: '2026-12-28T00:00:00+02:00',
  /** In a daily discipline a company's day counts its best members only, so a big company is not the winner by size alone. */
  topMembers: 5,
  /** Treasury prizes for each discipline: gold, silver, bronze (cents). */
  prizesCents: [30_000_00, 18_000_00, 10_000_00] as const,
  /** The champion of the Games: a title for every member and a prize for the treasury. */
  championCents: 60_000_00,
  championTitle: 'winter-games-champion',
} as const;

export type WinterDiscipline = 'night_run' | 'daily_route' | 'courier' | 'deliveries' | 'builders';
export const DISCIPLINES: { id: WinterDiscipline; label: string; emoji: string; unit: string; about: string }[] = [
  { id: 'night_run', label: 'Нощен рейс', emoji: '🌙', unit: 'м', about: 'Най-далечният рейс на деня на всеки член; брои се сборът на първите 5 за деня.' },
  { id: 'daily_route', label: 'Пътят на деня', emoji: '🧩', unit: '%', about: 'Най-добрият опит на деня на всеки член; първите 5 за деня.' },
  { id: 'courier', label: 'Градски куриер', emoji: '🚐', unit: 'т.', about: 'Най-добрата смяна на деня на всеки член; първите 5 за деня.' },
  { id: 'deliveries', label: 'Тонове на пътя', emoji: '🚚', unit: 'т', about: 'Тоновете, които членовете са доставили; първите 5 членове.' },
  { id: 'builders', label: 'Строители', emoji: '🏗️', unit: 'т', about: 'Тоновете материали за базата на компанията.' },
];

export const inWinterGames = (at: Date) => at >= new Date(WINTER_GAMES.from) && at < new Date(WINTER_GAMES.to);

/** The sum of the best `n` values. */
export const topSum = (values: number[], n: number = WINTER_GAMES.topMembers) => [...values].sort((a, b) => b - a).slice(0, n).reduce((s, v) => s + v, 0);

/** Medal table: gold, then silver, then bronze, then the name — the Olympic way. */
export function medalTable<T extends { gold: number; silver: number; bronze: number; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.name.localeCompare(b.name));
}

/** „Най-красивата коледна база“: one vote a day for a base of another company; the top three get prizes. */
export const BASE_CONTEST = {
  votesPerDay: 1,
  prizesCents: [30_000_00, 15_000_00, 8_000_00] as const,
  title: 'xmas-base',
} as const;
