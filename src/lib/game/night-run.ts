import { seeded } from './daily-route';

/**
 * 1.3 „Нощен рейс“: an arcade run on a night road, the same for everybody each day.
 * Three lanes, slower traffic to pass, fuel cans to pick up. The run is a list of
 * steering inputs (−1 left, 0 straight, 1 right), one per tick; the client draws
 * the run and the server replays the same inputs with the same rules — the score
 * and the reward are decided there. Units: metres and seconds.
 */
export const NIGHT_RUN = {
  tps: 30,
  maxTicks: 30 * 75,
  lanes: 3,
  /** Ticks a lane change takes. */
  laneTicks: 8,
  /** Speed (m/s): from the start to the end of the run. */
  speed: [20, 40] as const,
  /** After a crash the truck slows to this share and gets back over `recoverTicks`. */
  crashSlow: 0.4,
  recoverTicks: 60,
  maxCrashes: 3,
  fuel: { start: 100, perTick: 0.06, can: 25 },
  car: { length: 6, laneHit: 0.55, speed: [11, 18] as const },
  canHit: 3,
  /** The day's road is this long, with traffic and cans along it. */
  roadLength: 3200,
  runsPerDay: 3,
  /** Stars by distance (m), and the XP for each (given once a day for the best). */
  stars: [900, 1500, 2100] as const,
  xp: [0, 40, 90, 150] as const,
} as const;

export interface RunCar { lane: number; y: number; v: number; colour: number }
export interface RunCan { lane: number; y: number }
export interface Road { cars: RunCar[]; cans: RunCan[] }

/**
 * The day's road: traffic every 30–58 m; sometimes two cars side by side (one lane
 * always free, and close pairs never ask for a jump across the whole road); a fuel
 * can every ~110 m.
 */
export function nightRoad(day: string): Road {
  const rand = seeded(`night-run:${day}`);
  const cars: RunCar[] = [];
  const cans: RunCan[] = [];
  let lastPair: { y: number; free: number } | null = null;
  for (let y = 80; y < NIGHT_RUN.roadLength; ) {
    const v = NIGHT_RUN.car.speed[0] + rand() * (NIGHT_RUN.car.speed[1] - NIGHT_RUN.car.speed[0]);
    if (rand() < 0.3) {
      let free = Math.floor(rand() * NIGHT_RUN.lanes);
      if (lastPair && y - lastPair.y < 70 && Math.abs(free - lastPair.free) > 1) free = 1;
      for (let lane = 0; lane < NIGHT_RUN.lanes; lane++) if (lane !== free) cars.push({ lane, y, v, colour: Math.floor(rand() * 6) });
      lastPair = { y, free };
      y += 42 + rand() * 20;
    } else {
      cars.push({ lane: Math.floor(rand() * NIGHT_RUN.lanes), y, v, colour: Math.floor(rand() * 6) });
      y += 30 + rand() * 28;
    }
  }
  for (let y = 120; y < NIGHT_RUN.roadLength; y += 90 + rand() * 50) cans.push({ lane: Math.floor(rand() * NIGHT_RUN.lanes), y });
  return { cars, cans };
}

export interface RunState {
  tick: number;
  /** Distance driven (m). */
  y: number;
  /** Lane position (0..2, fractional while changing lanes). */
  x: number;
  from: number;
  to: number;
  changeTick: number;
  fuel: number;
  crashes: number;
  slowUntil: number;
  cans: number;
  hitCars: Set<number>;
  takenCans: Set<number>;
  over: null | 'crashes' | 'fuel' | 'time';
}

export function startRun(): RunState {
  return { tick: 0, y: 0, x: 1, from: 1, to: 1, changeTick: 0, fuel: NIGHT_RUN.fuel.start, crashes: 0, slowUntil: 0, cans: 0, hitCars: new Set(), takenCans: new Set(), over: null };
}

/** The truck's speed (m/s) at this moment of the run. */
export function speedAt(s: RunState): number {
  const base = NIGHT_RUN.speed[0] + ((NIGHT_RUN.speed[1] - NIGHT_RUN.speed[0]) * s.tick) / NIGHT_RUN.maxTicks;
  if (s.tick >= s.slowUntil) return base;
  const left = (s.slowUntil - s.tick) / NIGHT_RUN.recoverTicks;
  return base * (1 - (1 - NIGHT_RUN.crashSlow) * left);
}

/** Where a traffic car is at this tick. */
export const carY = (c: RunCar, tick: number) => c.y + (c.v * tick) / NIGHT_RUN.tps;

/** One tick: steer, drive, burn fuel, pick up cans, hit cars. Mutates and returns the state. */
export function stepRun(s: RunState, road: Road, steer: number): RunState {
  if (s.over) return s;
  // Steering: a new lane change only when the last one is over.
  if (s.from === s.to && steer !== 0) {
    const to = Math.max(0, Math.min(NIGHT_RUN.lanes - 1, s.to + Math.sign(steer)));
    if (to !== s.to) {
      s.to = to;
      s.changeTick = s.tick;
    }
  }
  if (s.from !== s.to) {
    const k = Math.min(1, (s.tick - s.changeTick + 1) / NIGHT_RUN.laneTicks);
    s.x = s.from + (s.to - s.from) * k;
    if (k >= 1) s.from = s.to;
  }
  s.y += speedAt(s) / NIGHT_RUN.tps;
  s.fuel -= NIGHT_RUN.fuel.perTick;
  s.tick++;
  road.cans.forEach((c, i) => {
    if (!s.takenCans.has(i) && Math.abs(c.y - s.y) < NIGHT_RUN.canHit && Math.abs(c.lane - s.x) < NIGHT_RUN.car.laneHit) {
      s.takenCans.add(i);
      s.cans++;
      s.fuel = Math.min(100, s.fuel + NIGHT_RUN.fuel.can);
    }
  });
  road.cars.forEach((c, i) => {
    if (s.hitCars.has(i)) return;
    const dy = carY(c, s.tick) - s.y;
    if (dy > -NIGHT_RUN.car.length / 2 && dy < NIGHT_RUN.car.length && Math.abs(c.lane - s.x) < NIGHT_RUN.car.laneHit) {
      s.hitCars.add(i);
      s.crashes++;
      s.slowUntil = s.tick + NIGHT_RUN.recoverTicks;
    }
  });
  if (s.crashes >= NIGHT_RUN.maxCrashes) s.over = 'crashes';
  else if (s.fuel <= 0) s.over = 'fuel';
  else if (s.tick >= NIGHT_RUN.maxTicks) s.over = 'time';
  return s;
}

export function runStars(metres: number): number {
  return NIGHT_RUN.stars.filter((m) => metres >= m).length;
}

/** Replays a whole run (the server's word on it). Inputs past the end are ignored. */
export function replayRun(day: string, inputs: readonly number[]) {
  const road = nightRoad(day);
  const s = startRun();
  for (let i = 0; i < NIGHT_RUN.maxTicks && !s.over; i++) stepRun(s, road, inputs[i] ?? 0);
  // A run that stopped sending inputs before its end just drives straight on.
  const metres = Math.floor(s.y);
  return { metres, stars: runStars(metres), crashes: s.crashes, cans: s.cans, over: s.over ?? 'time', ticks: s.tick };
}
