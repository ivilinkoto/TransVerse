/**
 * The player's own weekly goal: on any day of the week the player picks one of
 * three goals sized to their own pace (the average week of the last four):
 * easy, normal or hard. Trips from the moment of the choice count. The reward
 * grows with the difficulty and is taken by hand.
 */
export type GoalMetric = 'deliveries' | 'km' | 'tons';
export type GoalDifficulty = 'easy' | 'normal' | 'hard';

export const GOAL_METRICS: Record<GoalMetric, { label: (n: number) => string; floor: number; round: number }> = {
  deliveries: { label: (n) => `Изпълни ${n.toLocaleString('bg-BG')} курса`, floor: 5, round: 1 },
  km: { label: (n) => `Измини ${n.toLocaleString('bg-BG')} км с товар`, floor: 1_500, round: 100 },
  tons: { label: (n) => `Превози ${n.toLocaleString('bg-BG')} т товар`, floor: 60, round: 10 },
};

export const GOAL_LEVELS: Record<GoalDifficulty, { label: string; factor: number; cents: number; coins: number }> = {
  easy: { label: 'Лесна', factor: 0.8, cents: 3_000_00, coins: 5 },
  normal: { label: 'Нормална', factor: 1.1, cents: 5_000_00, coins: 10 },
  hard: { label: 'Трудна', factor: 1.5, cents: 8_000_00, coins: 20 },
};

/** Which metric each difficulty uses this week (varies by player and week). */
export function goalMetrics(seed: string): Record<GoalDifficulty, GoalMetric> {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const order: GoalMetric[] = ['deliveries', 'km', 'tons'];
  const shift = (h >>> 0) % 3;
  return { easy: order[shift]!, normal: order[(shift + 1) % 3]!, hard: order[(shift + 2) % 3]! };
}

/** The target for a metric from the player's average week. */
export function goalTarget(metric: GoalMetric, averageWeek: number, difficulty: GoalDifficulty): number {
  const m = GOAL_METRICS[metric];
  const raw = Math.max(m.floor * GOAL_LEVELS[difficulty].factor, averageWeek * GOAL_LEVELS[difficulty].factor);
  return Math.max(m.round, Math.round(raw / m.round) * m.round);
}

/** What one delivery adds to a goal. */
export function goalIncrement(metric: GoalMetric, load: { loadedKm: number; tons: number }): number {
  return metric === 'deliveries' ? 1 : metric === 'km' ? Math.round(load.loadedKm) : load.tons;
}
