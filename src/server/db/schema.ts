import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const money = (name: string) => bigint(name, { mode: 'number' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

// ── Real-world geography (imported from GeoNames, never invented) ─────────

export const countries = pgTable('countries', {
  code: text('code').primaryKey(), // ISO 3166-1 alpha-2
  iso3: text('iso3').notNull(),
  nameEn: text('name_en').notNull(),
  nameBg: text('name_bg').notNull(),
  continent: text('continent').notNull(),
  geonameId: integer('geoname_id').notNull(),
});

export const cities = pgTable(
  'cities',
  {
    id: integer('id').primaryKey(), // GeoNames id — stable across languages
    countryCode: text('country_code').notNull().references(() => countries.code),
    name: text('name').notNull(),
    nameBg: text('name_bg').notNull(),
    region: text('region'),
    regionBg: text('region_bg'),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    population: integer('population').notNull(),
    timezone: text('timezone').notNull(),
  },
  (t) => [
    index('cities_country_idx').on(t.countryCode),
    index('cities_lat_lon_idx').on(t.lat, t.lon),
    index('cities_population_idx').on(t.population),
  ],
);

export const ports = pgTable('ports', {
  id: integer('id').primaryKey(), // GeoNames id
  name: text('name').notNull(),
  nameBg: text('name_bg'),
  countryCode: text('country_code').notNull().references(() => countries.code),
  cityId: integer('city_id').notNull().references(() => cities.id),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
});

/** Cached road routes from the routing provider (or an explicit approximation). */
export const routes = pgTable(
  'routes',
  {
    id: serial('id').primaryKey(),
    fromCityId: integer('from_city_id').notNull().references(() => cities.id),
    toCityId: integer('to_city_id').notNull().references(() => cities.id),
    profile: text('profile').notNull(), // 'truck' | 'van'
    provider: text('provider').notNull(), // 'valhalla' | 'approximate'
    distanceKm: real('distance_km').notNull(),
    durationS: integer('duration_s').notNull(),
    hasToll: boolean('has_toll').notNull(),
    /** Border crossings with their position along the route (km). */
    borders: jsonb('borders').$type<{ km: number; from: string; to: string }[]>().notNull(),
    countries: text('countries').array().notNull(),
    /** Encoded polyline (precision 6); null for approximations. */
    geometry: text('geometry'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('routes_pair_idx').on(t.fromCityId, t.toCityId, t.profile)],
);

// ── Game economy layered over the real world (simulated data) ─────────────

/** Simulated demand per city and cargo type — game data, not real statistics. */
export const cityMarkets = pgTable(
  'city_markets',
  {
    cityId: integer('city_id').notNull().references(() => cities.id),
    cargoType: text('cargo_type').notNull(),
    produces: boolean('produces').notNull(),
    consumes: boolean('consumes').notNull(),
    demand: real('demand').notNull().default(1),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.cityId, t.cargoType] })],
);

export const marketEvents = pgTable('market_events', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  countryCode: text('country_code').references(() => countries.code),
  cargoType: text('cargo_type'),
  multiplier: real('multiplier').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
});

// ── Accounts ──────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    xp: integer('xp').notNull().default(0),
    level: integer('level').notNull().default(1),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at'),
  },
  (t) => [uniqueIndex('users_email_idx').on(sql`lower(${t.email})`), uniqueIndex('users_username_idx').on(sql`lower(${t.username})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token; the token itself only lives in the cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: ts('window_start').notNull(),
  count: integer('count').notNull(),
});

// ── Companies and assets ──────────────────────────────────────────────────

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    hqCityId: integer('hq_city_id').notNull().references(() => cities.id),
    balanceCents: money('balance_cents').notNull(),
    reputation: real('reputation').notNull().default(0),
    deliveries: integer('deliveries').notNull().default(0),
    onTimeDeliveries: integer('on_time_deliveries').notNull().default(0),
    totalKm: real('total_km').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('companies_owner_idx').on(t.ownerId), uniqueIndex('companies_name_idx').on(sql`lower(${t.name})`)],
);

export const depots = pgTable(
  'depots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    cityId: integer('city_id').notNull().references(() => cities.id),
    slots: integer('slots').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('depots_company_city_idx').on(t.companyId, t.cityId)],
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    modelId: text('model_id').notNull(),
    plate: text('plate').notNull(),
    color: text('color').notNull(),
    /** Parking city when idle; last known city otherwise. */
    cityId: integer('city_id').notNull().references(() => cities.id),
    status: text('status').notNull().default('idle'), // idle | on_delivery
    condition: real('condition').notNull().default(100),
    odometerKm: real('odometer_km').notNull().default(0),
    upgrades: text('upgrades').array().notNull().default(sql`'{}'::text[]`),
    purchasePriceCents: money('purchase_price_cents').notNull(),
    purchasedAt: createdAt(),
    /** Sold vehicles stay for delivery history but are no longer part of the fleet. */
    soldAt: ts('sold_at'),
  },
  (t) => [index('vehicles_company_idx').on(t.companyId)],
);

export const trailers = pgTable(
  'trailers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    modelId: text('model_id').notNull(),
    plate: text('plate').notNull(),
    cityId: integer('city_id').notNull().references(() => cities.id),
    /** Coupled tractor, if any. A tractor tows at most one trailer. */
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    condition: real('condition').notNull().default(100),
    purchasePriceCents: money('purchase_price_cents').notNull(),
    purchasedAt: createdAt(),
    soldAt: ts('sold_at'),
  },
  (t) => [index('trailers_company_idx').on(t.companyId), uniqueIndex('trailers_vehicle_idx').on(t.vehicleId)],
);

export const drivers = pgTable(
  'drivers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    skill: integer('skill').notNull(),
    xp: integer('xp').notNull().default(0),
    salaryCentsPerDay: integer('salary_cents_per_day').notNull(),
    /** Assigned vehicle. One driver per vehicle. */
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    hiredAt: createdAt(),
  },
  (t) => [index('drivers_company_idx').on(t.companyId), uniqueIndex('drivers_vehicle_idx').on(t.vehicleId)],
);

export const driverCandidates = pgTable(
  'driver_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    skill: integer('skill').notNull(),
    salaryCentsPerDay: integer('salary_cents_per_day').notNull(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('driver_candidates_company_idx').on(t.companyId)],
);

// ── Freight market and deliveries ─────────────────────────────────────────

export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shipper: text('shipper').notNull(), // NPC shipper name (game data)
    goods: text('goods').notNull(),
    cargoType: text('cargo_type').notNull(),
    weightTons: real('weight_tons').notNull(),
    originCityId: integer('origin_city_id').notNull().references(() => cities.id),
    destCityId: integer('dest_city_id').notNull().references(() => cities.id),
    routeId: integer('route_id').notNull().references(() => routes.id),
    distanceKm: real('distance_km').notNull(),
    rewardCents: money('reward_cents').notNull(),
    /** Delivery window, counted from acceptance. */
    windowMinutes: integer('window_minutes').notNull(),
    minLevel: integer('min_level').notNull().default(1),
    status: text('status').notNull().default('open'), // open | accepted | expired
    acceptedByCompanyId: uuid('accepted_by_company_id').references(() => companies.id),
    acceptedAt: ts('accepted_at'),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('contracts_status_idx').on(t.status, t.expiresAt), index('contracts_origin_idx').on(t.originCityId)],
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractId: uuid('contract_id').notNull().references(() => contracts.id),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id),
    trailerId: uuid('trailer_id').references(() => trailers.id),
    driverId: uuid('driver_id').notNull().references(() => drivers.id),
    status: text('status').notNull().default('in_progress'), // in_progress | completed
    emptyRouteId: integer('empty_route_id').references(() => routes.id),
    routeId: integer('route_id').notNull().references(() => routes.id),
    emptyKm: real('empty_km').notNull(),
    loadedKm: real('loaded_km').notNull(),
    schedule: jsonb('schedule').notNull(),
    estimatedCosts: jsonb('estimated_costs').notNull(),
    startedAt: ts('started_at').notNull(),
    etaAt: ts('eta_at').notNull(),
    deadlineAt: ts('deadline_at').notNull(),
    completedAt: ts('completed_at'),
    late: boolean('late'),
    payoutCents: money('payout_cents'),
    xpAwarded: integer('xp_awarded'),
  },
  (t) => [
    uniqueIndex('deliveries_contract_idx').on(t.contractId),
    index('deliveries_due_idx').on(t.status, t.etaAt),
    index('deliveries_company_idx').on(t.companyId, t.status),
  ],
);

// ── Finance ───────────────────────────────────────────────────────────────

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    amountCents: money('amount_cents').notNull(),
    balanceAfterCents: money('balance_after_cents').notNull(),
    description: text('description').notNull(),
    /** Unique per real-world cause, so a retry can never pay twice. */
    idempotencyKey: text('idempotency_key').notNull(),
    refType: text('ref_type'),
    refId: text('ref_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('ledger_idempotency_idx').on(t.idempotencyKey), index('ledger_company_idx').on(t.companyId, t.createdAt)],
);

// ── Progression, seasons, notifications, activity ─────────────────────────

export const achievements = pgTable(
  'achievements',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    unlockedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const seasons = pgTable('seasons', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  status: text('status').notNull(), // active | finished
  rules: jsonb('rules').notNull(),
});

export const seasonScores = pgTable(
  'season_scores',
  {
    seasonId: integer('season_id').notNull().references(() => seasons.id),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    points: integer('points').notNull().default(0),
    deliveries: integer('deliveries').notNull().default(0),
    revenueCents: money('revenue_cents').notNull().default(0),
    finalRank: integer('final_rank'),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.companyId] }), index('season_scores_points_idx').on(t.seasonId, t.points)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // success | info | warning | achievement
    title: text('title').notNull(),
    body: text('body').notNull(),
    href: text('href'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const activity = pgTable(
  'activity',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    details: jsonb('details').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('activity_user_idx').on(t.userId, t.createdAt)],
);

/** Bookkeeping for background jobs (last run, leases). */
export const jobState = pgTable('job_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
