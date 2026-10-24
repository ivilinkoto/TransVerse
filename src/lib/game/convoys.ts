import { sofiaMidnight, sofiaParts } from './missions';
import type { Segment } from './schedule';

/**
 * Organized convoys (v1.10) — they replace the old automatic convoy bonuses.
 *
 * A leader opens a convoy on one lane (city A → city B) with a departure
 * time and a number of seats: a personal one (open to all, to friends only,
 * or by link) or a company one (members only). Each truck joins with its
 * own load on the same lane, or with a part of the convoy's shared load.
 * At the departure time every truck that is ready in city A leaves at once
 * and the column drives at the pace of the slowest truck: all arrive
 * together. On arrival the bonus is shared out:
 * - +2 % per truck in the column (from 2 trucks: +4 %, up to +12 % at 6+),
 *   for each truck that arrives on time;
 * - +5 % more for everyone when every truck is on time;
 * - a company convoy: no contribution to the treasury and ×1.5 company XP;
 * - roles: the leader +2 %, the tail and the scout +1 %;
 * - no road incidents for a column (it looks after itself).
 * Against abuse: only different players from level 3, at most 3 convoy
 * bonuses a day, and every truck must carry a real load.
 */
export const CONVOYS = {
  minTrucks: 2,
  seats: { min: 2, max: 12 },
  /** Departure between 15 minutes and 24 hours from now. */
  departMinMin: 15,
  departMaxHours: 24,
  /** A truck may still join this close to the departure. */
  joinUntilMin: 1,
  perTruckShare: 0.02,
  maxShare: 0.12,
  allOnTimeShare: 0.05,
  leaderShare: 0.02,
  roleShare: 0.01,
  companyXp: 1.5,
  minLevel: 3,
  bonusesPerDay: 3,
  /** The shared load: tonnes per truck and pay over an ordinary load. */
  sharedTons: { min: 6, max: 24 },
  sharedMultiplier: 1.1,
  messageMax: 200,
  /** The game's own convoy: Sunday 20:00 (Sofia), many seats. */
  weekly: { weekday: 0, hour: 20, seats: 20, openHours: 30 },
  /** Challenges and badges. */
  streakBadge: 5,
  countriesBadge: 4,
} as const;

export type ConvoyKind = 'personal' | 'company' | 'official';
export type ConvoyAccess = 'open' | 'friends' | 'link';
export type ConvoyRole = 'leader' | 'tail' | 'scout' | 'member';

export const CONVOY_ROLES: Record<ConvoyRole, { label: string; emoji: string; text: string }> = {
  leader: { label: 'Водач', emoji: '🚩', text: 'Води колоната: +2 % и точки водач.' },
  tail: { label: 'Опашка', emoji: '🛡️', text: 'Последният камион — пази колоната: +1 %.' },
  scout: { label: 'Разузнавач', emoji: '🔭', text: 'Следи пътните сигнали по линията: +1 %.' },
  member: { label: 'В колоната', emoji: '🚚', text: 'Кара в колоната.' },
};

export const ACCESS_LABELS: Record<ConvoyAccess, string> = { open: 'Отворен за всички', friends: 'Само за приятели', link: 'С линк' };

/** The leader's standing grows with the convoys they led (more seats). */
export const LEADER_TIERS = [
  { min: 0, name: 'Нов водач', seats: 4 },
  { min: 5, name: 'Водач', seats: 6 },
  { min: 20, name: 'Опитен водач', seats: 8 },
  { min: 50, name: 'Легендарен водач', seats: 12 },
] as const;

export function leaderTier(led: number) {
  let i = 0;
  LEADER_TIERS.forEach((t, k) => {
    if (led >= t.min) i = k;
  });
  return { tier: i, ...LEADER_TIERS[i]! };
}

/** The column's share by its size (on time). */
export const columnShare = (trucks: number) => (trucks < CONVOYS.minTrucks ? 0 : Math.min(CONVOYS.maxShare, trucks * CONVOYS.perTruckShare));

/** Everything one truck gets on arrival, as a share of its reward. */
export function convoyShare(o: { trucks: number; onTime: boolean; allOnTime: boolean; role: ConvoyRole }) {
  if (!o.onTime || o.trucks < CONVOYS.minTrucks) return 0;
  const role = o.role === 'leader' ? CONVOYS.leaderShare : o.role === 'member' ? 0 : CONVOYS.roleShare;
  return columnShare(o.trucks) + (o.allOnTime ? CONVOYS.allOnTimeShare : 0) + role;
}

/**
 * Drives a truck's schedule at the column's pace: every segment is stretched
 * in proportion so that the trip ends at `endMs` (the slowest truck's arrival).
 */
export function stretchSchedule(segments: Segment[], startMs: number, endMs: number): Segment[] {
  const last = segments.length ? segments[segments.length - 1]!.end : startMs;
  const span = last - startMs;
  if (span <= 0 || endMs <= last) return segments;
  const k = (endMs - startMs) / span;
  const at = (t: number) => Math.round(startMs + (t - startMs) * k);
  return segments.map((s) => ({ ...s, start: at(s.start), end: at(s.end) }));
}

/** When the game's weekly convoy leaves: the next Sunday 20:00 in Sofia. */
export function nextWeeklyDeparture(now: Date) {
  const { y, m, d } = sofiaParts(now);
  for (let add = 0; add <= 7; add++) {
    const day = new Date(Date.UTC(y, m - 1, d + add));
    if (day.getUTCDay() !== CONVOYS.weekly.weekday) continue;
    const at = new Date(sofiaMidnight(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()).getTime() + CONVOYS.weekly.hour * 3_600_000);
    if (at > now) return at;
  }
  const next = new Date(Date.UTC(y, m - 1, d + 7));
  return new Date(sofiaMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()).getTime() + CONVOYS.weekly.hour * 3_600_000);
}
