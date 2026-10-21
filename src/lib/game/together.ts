/**
 * Rules of the v1.3 "together" update (game data): shared loads, the load of
 * the day, duels, the monthly livery contest and Discord level frames.
 */

/** A big load a member shares with the company: members take parts; all parts on time → a bonus each. */
export const SHARED_LOAD = {
  /** Only loads at least this big are worth sharing. */
  minTons: 8,
  /** Bonus on each part's pay when every part arrives on time. */
  bonusShare: 0.1,
  /** Open shared loads per company at once. */
  maxOpen: 2,
} as const;

/** "Товар на деня": one well-paid load a day from 12:00, first come first served. */
export const DAILY_LOAD = {
  hour: 12,
  multiplier: 1.6,
  /** ТрансКоин for delivering it on time. */
  coins: 10,
  ttlHours: 10,
  minKm: 250,
  maxKm: 900,
  /** Cargo most players can carry. */
  cargo: ['pallets', 'refrigerated', 'bulk', 'container'] as const,
} as const;

/** One-on-one duel: who hauls more tonnes in a week. */
export const DUEL = {
  days: 7,
  /** ТрансКоин for the winner. */
  coins: 20,
  /** An invitation waits this long. */
  pendingHours: 24,
  /** Pending and running duels per player. */
  maxOpen: 3,
  badge: 'duelist',
} as const;

/** Livery contest: one truck per player a month, 👍 from other players; the winner on the 1st. */
export const LIVERY_CONTEST = {
  coins: 100,
  minVotes: 3,
  badge: 'livery-star',
  /** The winner is announced from this hour (Sofia) on the 1st. */
  hour: 10,
} as const;

/** Frames around the profile picture for the Discord server level (linked players). */
export const DISCORD_FRAMES = [
  { level: 25, badge: 'discord-25' },
  { level: 10, badge: 'discord-10' },
] as const;

const fmt = (now: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', ...opts }).format(now);

/** "2026-12-14" in Sofia. */
export const sofiaDate = (now: Date) => fmt(now, { year: 'numeric', month: '2-digit', day: '2-digit' });
/** "2026-12" in Sofia. */
export const sofiaMonth = (now: Date) => fmt(now, { year: 'numeric', month: '2-digit' });
export const sofiaHourOf = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23' }).format(now));

/** The month before "2026-12" → "2026-11". */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Winner of a duel by tonnes (null on a draw). */
export function duelWinner(d: { challengerId: string; opponentId: string; challengerTons: number; opponentTons: number }): string | null {
  if (Math.abs(d.challengerTons - d.opponentTons) < 0.05) return null;
  return d.challengerTons > d.opponentTons ? d.challengerId : d.opponentId;
}
