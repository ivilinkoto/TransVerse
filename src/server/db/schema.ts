import { sql } from 'drizzle-orm';
import {
  customType,
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
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
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
    /** player | support | admin | founder */
    role: text('role').notNull().default('player'),
    bannedAt: ts('banned_at'),
    banReason: text('ban_reason'),
    /** Onboarding progress: completed step keys and whether it was dismissed. */
    tutorial: jsonb('tutorial').$type<{ done: string[]; dismissed?: boolean; rewarded?: boolean }>().notNull().default({ done: [] }),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at'),
    /** VIP status (granted by an administrator or bought in the shop); active while in the future. */
    vipUntil: ts('vip_until'),
    /** ТрансКоин — premium currency balance (whole coins). Changes only through coin_entries. */
    coins: integer('coins').notNull().default(0),
    /** Double delivery XP while in the future (shop booster). */
    xpBoostUntil: ts('xp_boost_until'),
    /** Daily mission period of the last free VIP mission swap. */
    vipRerollKey: text('vip_reroll_key'),
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
    /**
     * independent — a self-employed driver with a rented truck (every new player);
     * company — a licensed operator who founded (or took over) a transport company:
     * may buy and rent vehicles, hire drivers and open depots. The company itself
     * (name, members, treasury) lives in `organizations`.
     */
    kind: text('kind').notNull().default('company'),
    /** Home city of the player's own business (first depot). */
    hqCityId: integer('hq_city_id').notNull().references(() => cities.id),
    /** When the player got the operator licence (founded a company). */
    foundedAt: ts('founded_at'),
    balanceCents: money('balance_cents').notNull(),
    reputation: real('reputation').notNull().default(0),
    deliveries: integer('deliveries').notNull().default(0),
    onTimeDeliveries: integer('on_time_deliveries').notNull().default(0),
    totalKm: real('total_km').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('companies_owner_idx').on(t.ownerId)],
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
    /** owned | rented — rented vehicles pay a fee per delivery instead of running costs. */
    ownership: text('ownership').notNull().default('owned'),
    purchasePriceCents: money('purchase_price_cents').notNull(),
    purchasedAt: createdAt(),
    /** Sold (or returned) vehicles stay for delivery history but are no longer part of the fleet. */
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
    ownership: text('ownership').notNull().default('owned'),
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
    /** The player themself (no salary, cannot be dismissed). */
    isOwner: boolean('is_owner').notNull().default(false),
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
    /** Urgent shipment created by an administrator: shown first and driven faster. */
    urgent: boolean('urgent').notNull().default(false),
    /** VIP reservation: only this player may take the contract until reservedUntil. */
    reservedByCompanyId: uuid('reserved_by_company_id').references(() => companies.id, { onDelete: 'set null' }),
    reservedUntil: ts('reserved_until'),
    /** How much faster than normal game time the trip runs (urgent shipments). */
    speedFactor: real('speed_factor').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
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
    /** Per-delivery fee for rented vehicles (replaces fuel, tolls and maintenance). */
    rentalFeeCents: money('rental_fee_cents'),
    /** 1 = real-time schedule (legacy), 2 = compressed game time. */
    scheduleVersion: integer('schedule_version').notNull().default(1),
  },
  (t) => [
    // One delivery per contract and player; ordinary contracts are additionally single-winner (status claim), urgent ones are open to everyone.
    uniqueIndex('deliveries_contract_company_idx').on(t.contractId, t.companyId),
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

// ── Support and administration ────────────────────────────────────────────

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    category: text('category').notNull(), // account | bug | gameplay | payment | other
    status: text('status').notNull().default('open'), // open | answered | closed
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('support_tickets_user_idx').on(t.userId, t.updatedAt), index('support_tickets_status_idx').on(t.status, t.updatedAt)],
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ticketId: uuid('ticket_id').notNull().references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Written by staff (support/admin/founder) rather than the player. */
    staff: boolean('staff').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('support_messages_ticket_idx').on(t.ticketId, t.id)],
);

/** Every administrative action, for accountability. */
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: uuid('actor_id').notNull().references(() => users.id),
    action: text('action').notNull(),
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    details: jsonb('details').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('admin_audit_created_idx').on(t.createdAt)],
);

// ── Carrier licences ──────────────────────────────────────────────────────

export const userLicences = pgTable(
  'user_licences',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    licence: text('licence').notNull(),
    /** Price paid; 0 when granted (e.g. kept from before licences existed). */
    priceCents: money('price_cents').notNull().default(0),
    source: text('source').notNull().default('purchase'), // purchase | legacy | admin
    acquiredAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.licence] })],
);

// ── ТрансКоин (premium currency) ───────────────────────────────────────────

/** Every movement of ТрансКоин, written exactly once (idempotency key). */
export const coinEntries = pgTable(
  'coin_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    /** admin_grant | admin_remove | purchase | shop | gift_received | refund */
    reason: text('reason').notNull(),
    description: text('description').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('coin_entries_idempotency_idx').on(t.idempotencyKey), index('coin_entries_user_idx').on(t.userId, t.createdAt)],
);

// ── Missions ───────────────────────────────────────────────────────────────

/** A mission given to a player for one period (target and reward frozen at assignment). */
export const missionProgress = pgTable(
  'mission_progress',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** e.g. D2026-10-16, W2026-42, M2026-10, S3 */
    periodKey: text('period_key').notNull(),
    missionId: text('mission_id').notNull(),
    period: text('period').notNull(), // daily | weekly | monthly | season
    target: real('target').notNull(),
    progress: real('progress').notNull().default(0),
    rewardCents: money('reward_cents').notNull(),
    rewardXp: integer('reward_xp').notNull(),
    /** Extra state, e.g. the countries already delivered to. */
    data: jsonb('data').$type<{ countries?: string[] }>().notNull().default({}),
    endsAt: ts('ends_at').notNull(),
    completedAt: ts('completed_at'),
    claimedAt: ts('claimed_at'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.periodKey, t.missionId] }), index('mission_progress_user_idx').on(t.userId, t.endsAt)],
);

// ── Player companies (organisations with members and their own treasury) ──

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Current owner; ownership can be handed over to another member. */
    ownerId: uuid('owner_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    hqCityId: integer('hq_city_id').notNull().references(() => cities.id),
    tag: text('tag'),
    description: text('description'),
    rules: text('rules'),
    color: text('color'),
    /** open | application | closed */
    recruitment: text('recruitment').notNull().default('application'),
    minJoinLevel: integer('min_join_level').notNull().default(1),
    /** Share of each member's freight reward paid into the treasury. */
    contributionRate: real('contribution_rate').notNull().default(0.05),
    companyXp: integer('company_xp').notNull().default(0),
    companyLevel: integer('company_level').notNull().default(1),
    /** Purchased upgrade levels, e.g. { logistics: 2 }. */
    upgrades: jsonb('upgrades').$type<Record<string, number>>().notNull().default({}),
    brandingVersion: integer('branding_version').notNull().default(0),
    /** The company's own money — separate from every member's (and the owner's) personal balance. */
    treasuryCents: money('treasury_cents').notNull().default(0),
    foundedAt: ts('founded_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('organizations_name_idx').on(sql`lower(${t.name})`), uniqueIndex('organizations_owner_idx').on(t.ownerId)],
);

/** Treasury ledger: every movement of company money, written exactly once (idempotency key). */
export const treasuryEntries = pgTable(
  'treasury_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    amountCents: money('amount_cents').notNull(),
    balanceAfterCents: money('balance_after_cents').notNull(),
    description: text('description').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    idempotencyKey: text('idempotency_key').notNull(),
    refType: text('ref_type'),
    refId: text('ref_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('treasury_idempotency_idx').on(t.idempotencyKey), index('treasury_org_idx').on(t.organizationId, t.createdAt)],
);

// ── Company membership ────────────────────────────────────────────────────

export const companyRanks = pgTable(
  'company_ranks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Lower = more senior. The owner rank is 0 and unique. */
    priority: integer('priority').notNull(),
    permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
    isOwner: boolean('is_owner').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('company_ranks_company_idx').on(t.companyId, t.priority)],
);

export const companyMembers = pgTable(
  'company_members',
  {
    /** A player belongs to at most one company. */
    userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    rankId: uuid('rank_id').notNull().references(() => companyRanks.id),
    joinedAt: createdAt(),
    deliveries: integer('deliveries').notNull().default(0),
    contributedCents: money('contributed_cents').notNull().default(0),
    xpContributed: integer('xp_contributed').notNull().default(0),
  },
  (t) => [index('company_members_company_idx').on(t.companyId)],
);

export const companyApplications = pgTable(
  'company_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    message: text('message').notNull().default(''),
    status: text('status').notNull().default('pending'), // pending | accepted | rejected | withdrawn
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    decidedAt: ts('decided_at'),
  },
  (t) => [
    index('company_applications_company_idx').on(t.companyId, t.status),
    uniqueIndex('company_applications_pending_idx').on(t.companyId, t.userId).where(sql`${t.status} = 'pending'`),
  ],
);

/** Logo and banner images (validated PNG/JPEG/WebP, size-limited). */
export const companyAssets = pgTable(
  'company_assets',
  {
    companyId: uuid('company_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // logo | banner
    mime: text('mime').notNull(),
    data: bytea('data').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.kind] })],
);
