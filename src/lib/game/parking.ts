/**
 * "Паркирай на рампата" (v1.5): a daily mini-game. The truck reverses at a
 * steady pace and the player steers; the run is a list of steering inputs
 * (−1 left, 0 straight, 1 right), one per tick. The server replays the same
 * list with the same rules — the result and the reward are decided there.
 * Units: metres and radians, the yard is 40 × 30 m.
 */
export const PARKING = {
  yard: { w: 40, h: 30 },
  maxTicks: 400,
  /** Reversing speed per tick (m) and the wheelbase (m). */
  speed: 0.12,
  wheelbase: 4,
  maxSteer: 0.5,
  truck: { length: 7, width: 2.5 },
  /** The ramp: the truck's rear (the reference point) should stop here, pointing up. */
  bay: { x: 20, y: 3.5, heading: Math.PI / 2 },
  /** Stars by how close and straight the truck stops. */
  stars: [
    { maxDist: 0.6, maxAngle: (8 * Math.PI) / 180 },
    { maxDist: 1.2, maxAngle: (15 * Math.PI) / 180 },
    { maxDist: 2.5, maxAngle: (30 * Math.PI) / 180 },
  ],
  xp: [0, 40, 90, 150] as const,
} as const;

export interface TruckPose {
  x: number;
  y: number;
  /** The direction the cab faces (radians, 0 = right, π/2 = up). */
  heading: number;
}

/** The start of the day (a different spot every day, from the date). */
export function parkingStart(dayKey: string): TruckPose {
  let h = 0;
  for (const ch of dayKey) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const x = 14 + (h % 13);
  const y = 20 + ((h >>> 5) % 6);
  const heading = Math.PI / 2 + (((h >>> 9) % 41) - 20) * (Math.PI / 180);
  return { x, y, heading };
}

/** One tick in reverse: a simple bicycle model around the rear axle. */
export function step(p: TruckPose, steer: number): TruckPose {
  const s = Math.max(-1, Math.min(1, Math.round(steer))) * PARKING.maxSteer;
  const heading = p.heading - (PARKING.speed / PARKING.wheelbase) * Math.tan(s);
  return { x: p.x - PARKING.speed * Math.cos(heading), y: p.y - PARKING.speed * Math.sin(heading), heading };
}

const inYard = (p: TruckPose) => p.x >= 0 && p.x <= PARKING.yard.w && p.y >= 0 && p.y <= PARKING.yard.h;

/** Replays a run: where the truck ends, whether it left the yard and the stars (0–3). */
export function replayParking(dayKey: string, inputs: readonly number[]) {
  let p = parkingStart(dayKey);
  let crashed = false;
  for (const s of inputs.slice(0, PARKING.maxTicks)) {
    p = step(p, s);
    if (!inYard(p)) {
      crashed = true;
      break;
    }
  }
  const dist = Math.hypot(p.x - PARKING.bay.x, p.y - PARKING.bay.y);
  const angle = Math.abs(Math.atan2(Math.sin(p.heading - PARKING.bay.heading), Math.cos(p.heading - PARKING.bay.heading)));
  const tier = crashed ? -1 : PARKING.stars.findIndex((s) => dist <= s.maxDist && angle <= s.maxAngle);
  const stars = tier === -1 ? 0 : 3 - tier;
  return { pose: p, crashed, dist, angle, stars };
}
