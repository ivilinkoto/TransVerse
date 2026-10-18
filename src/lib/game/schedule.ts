/**
 * Delivery timeline. A delivery is a deterministic schedule of phases with
 * absolute timestamps, computed once by the server when the job starts.
 * Vehicle positions are derived from it, so nothing has to "tick" while the
 * truck drives — the world keeps moving even when nobody is online.
 */

export const DRIVING_RULES = {
  /** EU 561/2006, simplified: 4.5 h → 45 min break; 9 h per day → 11 h rest. */
  breakAfterMin: 270,
  breakMin: 45,
  dailyDrivingMin: 540,
  dailyRestMin: 660,
  loadingMin: 45,
  unloadingMin: 45,
  borderWaitMin: 60,
} as const;

import { CREW_RULES, dailyLimitMin, type Crew } from './crew';

export type SegmentKind = 'drive' | 'break' | 'rest' | 'border' | 'loading' | 'unloading' | 'incident';
export type LegKind = 'empty' | 'loaded';

export interface Segment {
  kind: SegmentKind;
  leg: LegKind;
  /** Epoch ms */
  start: number;
  end: number;
  /** Distance along the leg (km) at segment start/end. */
  fromKm: number;
  toKm: number;
  /** Short label for an unplanned stop (road events). */
  note?: string;
}

export interface LegInput {
  km: number;
  /** Driving time from the routing engine, seconds. */
  durationS: number;
  /** Positions (km along the leg) of border checkpoints. */
  borderKms: number[];
}

export interface ScheduleInput {
  startAt: number;
  empty: LegInput | null;
  loaded: LegInput;
  /** Vehicle speed relative to the routing profile (vans are faster than trucks). */
  speedFactor: number;
  /** >1 makes everything faster (testing / special events). */
  timeScale: number;
  /** Who drives: hours carried over from the last trip, a team, skills. Default: one rested driver. */
  crew?: Crew;
}

export interface PlannedTrip {
  segments: Segment[];
  /** Driving minutes since the last daily rest when the trip ends. */
  endDutyMin: number;
}

const MIN = 60_000;

export function buildSchedule(input: ScheduleInput): Segment[] {
  return planTrip(input).segments;
}

/** The real-time schedule plus the driving hours it leaves the crew with. */
export function planTrip(input: ScheduleInput): PlannedTrip {
  const segments: Segment[] = [];
  const scale = (minutes: number) => (minutes * MIN) / input.timeScale;
  const crew = input.crew ?? { startDutyMin: 0, team: false, extraDailyMin: 0 };
  // A team swaps at the wheel instead of taking breaks and rests for less.
  const rules = {
    breakAfterMin: crew.team ? Infinity : DRIVING_RULES.breakAfterMin,
    dailyDrivingMin: dailyLimitMin(crew),
    dailyRestMin: crew.team ? CREW_RULES.teamRestMin : DRIVING_RULES.dailyRestMin,
  };
  let t = input.startAt;
  let sinceBreak = 0;
  let today = Math.max(0, crew.startDutyMin);

  const push = (kind: SegmentKind, leg: LegKind, minutes: number, fromKm: number, toKm = fromKm) => {
    if (minutes <= 0) return;
    const end = t + scale(minutes);
    segments.push({ kind, leg, start: t, end, fromKm, toKm });
    t = end;
  };

  const driveLeg = (leg: LegKind, input_: LegInput) => {
    const totalMin = (input_.durationS / 60) / input.speedFactor;
    if (totalMin <= 0 || input_.km <= 0) return;
    const kmPerMin = input_.km / totalMin;
    const borders = [...input_.borderKms].filter((b) => b > 0 && b < input_.km).sort((a, b) => a - b);
    const EPS_MIN = 1e-6; // minutes; guards against floating-point creep near the limits
    let km = 0;
    let guard = 0;
    while (km < input_.km - 1e-6) {
      if (++guard > 10_000) throw new Error('schedule did not converge');
      if (today >= rules.dailyDrivingMin - EPS_MIN) {
        push('rest', leg, rules.dailyRestMin, km);
        today = 0;
        sinceBreak = 0;
      } else if (sinceBreak >= rules.breakAfterMin - EPS_MIN) {
        push('break', leg, DRIVING_RULES.breakMin, km);
        sinceBreak = 0;
      }
      const nextBorder = borders.find((b) => b > km + 1e-6);
      const limitMin = Math.min(rules.breakAfterMin - sinceBreak, rules.dailyDrivingMin - today);
      let targetKm = Math.min(input_.km, km + limitMin * kmPerMin);
      if (nextBorder !== undefined && nextBorder < targetKm) targetKm = nextBorder;
      const minutes = (targetKm - km) / kmPerMin;
      push('drive', leg, minutes, km, targetKm);
      sinceBreak += minutes;
      today += minutes;
      km = targetKm;
      if (nextBorder !== undefined && Math.abs(km - nextBorder) < 1e-6) push('border', leg, DRIVING_RULES.borderWaitMin, km);
    }
  };

  if (input.empty) driveLeg('empty', input.empty);
  push('loading', 'loaded', DRIVING_RULES.loadingMin, 0);
  driveLeg('loaded', input.loaded);
  push('unloading', 'loaded', DRIVING_RULES.unloadingMin, input.loaded.km);
  return { segments, endDutyMin: today };
}

export function scheduleEnd(segments: readonly Segment[]): number {
  return segments.at(-1)?.end ?? 0;
}

export interface ScheduleState {
  segment: Segment | null;
  leg: LegKind;
  km: number;
  done: boolean;
  /** 0..1 progress over the whole schedule. */
  progress: number;
}

export function stateAt(segments: readonly Segment[], now: number): ScheduleState {
  const first = segments[0];
  const last = segments.at(-1);
  if (!first || !last) return { segment: null, leg: 'loaded', km: 0, done: true, progress: 1 };
  if (now >= last.end) return { segment: null, leg: 'loaded', km: last.toKm, done: true, progress: 1 };
  if (now <= first.start) return { segment: first, leg: first.leg, km: first.fromKm, done: false, progress: 0 };
  const segment = segments.find((s) => now >= s.start && now < s.end)!;
  const f = (now - segment.start) / (segment.end - segment.start);
  const km = segment.kind === 'drive' ? segment.fromKm + (segment.toKm - segment.fromKm) * f : segment.fromKm;
  return { segment, leg: segment.leg, km, done: false, progress: (now - first.start) / (last.end - first.start) };
}

/** Planning estimate in minutes for a fresh schedule (used for deadlines and UI). */
export function estimateMinutes(input: Omit<ScheduleInput, 'startAt' | 'timeScale'>): number {
  const segments = buildSchedule({ ...input, startAt: 0, timeScale: 1 });
  return scheduleEnd(segments) / MIN;
}

/**
 * Game time. Short trips keep players coming back: the whole trip is compressed
 * to 10 min + 0.04 min per km (≈15 min for 150 km, ≈30 min for 500 km, ≈1 h for
 * 1 200 km, ≈2 h 10 min for 3 000 km) — always proportional to distance, with
 * no upper cap. Phases keep their real proportions, so breaks, rests and
 * border waits stay visible — just shorter.
 */
export const GAME_TIME = { baseMin: 10, perKmMin: 0.04, minMin: 10, roundToMin: 5 } as const;

/** Bump when GAME_TIME changes: running deliveries are rescaled to the current rules. */
export const SCHEDULE_VERSION = 4;

export function gameDurationMinutes(totalKm: number): number {
  const raw = GAME_TIME.baseMin + GAME_TIME.perKmMin * Math.max(0, totalKm);
  const clamped = Math.max(GAME_TIME.minMin, raw);
  return Math.round(clamped / GAME_TIME.roundToMin) * GAME_TIME.roundToMin;
}

/** Linearly rescales a schedule so it starts at `startAt` and lasts `minutes`. */
export function compressSchedule(segments: readonly Segment[], startAt: number, minutes: number): Segment[] {
  const first = segments[0];
  const last = segments.at(-1);
  if (!first || !last) return [];
  const span = last.end - first.start;
  const factor = span > 0 ? (minutes * MIN) / span : 0;
  return segments.map((s) => ({ ...s, start: startAt + (s.start - first.start) * factor, end: startAt + (s.end - first.start) * factor }));
}

/** Full game-time schedule for a trip (empty leg + loaded leg). */
export function buildGameSchedule(input: Omit<ScheduleInput, 'timeScale'> & { timeScale?: number }): Segment[] {
  return buildGameTrip(input).segments;
}

/**
 * Game-time trip. The game duration follows the distance; the crew stretches
 * or shortens it by how much longer (an early rest) or shorter (a team) the
 * real schedule is than with one rested driver.
 */
export function buildGameTrip(input: Omit<ScheduleInput, 'timeScale'> & { timeScale?: number }): PlannedTrip {
  const real = planTrip({ ...input, timeScale: 1 });
  const km = (input.empty?.km ?? 0) + input.loaded.km;
  const minutes = gameDurationMinutes(km) * crewTimeFactor(input, real.segments);
  return { segments: compressSchedule(real.segments, input.startAt, minutes / (input.timeScale ?? 1)), endDutyMin: real.endDutyMin };
}

function crewTimeFactor(input: Omit<ScheduleInput, 'timeScale'>, real: readonly Segment[]): number {
  const crew = input.crew;
  if (!crew || (!crew.team && crew.startDutyMin <= 0 && crew.extraDailyMin <= 0)) return 1;
  const fresh = buildSchedule({ ...input, crew: undefined, startAt: 0, timeScale: 1 });
  const base = scheduleEnd(fresh) - (fresh[0]?.start ?? 0);
  const span = scheduleEnd(real) - (real[0]?.start ?? 0);
  return base > 0 ? span / base : 1;
}

/** Average truck speed used for planning estimates before a route is known. */
const PLANNING_KMH = 70;

/** Planning estimate of the game minutes of a trip for a given crew (UI; no routes needed). */
export function estimateGameMinutes(emptyKm: number, loadedKm: number, crew?: Crew): number {
  const leg = (km: number): LegInput => ({ km, durationS: (km / PLANNING_KMH) * 3600, borderKms: [] });
  const input = { startAt: 0, empty: emptyKm > 0 ? leg(emptyKm) : null, loaded: leg(Math.max(1, loadedKm)), speedFactor: 1, crew };
  const real = planTrip({ ...input, timeScale: 1 });
  return gameDurationMinutes(emptyKm + loadedKm) * crewTimeFactor(input, real.segments);
}

/** Delivery window offered on a contract, counted from acceptance (allows a typical empty run). */
export function contractWindowMinutes(loadedKm: number): number {
  return Math.round((gameDurationMinutes(loadedKm + 150) * 1.6 + 20) / 5) * 5;
}
