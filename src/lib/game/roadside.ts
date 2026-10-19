import { ROAD_EVENTS, type RoadEventKind } from './road-events';
import type { Segment } from './schedule';

/**
 * Help on the road: when a truck stands after a breakdown, an accident on the
 * ice, snow or a closed pass, a friend or company colleague with a truck
 * nearby may help. The rest of the stop is halved; the helper gets a fee from
 * the roadside assistance (game money), experience and reputation.
 */
export const ROADSIDE = {
  kinds: ['breakdown', 'ice', 'snow', 'pass_closed'] as RoadEventKind[],
  /** The helper's nearest truck must be this close (km, straight line). */
  radiusKm: 150,
  /** Share of the remaining stop that is saved. */
  cut: 0.5,
  /** Help makes sense only while at least this much of the stop is left. */
  minRemainingMs: 60_000,
  feeCents: 1_500_00,
  xp: 150,
  reputation: 1,
  /** Helps per helper in 24 hours. */
  dailyLimit: 3,
} as const;

const HELPABLE = new Set(ROADSIDE.kinds.map((k) => ROAD_EVENTS[k].title));

/** The stop a truck stands at now, when it is one a friend can help with (else null). */
export function helpableStop(schedule: readonly Segment[], now: number): Segment | null {
  const s = schedule.find((x) => now >= x.start && now < x.end);
  if (!s || s.kind !== 'incident' || !s.note || !HELPABLE.has(s.note)) return null;
  return s.end - now >= ROADSIDE.minRemainingMs ? s : null;
}

/** Shortens the stop that runs at `now` by `savedMs`: everything after it moves earlier. */
export function shortenStop(schedule: readonly Segment[], stop: Segment, savedMs: number): Segment[] {
  let after = false;
  return schedule.map((s) => {
    if (after) return { ...s, start: s.start - savedMs, end: s.end - savedMs };
    if (s.start === stop.start && s.kind === 'incident') {
      after = true;
      return { ...s, end: s.end - savedMs, note: `${s.note} · помощ от колега` };
    }
    return s;
  });
}
