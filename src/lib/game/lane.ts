/**
 * "Лентата" (v2.0): a mini-game in the cab during a trip. The road bends
 * (the same bends for the same trip), the truck drifts and the player
 * steers: −1 left, 0 straight, 1 right, one input per tick. The server
 * replays the inputs with the same rules — the stars and the reward are
 * decided there. Once per trip.
 */
export const LANE = {
  ticks: 300,
  /** Lateral change per tick at full steer (m), and the half width of the lane (m). */
  steer: 0.12,
  halfWidth: 0.9,
  /** Share of ticks in the lane for one, two, three stars. */
  stars: [0.5, 0.7, 0.85] as const,
  xp: [0, 20, 40, 70] as const,
} as const;

function seedOf(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** The centre of the lane at a tick (m from the start line), from the trip. */
export function laneCentre(seed: string, tick: number): number {
  const h = seedOf(seed);
  const p1 = (h % 628) / 100;
  const p2 = ((h >>> 10) % 628) / 100;
  return 1.6 * Math.sin(tick / 23 + p1) + 0.9 * Math.sin(tick / 9 + p2);
}

/** Replays a run: the share of ticks in the lane and the stars. */
export function replayLane(seed: string, inputs: readonly number[]) {
  let x = laneCentre(seed, 0);
  let inside = 0;
  for (let tick = 0; tick < LANE.ticks; tick++) {
    const input = Math.max(-1, Math.min(1, Math.round(inputs[tick] ?? 0)));
    x += input * LANE.steer;
    if (Math.abs(x - laneCentre(seed, tick + 1)) <= LANE.halfWidth) inside++;
  }
  const share = inside / LANE.ticks;
  const stars = share >= LANE.stars[2] ? 3 : share >= LANE.stars[1] ? 2 : share >= LANE.stars[0] ? 1 : 0;
  return { share, stars };
}
