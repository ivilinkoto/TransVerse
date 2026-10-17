/**
 * Weekly leagues: every week players compete in groups of up to 20 in their
 * tier. Points are the season points of the week's deliveries. The best move
 * up a tier, the last move down; the top three are rewarded.
 */
export const LEAGUE_TIERS = [
  { name: 'Бронз', color: '#cd7f32', mult: 1 },
  { name: 'Сребро', color: '#c0c7d1', mult: 1.5 },
  { name: 'Злато', color: '#f6c343', mult: 2 },
  { name: 'Платина', color: '#7dd3fc', mult: 3 },
  { name: 'Диамант', color: '#c084fc', mult: 4 },
] as const;
export const TOP_TIER = LEAGUE_TIERS.length - 1;
export const LEAGUE_GROUP_SIZE = 20;

/** Rewards for places 1–3 in Bronze; higher tiers multiply them. */
export const LEAGUE_PRIZES = [
  { cents: 3_000_00, coins: 20 },
  { cents: 2_000_00, coins: 10 },
  { cents: 1_000_00, coins: 5 },
] as const;

export function leaguePrize(tier: number, rank: number) {
  const base = LEAGUE_PRIZES[rank - 1];
  if (!base) return null;
  const mult = LEAGUE_TIERS[tier]?.mult ?? 1;
  return { cents: Math.round(base.cents * mult), coins: Math.round(base.coins * mult) };
}

/** How many move up / down in a group of n players who scored. */
export const promoteCount = (n: number) => Math.min(5, Math.ceil(n / 4));
export const demoteCount = (n: number) => (n < 4 ? 0 : Math.min(5, Math.floor(n / 4)));

export function outcomeFor(tier: number, rank: number, n: number): 'up' | 'down' | 'stay' {
  if (tier < TOP_TIER && rank <= promoteCount(n)) return 'up';
  if (tier > 0 && rank > n - demoteCount(n)) return 'down';
  return 'stay';
}

const sofiaParts = (t: number) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday as string };
};

/** UTC instant of 00:00 Sofia time on a calendar date (YYYY-MM-DD). */
export function sofiaMidnight(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  for (const offset of [3, 2]) {
    const t = Date.UTC(y, m - 1, d) - offset * 3_600_000;
    const p = sofiaParts(t);
    if (p.date === date && p.hour === 0) return t;
  }
  return Date.UTC(y, m - 1, d) - 2 * 3_600_000;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The league week (Monday, Sofia) a moment belongs to, e.g. W2026-10-12. */
export function weekKey(now: Date): string {
  const p = sofiaParts(now.getTime());
  const back = DAYS.indexOf(p.weekday);
  const [y, m, d] = p.date.split('-').map(Number) as [number, number, number];
  const monday = new Date(Date.UTC(y, m - 1, d - back));
  return `W${monday.toISOString().slice(0, 10)}`;
}

/** When a league week ends: the next Monday 00:00 Sofia. */
export function weekEndsAt(key: string): Date {
  const start = new Date(`${key.slice(1)}T12:00:00Z`);
  const next = new Date(start.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  return new Date(sofiaMidnight(next));
}
