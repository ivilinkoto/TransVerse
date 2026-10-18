import { isNight } from './halloween';
import type { Segment } from './schedule';

/**
 * Road events: things that happen on the way (traffic jams, roadworks, a
 * breakdown, a queue at the border). They are planned by the server when the
 * job starts — the player does not see them in advance — and applied when the
 * truck reaches that point: the schedule gets a stop and everything after it
 * moves later. All values are game data.
 */
export type RoadEventKind = 'traffic' | 'roadworks' | 'breakdown' | 'border_queue' | 'weather' | 'inspection' | 'ghost';

export interface RoadEventPlan {
  kind: RoadEventKind;
  /** Epoch ms in the original schedule when it happens (inside a drive segment). */
  at: number;
  /** Delay added to the trip, ms (game time). */
  delayMs: number;
  /** Extra cost for the player (euro cents); 0 for rented trucks (the lessor pays). */
  costCents: number;
  applied: boolean;
}

export const ROAD_EVENTS: Record<RoadEventKind, { title: string; body: string; delay: [number, number]; costCentsPerKm?: number }> = {
  traffic: { title: 'Задръстване', body: 'Колона от коли — камионът пълзи.', delay: [0.06, 0.12] },
  roadworks: { title: 'Ремонт на пътя', body: 'Едно платно и временен светофар.', delay: [0.04, 0.08] },
  breakdown: { title: 'Повреда по пътя', body: 'Спукана гума — пътна помощ и смяна на място.', delay: [0.08, 0.14], costCentsPerKm: 12 },
  border_queue: { title: 'Опашка на границата', body: 'Дълга колона от камиони на граничния пункт.', delay: [0.05, 0.1] },
  weather: { title: 'Лошо време', body: 'Силен дъжд и мъгла — шофьорът кара по-бавно.', delay: [0.04, 0.09] },
  inspection: { title: 'Проверка на пътя', body: 'Пътна полиция проверява документите и тахографа.', delay: [0.03, 0.05] },
  // Halloween: a harmless night-time sighting that brings a few ТрансКоин.
  ghost: { title: 'Призрачен камион', body: 'В мъглата се появи светещ камион без шофьор, мигна с фаровете и изчезна. Шофьорът ти спря за малко, за да си поеме дъх.', delay: [0.005, 0.01] },
};

/** Chance of at least one event, and of a second one on long trips. */
export const ROAD_EVENT_CHANCE = { one: 0.3, longTripKm: 600, oneLong: 0.45, second: 0.2 } as const;

/** Deterministic pseudo-random numbers from a seed (so plans are reproducible in tests). */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Picks the events for a fresh schedule. `rented` trucks get delays but no repair bill. */
export function planRoadEvents(
  schedule: readonly Segment[],
  opts: {
    totalKm: number;
    borders: number;
    rented: boolean;
    random: () => number;
    /** Multiplier from the crew's safety skill (default 1). */
    chance?: number;
    /** Halloween: chance of meeting the ghost truck when the trip drives through the night (Sofia 22:00–06:00). */
    ghostChance?: number;
  },
): RoadEventPlan[] {
  const drives = schedule.filter((s) => s.kind === 'drive' && s.end - s.start > 0);
  const first = schedule[0];
  const last = schedule.at(-1);
  if (!drives.length || !first || !last) return [];
  const span = last.end - first.start;
  const r = opts.random;
  const chance = opts.chance ?? 1;
  const count = r() < (opts.totalKm >= ROAD_EVENT_CHANCE.longTripKm ? ROAD_EVENT_CHANCE.oneLong : ROAD_EVENT_CHANCE.one) * chance ? (opts.totalKm >= ROAD_EVENT_CHANCE.longTripKm && r() < ROAD_EVENT_CHANCE.second * chance ? 2 : 1) : 0;
  const kinds: RoadEventKind[] = ['traffic', 'traffic', 'roadworks', 'roadworks', 'breakdown', 'weather', 'inspection', ...(opts.borders > 0 ? (['border_queue', 'border_queue'] as const) : [])];
  const events: RoadEventPlan[] = [];
  for (let i = 0; i < count; i++) {
    const kind = kinds[Math.floor(r() * kinds.length)]!;
    // A moment in the middle part of a drive segment, never in the first or last minutes of the trip.
    const seg = drives[Math.floor(r() * drives.length)]!;
    const at = Math.round(seg.start + (seg.end - seg.start) * (0.2 + 0.6 * r()));
    if (events.some((e) => Math.abs(e.at - at) < span * 0.1)) continue;
    const [lo, hi] = ROAD_EVENTS[kind].delay;
    const delayMs = Math.round(span * (lo + (hi - lo) * r()));
    const perKm = ROAD_EVENTS[kind].costCentsPerKm ?? 0;
    const costCents = opts.rented || !perKm ? 0 : Math.round(Math.min(800_00, Math.max(120_00, opts.totalKm * perKm)) / 100) * 100;
    events.push({ kind, at, delayMs, costCents, applied: false });
  }
  if (opts.ghostChance) {
    // A moment in the middle of a night-time drive.
    const night = drives.flatMap((sg) => [0.3, 0.5, 0.7].map((f) => Math.round(sg.start + (sg.end - sg.start) * f))).filter((t) => isNight(t));
    if (night.length && r() < opts.ghostChance) {
      const [lo, hi] = ROAD_EVENTS.ghost.delay;
      events.push({ kind: 'ghost', at: night[Math.floor(r() * night.length)]!, delayMs: Math.round(span * (lo + (hi - lo) * r())), costCents: 0, applied: false });
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

/**
 * Inserts a stop at `at` (original time) and shifts the rest of the schedule by
 * `delayMs`.
 */
export function insertStop(schedule: readonly Segment[], at: number, delayMs: number, note?: string): Segment[] {
  const out: Segment[] = [];
  let inserted = false;
  for (const s of schedule) {
    if (inserted) {
      out.push({ ...s, start: s.start + delayMs, end: s.end + delayMs });
    } else if (at >= s.end) {
      out.push(s);
    } else if (at <= s.start) {
      // The stop goes in front of this segment.
      out.push({ kind: 'incident', leg: s.leg, start: s.start, end: s.start + delayMs, fromKm: s.fromKm, toKm: s.fromKm, note }, { ...s, start: s.start + delayMs, end: s.end + delayMs });
      inserted = true;
    } else {
      const f = (at - s.start) / (s.end - s.start);
      const km = s.kind === 'drive' ? s.fromKm + (s.toKm - s.fromKm) * f : s.fromKm;
      out.push({ ...s, end: at, toKm: km }, { kind: 'incident', leg: s.leg, start: at, end: at + delayMs, fromKm: km, toKm: km, note }, { ...s, start: at + delayMs, end: s.end + delayMs, fromKm: km });
      inserted = true;
    }
  }
  return out;
}

/** Applies every planned event that is due by `now`. Times in the plan are original; earlier delays shift later ones. */
export function applyDueEvents(schedule: readonly Segment[], events: readonly RoadEventPlan[], now: number) {
  let segs = [...schedule];
  let shift = events.filter((e) => e.applied).reduce((s, e) => s + e.delayMs, 0);
  const applied: RoadEventPlan[] = [];
  const next = events.map((e) => {
    if (e.applied || e.at + shift > now) return e;
    segs = insertStop(segs, e.at + shift, e.delayMs, ROAD_EVENTS[e.kind].title);
    shift += e.delayMs;
    const done = { ...e, applied: true };
    applied.push(done);
    return done;
  });
  const pending = next.filter((e) => !e.applied);
  // Planned times of later events move with the delays already applied.
  const nextAt = pending.length ? pending[0]!.at + shift : null;
  return { schedule: segs, events: next, applied, nextAt };
}
