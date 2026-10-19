import { releaseByVersion } from './releases';

/**
 * Features of a release go live for players at the release's `publishedAt`.
 * Until then only the staff (support and up) can use them — to test an update
 * that is already deployed. Balance changes and bug fixes are not listed
 * here: they apply at once for everyone.
 */
export const FEATURES = {
  transfers: '1.2',
  search: '1.2',
  map_circle: '1.2',
  company_profile: '1.2',
  convoy: '1.2',
  hire: '1.2',
  projects: '1.2',
  career: '1.2',
  mentor: '1.2',
  roadside: '1.2',
  chat_extras: '1.2',
  backhaul: '1.2',
  push_actions: '1.2',
  battles: '1.2',
  feed: '1.2',
  weekly_goal: '1.2',
  eco: '1.2',
} as const;

export type FeatureId = keyof typeof FEATURES;

/** When a feature goes live for everyone (the release date), or null when its release is unknown (live). */
export function featureDate(id: FeatureId): Date | null {
  const r = releaseByVersion(FEATURES[id]);
  return r ? new Date(r.publishedAt) : null;
}

/** Is the feature on for this viewer? Always for the staff; for players from the release date. */
export function featureLive(id: FeatureId, now: Date, staff = false): boolean {
  if (staff) return true;
  const at = featureDate(id);
  return !at || at <= now;
}

/** The features on for a viewer (a map handy for pages and components). */
export function liveFeatures(now: Date, staff = false): Record<FeatureId, boolean> {
  return Object.fromEntries((Object.keys(FEATURES) as FeatureId[]).map((id) => [id, featureLive(id, now, staff)])) as Record<FeatureId, boolean>;
}
