/**
 * Seasonal looks of the site (Halloween now; Christmas and others can be
 * added the same way). A season switches itself on and off by date (Sofia
 * time, every year); an administrator can force it on or off. The base
 * design is untouched: a season only overrides colours and adds decorations
 * under html[data-season="…"].
 */

export const SEASON_IDS = ['halloween'] as const;
export type SeasonId = (typeof SEASON_IDS)[number];

export interface SeasonDefinition {
  id: SeasonId;
  label: string;
  /** First and last day, MM-DD, inclusive (Europe/Sofia). */
  from: string;
  to: string;
}

export const SEASONS: Record<SeasonId, SeasonDefinition> = {
  halloween: { id: 'halloween', label: 'Хелуин', from: '10-20', to: '11-02' },
};

export type SeasonMode = { mode: 'auto' } | { mode: 'off' } | { mode: 'on'; season: SeasonId };

export const DEFAULT_SEASON_MODE: SeasonMode = { mode: 'auto' };

/** Month-day in Sofia, e.g. "10-31". */
export function sofiaMonthDay(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '01';
  return `${get('month')}-${get('day')}`;
}

/** The season shown at `now` under the site's mode. */
export function activeSeason(now: Date, mode: SeasonMode = DEFAULT_SEASON_MODE): SeasonId | null {
  if (mode.mode === 'off') return null;
  if (mode.mode === 'on') return mode.season;
  const md = sofiaMonthDay(now);
  return SEASON_IDS.find((id) => md >= SEASONS[id].from && md <= SEASONS[id].to) ?? null;
}

export function parseSeasonMode(value: unknown): SeasonMode {
  const v = value as { mode?: string; season?: string } | null;
  if (v?.mode === 'off') return { mode: 'off' };
  if (v?.mode === 'on' && SEASON_IDS.includes(v.season as SeasonId)) return { mode: 'on', season: v.season as SeasonId };
  return DEFAULT_SEASON_MODE;
}
