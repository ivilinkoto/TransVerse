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
  multistop: '1.2',
  leasing: '1.2',
  company_roles: '1.2',
  year_recap: '1.2',
  company_plot: '1.3',
  plot_guests: '1.3',
  livery: '1.3',
  maintenance: '1.3',
  plot_season: '1.3',
  plot_decor: '1.3',
  plot_expand: '1.3',
  company_fleet: '1.3',
  build_badges: '1.3',
  build_boom: '1.3',
  company_polls: '1.3',
  chat_replies: '1.3',
  chat_unread: '1.3',
  chat_reactions: '1.3',
  chat_pin: '1.3',
  chat_online: '1.3',
  truck_notes: '1.3',
  plot_night: '1.3',
  plot_weather: '1.3',
  plot_visits: '1.3',
  company_trophies: '1.3',
  builder_week: '1.3',
  build_last_load: '1.3',
  discord_bot: '1.3',
  partial_loads: '1.3',
  shared_loads: '1.3',
  daily_load: '1.3',
  duels: '1.3',
  livery_contest: '1.3',
  roadside_paid: '1.3',
  ferries: '1.4',
  rail: '1.4',
  port_loads: '1.4',
  ship_calls: '1.4',
  real_weather: '1.4',
  factories: '1.4',
  freight_exchange: '1.4',
  branches: '1.4',
  loans: '1.4',
  electric: '1.4',
  driver_moods: '1.4',
  cosmetics: '1.4',
  rally: '1.4',
  discord_events: '1.4',
  company_report: '1.4',
  trailer_upgrades: '1.4',
  company_trailers: '1.4',
  marta: '1.5',
  night_shift: '1.5',
  road_works: '1.5',
  oversize: '1.5',
  fuel_station: '1.5',
  alliances: '1.5',
  company_contracts: '1.5',
  academy: '1.5',
  divisions: '1.5',
  perfect_run: '1.5',
  city_album: '1.5',
  garage_showcase: '1.5',
  discord_rally: '1.5',
  weekly_digest: '1.5',
  predictions: '1.5',
  event_autostart: '1.5',
  trailer_cosmetics: '1.5',
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
