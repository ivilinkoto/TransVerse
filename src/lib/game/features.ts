import { releaseByVersion } from './releases';

/**
 * Features of a release go live for players at the release's `publishedAt`.
 * Until then only the staff (support and up) can use them — to test an update
 * that is already deployed. Balance changes and bug fixes are not listed
 * here: they apply at once for everyone.
 */
export const FEATURES = {
  // v1.1.1 (October 2026): small things that go live at once.
  truck_names: '1.1.1',
  online_now: '1.1.1',
  // v1.1.2: company rename, report a problem from any page.
  company_rename: '1.1.2',
  report_problem: '1.1.2',
  arriving_soon: '1.1.2',
  weekly_report: '1.1.2',
  favorite_truck: '1.1.2',
  friends_invite: '1.1.2',
  // v1.1.3: rent or buy, questions in Help, filters for notifications.
  rent_vs_buy: '1.1.3',
  help_faq: '1.1.3',
  notification_filter: '1.1.3',
  next_update: '1.1.3',
  depot_on_market: '1.1.3',
  first_own_truck: '1.1.3',
  delete_account: '1.1.3',
  sign_out_others: '1.1.3',
  email_reward: '1.1.3',
  recent_trips: '1.1.3',
  arrival_sound: '1.1.3',
  session_list: '1.1.3',
  data_export: '1.1.3',
  login_alert: '1.1.3',
  username_change: '1.1.3',
  truck_compare: '1.1.3',
  sound_settings: '1.1.3',
  // v1.1.3.1: more achievements, achievements by tier, season medals, new vehicles.
  more_achievements: '1.1.3.1',
  season_medals: '1.1.3.1',
  company_achievements: '1.1.3.1',
  new_vehicles_1131: '1.1.3.1',
  // v1.1.3.2 „Discord“: the whole Discord bot for everyone (and the bot-only parts that need nothing unreleased).
  discord_bot: '1.1.3.2',
  discord_events: '1.1.3.2',
  weekly_digest: '1.1.3.2',
  staff_alerts: '1.1.3.2',
  discord_truck: '1.1.3.2',
  discord_ideas: '1.1.3.2',
  discord_bug_reports: '1.1.3.2',
  discord_status: '1.1.3.2',
  discord_news: '1.1.3.2',
  discord_coming_soon: '1.1.3.2',
  // v1.1.3.4 „Discord+“: company card and compare in Discord, driver of the week, countdown channel,
  // idle truck reminder, ✅ closes a bug, the team's daily report, Discord votes on ideas, translate, level rewards.
  discord_plus: '1.1.3.4',
  // v1.1.3.5 „Чист дневник“: every idle truck to the depot at once, the same trip again with that truck,
  // the unread count in the tab, /напомни and the Discord quiet hours.
  repeat_trip: '1.1.3.5',
  depot_all: '1.1.3.5',
  tab_badge: '1.1.3.5',
  discord_remind: '1.1.3.5',
  discord_quiet: '1.1.3.5',
  // v1.1.4.1 „По-просто“: the menu in five, a calmer dashboard, one-tap loads, short texts, and what
  // brings players back — "Докато те нямаше", queued trips, the big run, a rival, the week's card.
  simple_ui: '1.1.4.1',
  welcome_back: '1.1.4.1',
  trip_queue: '1.1.4.1',
  big_run: '1.1.4.1',
  rival: '1.1.4.1',
  weekly_card: '1.1.4.1',
  discord_game_menu: '1.1.4.1',
  // v1.1.4.2 „Мъгла и марки“: choices on every load (the promise, the loading puzzle, the client's stars),
  // November fog, new systems (research, adverts, livestock, fuel ahead, CO₂, the office, drivers' wishes,
  // challenges by players, live tracking, insurers, interviews, the lost pallet, night couriers, the last mile).
  load_promise: '1.1.4.2',
  loading_puzzle: '1.1.4.2',
  client_reviews: '1.1.4.2',
  mystery_client: '1.1.4.2',
  fog: '1.1.4.2',
  gift_load: '1.1.4.2',
  vacation: '1.1.4.2',
  earnings_map: '1.1.4.2',
  lane_repeat: '1.1.4.2',
  accessibility: '1.1.4.2',
  did_you_know: '1.1.4.2',
  research: '1.1.4.2',
  trailer_ads: '1.1.4.2',
  livestock: '1.1.4.2',
  fuel_hedge: '1.1.4.2',
  co2: '1.1.4.2',
  office: '1.1.4.2',
  driver_wishes: '1.1.4.2',
  player_challenges: '1.1.4.2',
  live_tracking: '1.1.4.2',
  insurers: '1.1.4.2',
  interviews: '1.1.4.2',
  lost_cargo: '1.1.4.2',
  night_courier: '1.1.4.2',
  last_mile: '1.1.4.2',
  discord_1142: '1.1.4.2',
  // 1.1.4.3: animations and effects (cases, Truck Pass, money, rewards).
  game_fx: '1.1.4.3',
  // 1.1.4.3: promo codes (and a friend's invite code typed in later).
  promo_codes: '1.1.4.3',
  // 1.2.1 „Инвентар+“: its own place in the main menu, the item card, filters and НОВО;
  // sale, presents and trades; the workshop; the album with new collections, the
  // numbered key, the treasure map and the Hall of Fame; the weekly and company chests.
  // 1.2.2 „Лесен път“: the simpler menu — five places, Курсове with the map, Награди, a short Автопарк.
  nav_v2: '1.2.2',
  // 1.2.3 „Отворен път“: the new shop — VIP prices and extras, cases, weekly offers, starter pack, monthly card, patron levels.
  shop_v2: '1.2.3',
  // 1.2.3: the morning report, the favourite truck, the next trip after a load, the contract of the week,
  // tips on the lanes, greeting new players nearby, a light look and bigger text, buttons in notifications, the week in the profile.
  morning_report: '1.2.3',
  favorite_stats: '1.2.3',
  next_trip: '1.2.3',
  weekly_lane: '1.2.3',
  lane_tips: '1.2.3',
  welcome_neighbors: '1.2.3',
  look_settings: '1.2.3',
  notification_buttons: '1.2.3',
  week_chart: '1.2.3',
  // 1.2.3.1 „Финален спринт“: the last day of a season (reminder, countdown, Discord) and the season recap to share.
  final_sprint: '1.2.3.1',
  partial_repair: '1.2.3.1',
  partners: '1.2.3.1',
  business_profile: '1.2.3.2',
  // 1.2.3.3: a truck to any city (live at once)
  truck_relocate: '1.2.3.3',
  // 1.2.3.4: new loads around the trucks (live at once)
  board_refresh: '1.2.3.4',
  garage_showroom: '1.2.3.5',
  // 1.2.3.6 „Чиста карта“: map layers and focus, the delivery postcard, the dock slots, letters from the clients and
  map_layers: '1.3',
  delivery_postcard: '1.3',
  dock_slots: '1.3',
  client_letters: '1.3',
  // every truck in 3D (fleet, profile, dealership) and the depot yards in 3D.
  truck_3d_view: '1.3',
  depot_3d: '1.3',
  // „Нов облик“: game windows, the inventory as a game bag that opens over any page.
  game_ui: '1.3',
  // „Зимен поход“: seven winter steps, one more each day from the release.
  winter_trek: '1.3',
  // „Пътят на деня“: a daily route puzzle, the same for everybody.
  daily_route: '1.3',
  // „Талисман в кабината“: a companion that grows with the trips.
  mascot: '1.3',
  // „Нощен рейс“: an arcade run on the day's night road.
  night_run: '1.3',
  // „Умения на шофьора“: the player's own skill tree.
  driver_skills: '1.3',
  // „Собствен сервиз“: player-run repair workshops.
  player_workshops: '1.3',
  // „Световни кризи“: three-day crises with a community vote and a week's effect.
  world_crises: '1.3',
  // „Автобусна компания“: passenger bus lines next to the freight.
  bus_lines: '1.3',
  // 1.2.6 „На една вълна“
  chat_life: '1.3',
  partner_loads: '1.3',
  region_projects: '1.3',
  // 1.2.7 „Заедно на пътя“
  escorts: '1.4',
  partner_ratings: '1.4',
  city_cafe: '1.4',
  road_wave: '1.4',
  convoy_hour: '1.4',
  item_wants: '1.4',
  rumors: '1.4',
  duo_week: '1.4',
  // 1.2.8 „Жива картина“
  map_live: '1.4',
  showroom_3d: '1.2.3.5', // moved up from 1.2.8: the garage opens now
  // 1.2.4 „Преди зимата“: winter goods and the server goal before 1 December, Black Friday in the shop and on the board.
  winter_prep: '1.3',
  black_friday: '1.3',
  // 1.2.5 „Първи сняг“: named seasons, the pass of 50 levels with weekly tasks and titles, clearing the roads, „Крал на снега“.
  season_v2: '1.3',
  inventory_menu: '1.2.1',
  item_trade: '1.2.1',
  workshop: '1.2.1',
  item_album: '1.2.1',
  item_chests: '1.2.1',
  // 1.1.4.4: an independent driver may hire drivers (up to 3) without a company.
  hire_solo: '1.1.4.4',
  // v1.1.4: countdowns, ideas with votes, Ден на будителите, my day, compare, roadmap.
  countdowns: '1.1.4',
  ideas: '1.1.4',
  buditeli: '1.1.4',
  daily_summary: '1.1.4',
  compare_players: '1.1.4',
  roadmap: '1.1.4',
  // More goods on every cargo, some fragile, valuable or dangerous (the players asked for them).
  more_goods: '1.1.4',
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
  // 1.2 additions: the inventory with items and cases, drivers' portraits, Truck Pass on the season page.
  inventory: '1.2',
  driver_portraits: '1.2',
  truck_pass: '1.2',
  company_plot: '1.4',
  // 1.3.2 „Просто“: one menu of five places, pages instead of windows, a shorter board.
  simple_menu: '1.3.2',
  // 1.4 „Коледна нощ“: the December season (its pass, tasks and „Дядо Коледа на пътищата“).
  christmas_night: '1.4',
  // 1.4 „Пътна служба“: real passes close in winter; salt and sand loads open them for everyone.
  road_service: '1.4',
  // 1.4 „Градски куриер“: a delivery van on the real streets of Sofia, Plovdiv and Varna (OpenStreetMap).
  city_courier: '1.4',
  // 1.4 „Зимни игри на компаниите“ (14–27.12) and „Най-красивата коледна база“.
  winter_games: '1.4',
  // 1.4 „Първите 7 дни“: a step a day for new players.
  first_week: '1.4',
  // 1.4 „Персонал на базата“: a mechanic, a dispatcher, a cook and an instructor for the base.
  base_staff: '1.4',
  plot_guests: '1.4',
  livery: '1.4',
  maintenance: '1.4',
  plot_season: '1.4',
  plot_decor: '1.4',
  plot_expand: '1.4',
  company_fleet: '1.4',
  build_badges: '1.4',
  build_boom: '1.4',
  company_polls: '1.4',
  chat_replies: '1.4',
  chat_unread: '1.4',
  chat_reactions: '1.4',
  chat_pin: '1.4',
  chat_online: '1.4',
  truck_notes: '1.4',
  plot_night: '1.4',
  plot_weather: '1.4',
  plot_visits: '1.4',
  company_trophies: '1.4',
  builder_week: '1.4',
  build_last_load: '1.4',
  partial_loads: '1.4',
  shared_loads: '1.4',
  daily_load: '1.4',
  duels: '1.4',
  livery_contest: '1.4',
  // 1.2.3: released early (built for a later update).
  roadside_paid: '1.2.3',
  ferries: '1.5',
  rail: '1.5',
  port_loads: '1.5',
  ship_calls: '1.5',
  real_weather: '1.5',
  factories: '1.5',
  freight_exchange: '1.5',
  branches: '1.5',
  loans: '1.5',
  electric: '1.5',
  driver_moods: '1.5',
  cosmetics: '1.5',
  rally: '1.5',
  company_report: '1.5',
  trailer_upgrades: '1.5',
  company_trailers: '1.5',
  marta: '1.6',
  // 1.2.3: released early (built for a later update).
  night_shift: '1.2.3',
  road_works: '1.6',
  oversize: '1.6',
  fuel_station: '1.6',
  alliances: '1.6',
  company_contracts: '1.6',
  academy: '1.6',
  divisions: '1.6',
  perfect_run: '1.6',
  city_album: '1.6',
  garage_showcase: '1.6',
  discord_rally: '1.6',
  predictions: '1.6',
  event_autostart: '1.6',
  trailer_cosmetics: '1.6',
  easter: '1.8',
  seasonal_tyres: '1.6',
  cargo_insurance: '1.6',
  urgent_raise: '1.6',
  tachograph: '1.6',
  alliance_market: '1.6',
  staff_bus: '1.6',
  anniversary: '1.6',
  profile_showcase: '1.6',
  perfect_convoy: '1.6',
  lane_records: '1.6',
  compensation: '1.6',
  alliance_convoy: '1.6',
  alliance_help: '1.6',
  alliance_fuel: '1.6',
  alliance_map: '1.6',
  alliance_hall: '1.6',
  alliance_discord: '1.6',
  polygon: '1.6',
  chronicle: '1.6',
  warehouse_clearance: '1.6',
  driver_of_month: '1.6',
  test_drive: '1.6',
  rush_hour: '1.6',
  retro_collection: '1.6',
  spring: '1.7',
  pass_opening: '1.7',
  sowing: '1.7',
  national_days: '1.7',
  route_choice: '1.7',
  secure_parking: '1.7',
  border_queues: '1.7',
  refuel: '1.7',
  road_traffic: '1.7',
  eurotour: '1.7',
  big_convoy: '1.7',
  weekly_challenge: '1.7',
  spring_cup: '1.7',
  specializations: '1.7',
  recruitment_board: '1.7',
  my_map: '1.7',
  legendary_trucks: '1.7',
  scrapyard: '1.7',
  museum: '1.7',
  // 1.2.3: released early (built for a later update).
  photo_mode: '1.2.3',
  plate_auction: '1.7',
  trailer_hire: '1.7',
  // 1.2.3: the countries of „Цяла Европа“ (planned for 1.7) open early.
  europe: '1.2.3',
  // v2.0 "Светът се отваря".
  // 1.2.3: the countries of the east (planned for 2.0) open early.
  open_world: '1.2.3',
  national_rankings: '2.0',
  holdings: '2.0',
  territories: '2.0',
  legacy: '2.0',
  intermodal: '2.0',
  living_economy: '2.0',
  eras: '2.0',
  cabin: '2.0',
  community_cups: '2.0',
  map_3d: '2.0',
  new_look: '2.0',
  country_tolls: '1.8',
  low_emission_zones: '1.8',
  sea_lines: '1.8',
  // v1.10 "Колони и истории".
  // 1.2.3: released early (built for a later update).
  convoy_lobby: '1.2.3',
  // 1.2.3: released early (built for a later update).
  weekly_convoy: '1.2.3',
  relay: '1.3', // released early with 1.2.4 (planned for 1.10)
  trip_log: '1.3', // released early with 1.2.4 (planned for 1.10)
  city_growth: '1.3', // released early with 1.2.4 (planned for 1.10)
  harvest: '1.11',
  story: '1.11',
  road_choices: '1.11',
  reefer: '1.3', // released early with 1.2.4 (planned for 1.10)
  // v1.9 "Светлини и сенки".
  simple_nav: '1.10',
  progressive_unlock: '1.10',
  next_steps: '1.10',
  // 1.2.2: released with the new menu („Къде е…?“ in „Още“); planned for 1.9 before.
  command_palette: '1.2.2',
  glossary: '1.10',
  simple_board: '1.10',
  notification_digest: '1.10',
  departments: '1.10',
  general_assembly: '1.10',
  key_clients: '1.10',
  owner_report: '1.10',
  company_logo: '1.10',
  company_history: '1.10',
  company_traditions: '1.10',
  interns: '1.10',
  mergers: '1.10',
  smuggling: '1.10',
  // v1.8 "Жив път".
  // 1.2.3: released early (built for a later update).
  cb_radio: '1.2.3',
  // 1.2.3: released early (built for a later update).
  road_reports: '1.2.3',
  // 1.2.3: released early (built for a later update).
  postcards: '1.2.3',
  // 1.2.3: released early (built for a later update).
  hitchhikers: '1.2.3',
  // 1.2.3: released early (built for a later update).
  sealed_cargo: '1.2.3',
  // 1.2.3: released early (built for a later update).
  haggling: '1.2.3',
  ghost_record: '1.3', // released early with 1.2.4 (planned for 1.8)
  share_market: '1.9',
  humanitarian: '1.3', // released early with 1.2.4 (planned for 1.8)
  truck_contest: '1.3', // released early with 1.2.4 (planned for 1.8)
  trans_europe: '1.8',
  grand_eurotour: '1.8',
  country_kings: '1.8',
  regional_events: '1.8',
  discord_country: '1.8',
  country_map: '1.8',
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
