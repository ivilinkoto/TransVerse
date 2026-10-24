/**
 * "Жив път" (v1.8): the road talks.
 * - CB radio (channel 19): a message is heard by drivers whose trucks are on
 *   the road within 100 km of where it was sent, for an hour.
 * - Road reports: a driver on the road marks an accident, police, a jam,
 *   road works or bad weather where the truck is; drivers nearby confirm or
 *   deny it. A confirmed report earns the reporter reputation, a false one
 *   costs it. Game data, made by the players.
 */
export const CB = { radiusKm: 100, historyMin: 60, maxLength: 200, perMinute: 6, channel: 19 } as const;

export const REPORT_KINDS = {
  accident: { label: 'Катастрофа', emoji: '💥' },
  police: { label: 'Пътна полиция', emoji: '👮' },
  jam: { label: 'Задръстване', emoji: '🚗' },
  works: { label: 'Ремонт на пътя', emoji: '🚧' },
  weather: { label: 'Лошо време', emoji: '🌧️' },
} as const;
export type ReportKind = keyof typeof REPORT_KINDS;
export const REPORT_KIND_IDS = Object.keys(REPORT_KINDS) as ReportKind[];

export const REPORTS = {
  ttlMin: 30,
  /** Each confirmation keeps the report up this much longer, at most `maxMin` from its start. */
  extendMin: 15,
  maxMin: 120,
  /** Who may vote: a truck (on the road or parked) this close. */
  voteRadiusKm: 50,
  /** Shown to drivers within this distance. */
  showRadiusKm: 150,
  confirmsToReward: 3,
  deniesToRemove: 3,
  reputation: 2,
  cooldownMin: 10,
} as const;

/** When a report ends after a confirmation (never past `maxMin` from its start). */
export function extendedExpiry(createdAt: Date, expiresAt: Date, now: Date): Date {
  const cap = createdAt.getTime() + REPORTS.maxMin * 60_000;
  return new Date(Math.min(cap, Math.max(expiresAt.getTime(), now.getTime() + REPORTS.extendMin * 60_000)));
}
