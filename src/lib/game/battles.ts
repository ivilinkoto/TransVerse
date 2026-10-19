/**
 * Company battles: every week (Monday to Sunday, Sofia time) active companies
 * are paired with a company of similar level. Every tonne a member delivers
 * counts; when the week ends the company with more tonnes wins money for its
 * treasury, company XP and a trophy (shown on its public profile). Game data.
 */
export const BATTLE_RULES = {
  /** A company is active when a member delivered within this many days. */
  activeDays: 14,
  rewardCents: 10_000_00,
  /** A draw (equal tonnes, both above zero) splits the money and the XP. */
  rewardXp: 400,
} as const;

/** Pairs companies of similar strength: sorted by level then XP, neighbours meet. The odd one out waits a week. */
export function pairCompanies<T extends { id: string; level: number; xp: number }>(companies: readonly T[], seed: string): [T, T][] {
  const sorted = [...companies].sort((a, b) => b.level - a.level || b.xp - a.xp || (hashOf(seed + a.id) - hashOf(seed + b.id)));
  const pairs: [T, T][] = [];
  for (let i = 0; i + 1 < sorted.length; i += 2) pairs.push([sorted[i]!, sorted[i + 1]!]);
  return pairs;
}

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type BattleResult = 'win' | 'loss' | 'draw' | 'none';

/** The outcome for side A. "none" when nobody delivered anything. */
export function battleOutcome(aTons: number, bTons: number): BattleResult {
  if (aTons <= 0 && bTons <= 0) return 'none';
  if (aTons === bTons) return 'draw';
  return aTons > bTons ? 'win' : 'loss';
}
