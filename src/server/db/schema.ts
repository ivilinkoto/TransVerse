import { sql } from 'drizzle-orm';
import type { RoadEventPlan } from '@/lib/game/road-events';
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
    /** When the player clicked the link in the confirmation e-mail. */
    emailVerifiedAt: ts('email_verified_at'),
    /** Which push notifications the player wants (missing = on). */
    /** Daily reward: consecutive days claimed and the last claimed day (Sofia, e.g. D2026-10-17). */
    loginStreak: integer('login_streak').notNull().default(0),
    dailyClaimKey: text('daily_claim_key'),
    pushPrefs: jsonb('push_prefs').$type<Partial<Record<string, boolean>>>().notNull().default({}),
    lastSeenAt: ts('last_seen_at'),
    /** Last game version whose "Какво ново" window the player has closed (null = none yet). */
    seenVersion: text('seen_version'),
    /** Seasonal decorations (Halloween…) on or off for this player. */
    seasonalTheme: boolean('seasonal_theme').notNull().default(true),
    /** Available to drive loads handed over by companies (for a commission). */
    forHire: boolean('for_hire').notNull().default(false),
    /** Offers to mentor new players (level 15+). */
    mentorOpen: boolean('mentor_open').notNull().default(false),
    /** One-time hints the player has closed. */
    seenHints: text('seen_hints').array().notNull().default(sql`'{}'::text[]`),
    /** No phone notifications between these hours (Sofia), e.g. { from: 23, to: 8 }; null = none. */
    quietHours: jsonb('quiet_hours').$type<{ from: number; to: number } | null>(),
    /** VIP status (granted by an administrator or bought in the shop); active while in the future. */
    vipUntil: ts('vip_until'),
    /** ТрансКоин — premium currency balance (whole coins). Changes only through coin_entries. */
    coins: integer('coins').notNull().default(0),
    /** Double delivery XP while in the future (shop booster). */
    xpBoostUntil: ts('xp_boost_until'),
    /** Daily mission period of the last free VIP mission swap. */
    vipRerollKey: text('vip_reroll_key'),
    /** Personal invite code (created when first needed). */
    referralCode: text('referral_code'),
    /** Player whose invite link was used to sign up. */
    referredById: uuid('referred_by_id'),
    /** When the invite for this (invited) player was settled, and how: rewarded | declined. */
    referralRewardedAt: ts('referral_rewarded_at'),
    referralOutcome: text('referral_outcome'),
    /** Moderation: no chat or private messages until then. */
    chatMutedUntil: ts('chat_muted_until'),
    /** Weekly league tier: 0 Бронз … 4 Диамант. */
    leagueTier: integer('league_tier').notNull().default(0),
    /** Profile picture: 0 = none; bumped on every upload (cache busting in the image URL). */
    avatarVersion: integer('avatar_version').notNull().default(0),
    /** SHA-256 of the sign-up IP with a server salt — only compared for invite rewards. */
    signupIpHash: text('signup_ip_hash'),
  },
  (t) => [uniqueIndex('users_email_idx').on(sql`lower(${t.email})`), uniqueIndex('users_username_idx').on(sql`lower(${t.username})`), uniqueIndex('users_referral_code_idx').on(t.referralCode), index('users_referred_by_idx').on(t.referredById)],
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
    /** Special paint scheme on top of the colour (e.g. 'pumpkin' from Halloween 2026); null = plain colour. */
    livery: text('livery'),
    /** Insurance paid up to this time (covers road-assistance bills of breakdowns). */
    insuredUntil: ts('insured_until'),
    /** VIP: the dispatcher sends this truck on its next job by itself when it is free. */
    autoDispatch: boolean('auto_dispatch').notNull().default(false),
    /** owned | rented — rented vehicles pay a fee per delivery instead of running costs. */
    ownership: text('ownership').notNull().default('owned'),
    /** Rented truck to be returned as soon as its current trip ends (the player bought their own). */
    returnPending: boolean('return_pending').notNull().default(false),
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
    /** Offered on the used-vehicle market (cannot be coupled meanwhile). */
    listed: boolean('listed').notNull().default(false),
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
    /** Second seat: a co-driver makes the vehicle a team (one per vehicle). */
    coVehicleId: uuid('co_vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    /** Driving minutes since the last daily rest, as left by the last trip; void once restedAt has passed. */
    dutyMin: real('duty_min').notNull().default(0),
    restedAt: ts('rested_at'),
    /** Skill points spent: eco / safe / long, 0..3 each. */
    traits: jsonb('traits').$type<Partial<Record<'eco' | 'safe' | 'long', number>>>().notNull().default({}),
    hiredAt: createdAt(),
  },
  (t) => [index('drivers_company_idx').on(t.companyId), uniqueIndex('drivers_vehicle_idx').on(t.vehicleId), uniqueIndex('drivers_co_vehicle_idx').on(t.coVehicleId)],
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
    /** Premium contracts: only players with at least this reputation can take them (they pay more). */
    minReputation: integer('min_reputation').notNull().default(0),
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
    /** Load of a company tender: only members of that company may take it. */
    tenderId: uuid('tender_id'),
    /** Own goods hauled by a player (trading): only that player's account may take it; never on the public board. */
    tradeCompanyId: uuid('trade_company_id'),
    trade: jsonb('trade').$type<{ mode: 'sell' | 'store'; tons: number; costCents: number; destDepotId?: string | null }>(),
    /** Holiday load (e.g. 'halloween'): themed goods, better pay, counts for the holiday event and quests. */
    holiday: text('holiday'),
    /** A special load won on auction (private to the winner; ТрансКоин on delivery). */
    auctionId: uuid('auction_id'),
    /** One load of a long-term client contract (private, like trade lots). */
    clientContractId: uuid('client_contract_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('contracts_status_idx').on(t.status, t.expiresAt), index('contracts_origin_idx').on(t.originCityId), index('contracts_tender_idx').on(t.tenderId)],
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
    coDriverId: uuid('co_driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    /** Sent by the VIP auto-dispatcher (counts toward its daily limit). */
    autoDispatched: boolean('auto_dispatched').notNull().default(false),
    /** The other trip of a convoy (a friend or company member on the same lane); both get a bonus on time. */
    convoyWith: uuid('convoy_with'),
    /** Risks the player chose for this trip: 'hours' (no rest), 'overload'. */
    violations: text('violations').array().notNull().default(sql`'{}'::text[]`),
    /** Driving minutes the crew has used since its last daily rest when the trip ends (both drivers together). */
    endDutyMin: real('end_duty_min').notNull().default(0),
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
    /** Road events planned at acceptance (server only) and applied when the truck gets there. */
    roadEvents: jsonb('road_events').$type<RoadEventPlan[]>().notNull().default([]),
    /** Time of the next unapplied road event (null when none is left). */
    nextEventAt: ts('next_event_at'),
  },
  (t) => [
    index('deliveries_next_event_idx').on(t.nextEventAt),
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

/** Season points of player companies (organizations): the sum of their members' points earned while members. */
export const organizationSeasonScores = pgTable(
  'organization_season_scores',
  {
    seasonId: integer('season_id').notNull().references(() => seasons.id),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    points: integer('points').notNull().default(0),
    deliveries: integer('deliveries').notNull().default(0),
    finalRank: integer('final_rank'),
    prizeCents: money('prize_cents'),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.organizationId] }), index('organization_season_scores_points_idx').on(t.seasonId, t.points)],
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

/** Company chat. Only members read and write; deleted messages keep a placeholder. */
export const companyMessages = pgTable(
  'company_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    companyId: uuid('company_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('company_messages_company_idx').on(t.companyId, t.id)],
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

// ── Global events (community goals for all players) ──────────────────────

export interface GlobalEventRewards {
  /** Every participant who reached the minimum contribution (only when the goal is reached). */
  participant: { cents: number; xp: number; coins: number };
  /** Extra rewards for places 1..N by contribution. */
  top: { cents: number; xp: number; coins: number; vipDays: number }[];
}

export const globalEvents = pgTable(
  'global_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** What counts: tons | deliveries | km | on_time | international | heavy | long_haul | earned_cents */
    metric: text('metric').notNull(),
    /** Optional filters: only this cargo type / only routes touching this country. */
    cargoType: text('cargo_type'),
    countryCode: text('country_code'),
    target: doublePrecision('target').notNull(),
    progress: doublePrecision('progress').notNull().default(0),
    /** Smallest contribution that counts as taking part. */
    minContribution: doublePrecision('min_contribution').notNull(),
    rewards: jsonb('rewards').$type<GlobalEventRewards>().notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    /** Game time the goal was reached; contributions after it do not count. */
    completedAt: ts('completed_at'),
    settledAt: ts('settled_at'),
    outcome: text('outcome'), // success | failed | cancelled
    /** Template id for automatic events, null for ones made by an administrator. */
    template: text('template'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('global_events_time_idx').on(t.endsAt, t.startsAt)],
);

export const globalEventContributions = pgTable(
  'global_event_contributions',
  {
    eventId: uuid('event_id').notNull().references(() => globalEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** The player's company when they last contributed (for the company table). */
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    amount: doublePrecision('amount').notNull().default(0),
    deliveries: integer('deliveries').notNull().default(0),
    firstAt: ts('first_at').notNull().defaultNow(),
    /** Set at settlement. */
    rank: integer('rank'),
    reward: jsonb('reward').$type<{ cents: number; xp: number; coins: number; vipDays: number }>(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] }), index('global_event_contributions_rank_idx').on(t.eventId, t.amount)],
);

// ── Company missions (weekly goals for the whole company) ────────────────

export const companyMissionProgress = pgTable(
  'company_mission_progress',
  {
    companyId: uuid('company_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    /** Week key, e.g. W2026-42 */
    periodKey: text('period_key').notNull(),
    missionId: text('mission_id').notNull(),
    target: real('target').notNull(),
    progress: real('progress').notNull().default(0),
    rewardCents: money('reward_cents').notNull(),
    rewardXp: integer('reward_xp').notNull(),
    /** Contribution by member (user id → amount). */
    data: jsonb('data').$type<{ members?: Record<string, number> }>().notNull().default({}),
    endsAt: ts('ends_at').notNull(),
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.periodKey, t.missionId] })],
);

// ── Real-money payments (Stripe Checkout) ────────────────────────────────

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull().default('stripe'),
    productId: text('product_id').notNull(),
    coins: integer('coins').notNull().default(0),
    vipDays: integer('vip_days').notNull().default(0),
    /** What the buyer pays, in the smallest currency unit. */
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('eur'),
    status: text('status').notNull().default('pending'), // pending | paid | failed | expired | refunded
    checkoutSessionId: text('checkout_session_id'),
    paymentIntentId: text('payment_intent_id'),
    /** PayPal: the order and its capture. */
    orderId: text('order_id'),
    captureId: text('capture_id'),
    /** Why the provider refused (error code and reference) — for the admin panel. */
    failureReason: text('failure_reason'),
    /** When the buyer agreed that delivery starts at once (EU right of withdrawal for digital content). */
    consentAt: ts('consent_at').notNull(),
    createdAt: createdAt(),
    paidAt: ts('paid_at'),
    refundedAt: ts('refunded_at'),
  },
  (t) => [
    uniqueIndex('payments_session_idx').on(t.checkoutSessionId),
    index('payments_intent_idx').on(t.paymentIntentId),
    uniqueIndex('payments_order_idx').on(t.orderId),
    index('payments_capture_idx').on(t.captureId),
    index('payments_pending_idx').on(t.provider, t.status, t.createdAt),
    index('payments_user_idx').on(t.userId, t.createdAt),
  ],
);

/** Licences bought by a player company (at double price) — every member may use them. */
export const companyLicences = pgTable(
  'company_licences',
  {
    companyId: uuid('company_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    licence: text('licence').notNull(),
    priceCents: money('price_cents').notNull().default(0),
    boughtBy: uuid('bought_by').references(() => users.id, { onDelete: 'set null' }),
    acquiredAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.licence] })],
);

// ── Push notifications and e-mail links ──────────────────────────────────

/** A browser/phone that receives push notifications for a player (Web Push). */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSuccessAt: ts('last_success_at'),
    /** Last failed send: when, and what the push service answered (admin diagnostics). */
    lastErrorAt: ts('last_error_at'),
    lastError: text('last_error'),
  },
  (t) => [uniqueIndex('push_subscriptions_endpoint_idx').on(t.endpoint), index('push_subscriptions_user_idx').on(t.userId)],
);

/** One-time links sent by e-mail (confirm address, reset password). Only a hash of the token is stored. */
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // verify | reset
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('email_tokens_hash_idx').on(t.tokenHash), index('email_tokens_user_idx').on(t.userId, t.kind)],
);

// ── Company tenders (big orders the members deliver together) ───────────

export const companyTenders = pgTable(
  'company_tenders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    /** offer → active (accepted) → completed | failed; offers that are not taken expire. */
    status: text('status').notNull().default('offer'),
    title: text('title').notNull(),
    goods: text('goods').notNull(),
    cargoType: text('cargo_type').notNull(),
    originCityId: integer('origin_city_id').notNull().references(() => cities.id),
    destCityId: integer('dest_city_id').notNull().references(() => cities.id),
    routeId: integer('route_id').notNull().references(() => routes.id),
    distanceKm: real('distance_km').notNull(),
    loads: integer('loads').notNull(),
    loadTons: real('load_tons').notNull(),
    /** Paid to the member who drives each load (like a normal contract). */
    rewardPerLoadCents: money('reward_per_load_cents').notNull(),
    /** Paid into the treasury when every load arrives in time. */
    bonusCents: money('bonus_cents').notNull(),
    /** Taken from the treasury on acceptance, returned on success, lost on failure. */
    depositCents: money('deposit_cents').notNull(),
    xp: integer('xp').notNull(),
    /** Time to deliver every load once accepted. */
    durationHours: integer('duration_hours').notNull(),
    offerExpiresAt: ts('offer_expires_at').notNull(),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: ts('accepted_at'),
    deadlineAt: ts('deadline_at'),
    deliveredLoads: integer('delivered_loads').notNull().default(0),
    /** Member → loads delivered. */
    drivers: jsonb('drivers').$type<Record<string, number>>().notNull().default({}),
    finishedAt: ts('finished_at'),
    createdAt: createdAt(),
  },
  (t) => [index('company_tenders_company_idx').on(t.companyId, t.status)],
);

/** Used vehicles and trailers offered by players to other players. */
export const vehicleListings = pgTable(
  'vehicle_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerCompanyId: uuid('seller_company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    /** vehicle | trailer */
    kind: text('kind').notNull(),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'cascade' }),
    trailerId: uuid('trailer_id').references(() => trailers.id, { onDelete: 'cascade' }),
    modelId: text('model_id').notNull(),
    priceCents: money('price_cents').notNull(),
    cityId: integer('city_id').notNull().references(() => cities.id),
    /** open | sold | cancelled | expired */
    status: text('status').notNull().default('open'),
    buyerCompanyId: uuid('buyer_company_id').references(() => companies.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    closedAt: ts('closed_at'),
  },
  (t) => [
    index('vehicle_listings_open_idx').on(t.status, t.createdAt),
    index('vehicle_listings_seller_idx').on(t.sellerCompanyId, t.status),
    uniqueIndex('vehicle_listings_vehicle_open_idx').on(t.vehicleId).where(sql`status = 'open'`),
    uniqueIndex('vehicle_listings_trailer_open_idx').on(t.trailerId).where(sql`status = 'open'`),
  ],
);

// ── Social: friends, company invites, private messages, world chat ───────

/** Friendship requests and friendships (one row per pair, requester → addressee). */
export const friendships = pgTable(
  'friendships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** pending | accepted */
    status: text('status').notNull().default('pending'),
    createdAt: createdAt(),
    respondedAt: ts('responded_at'),
  },
  (t) => [
    // One row per pair, whichever player asked first.
    uniqueIndex('friendships_pair_idx').on(sql`least(${t.requesterId}, ${t.addresseeId})`, sql`greatest(${t.requesterId}, ${t.addresseeId})`),
    index('friendships_addressee_idx').on(t.addresseeId, t.status),
    index('friendships_requester_idx').on(t.requesterId, t.status),
  ],
);

/** A company invites a player who is not in a company yet. */
export const companyInvites = pgTable(
  'company_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    /** pending | accepted | declined | cancelled */
    status: text('status').notNull().default('pending'),
    createdAt: createdAt(),
    decidedAt: ts('decided_at'),
  },
  (t) => [uniqueIndex('company_invites_pending_idx').on(t.companyId, t.userId).where(sql`status = 'pending'`), index('company_invites_user_idx').on(t.userId, t.status)],
);

/** Private messages between two players. Each side can hide the conversation; the sender can unsend a message. */
export const directMessages = pgTable(
  'direct_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    readAt: ts('read_at'),
    /** Unsent by the sender: gone for both. */
    deletedAt: ts('deleted_at'),
    hiddenForSender: boolean('hidden_for_sender').notNull().default(false),
    hiddenForRecipient: boolean('hidden_for_recipient').notNull().default(false),
  },
  (t) => [
    index('direct_messages_pair_idx').on(sql`least(${t.senderId}, ${t.recipientId})`, sql`greatest(${t.senderId}, ${t.recipientId})`, t.id),
    index('direct_messages_unread_idx').on(t.recipientId, t.readAt),
  ],
);

/** World chat channels shared by every player: global and trade. */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** global | trade */
    channel: text('channel').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('chat_messages_channel_idx').on(t.channel, t.id)],
);

// ── Trading, moderation, leagues, season pass ─────────────────────────────

/** Goods a player keeps in the warehouse of one of their depots. */
export const warehouseStock = pgTable(
  'warehouse_stock',
  {
    depotId: uuid('depot_id').notNull().references(() => depots.id, { onDelete: 'cascade' }),
    cargoType: text('cargo_type').notNull(),
    tons: real('tons').notNull(),
    /** What the goods in stock cost in total (average cost × tons). */
    costCents: money('cost_cents').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.depotId, t.cargoType] })],
);

/** A player hides another player: no messages, requests or invites between them; their chat lines are hidden. */
export const userBlocks = pgTable(
  'user_blocks',
  {
    blockerId: uuid('blocker_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('user_blocks_blocked_idx').on(t.blockedId)],
);

/** Reports about players or chat messages, handled in the admin panel. */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetUserId: uuid('target_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** player | channel | company | dm */
    kind: text('kind').notNull(),
    messageId: bigint('message_id', { mode: 'number' }),
    /** The reported message as it was when reported. */
    snippet: text('snippet'),
    reason: text('reason').notNull(),
    details: text('details'),
    /** open | resolved | dismissed */
    status: text('status').notNull().default('open'),
    resolution: text('resolution'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [index('reports_status_idx').on(t.status, t.createdAt), index('reports_target_idx').on(t.targetUserId)],
);

/** One group of up to 20 players in a weekly league tier. */
export const leagueGroups = pgTable(
  'league_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Monday of the week, Sofia time, e.g. W2026-10-12. */
    weekKey: text('week_key').notNull(),
    tier: integer('tier').notNull(),
    createdAt: createdAt(),
    settledAt: ts('settled_at'),
  },
  (t) => [index('league_groups_week_idx').on(t.weekKey, t.tier)],
);

export const leagueMembers = pgTable(
  'league_members',
  {
    weekKey: text('week_key').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').notNull().references(() => leagueGroups.id, { onDelete: 'cascade' }),
    tier: integer('tier').notNull(),
    points: integer('points').notNull().default(0),
    deliveries: integer('deliveries').notNull().default(0),
    joinedAt: createdAt(),
    finalRank: integer('final_rank'),
    /** up | down | stay */
    outcome: text('outcome'),
  },
  (t) => [primaryKey({ columns: [t.weekKey, t.userId] }), index('league_members_group_idx').on(t.groupId, t.points)],
);

/** A player's season pass: points from deliveries, the premium track and claimed levels. */
export const seasonPasses = pgTable(
  'season_passes',
  {
    seasonId: integer('season_id').notNull().references(() => seasons.id),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    points: integer('points').notNull().default(0),
    premium: boolean('premium').notNull().default(false),
    claimedFree: integer('claimed_free').array().notNull().default(sql`'{}'::int[]`),
    claimedPremium: integer('claimed_premium').array().notNull().default(sql`'{}'::int[]`),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.userId] })],
);

/** Profile pictures (small square images, checked by content). */
export const userAvatars = pgTable('user_avatars', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  mime: text('mime').notNull(),
  data: bytea('data').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Every e-mail the game tried to send, with the mail server's answer (for delivery problems). */
export const mailLog = pgTable(
  'mail_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** verify | reset | test */
    kind: text('kind').notNull(),
    recipient: text('recipient').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    /** sent (accepted by our mail server) | rejected | failed */
    status: text('status').notNull(),
    messageId: text('message_id'),
    response: text('response'),
    createdAt: createdAt(),
  },
  (t) => [index('mail_log_created_idx').on(t.createdAt), index('mail_log_recipient_idx').on(t.recipient)],
);

/**
 * Long-term contracts with (fictional) client companies: N loads on one lane
 * within a deadline. Offered per player account, then active, then completed
 * (bonus) or failed (reputation loss).
 */
export const clientContracts = pgTable(
  'client_contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    client: text('client').notNull(),
    cargoType: text('cargo_type').notNull(),
    goods: text('goods').notNull(),
    originCityId: integer('origin_city_id').notNull().references(() => cities.id),
    destCityId: integer('dest_city_id').notNull().references(() => cities.id),
    routeId: integer('route_id').notNull().references(() => routes.id),
    distanceKm: real('distance_km').notNull(),
    tonsPerLoad: real('tons_per_load').notNull(),
    loadsTotal: integer('loads_total').notNull(),
    loadsDone: integer('loads_done').notNull().default(0),
    loadsLate: integer('loads_late').notNull().default(0),
    rewardPerLoadCents: money('reward_per_load_cents').notNull(),
    bonusCents: money('bonus_cents').notNull(),
    minReputation: integer('min_reputation').notNull().default(0),
    durationHours: integer('duration_hours').notNull(),
    status: text('status').notNull().default('offer'), // offer | active | completed | failed | expired | declined
    offerExpiresAt: ts('offer_expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    dueAt: ts('due_at'),
    finishedAt: ts('finished_at'),
    createdAt: createdAt(),
  },
  (t) => [index('client_contracts_company_idx').on(t.companyId, t.status), index('client_contracts_due_idx').on(t.status, t.dueAt)],
);

/** Progress of the holiday quests (e.g. Halloween 2026), one row per player and quest. */
export const seasonalQuests = pgTable(
  'seasonal_quests',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** '<season key>:<quest id>', e.g. 'halloween-2026:h_loads'. */
    quest: text('quest').notNull(),
    progress: doublePrecision('progress').notNull().default(0),
    claimedAt: ts('claimed_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.quest] })],
);

/** Badges a player keeps for good (shown on the player card). */
export const userBadges = pgTable(
  'user_badges',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    badge: text('badge').notNull(),
    awardedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badge] })],
);

/** Fines from roadside checks: unpaid → paid / dropped on appeal / paid automatically after the deadline. */
export const fines = pgTable(
  'fines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    deliveryId: uuid('delivery_id').references(() => deliveries.id, { onDelete: 'set null' }),
    violation: text('violation').notNull(), // hours | overload
    amountCents: money('amount_cents').notNull(),
    status: text('status').notNull().default('unpaid'), // unpaid | paid | dropped | auto_paid
    appealed: boolean('appealed').notNull().default(false),
    note: text('note').notNull().default(''),
    dueAt: ts('due_at').notNull(),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [index('fines_company_idx').on(t.companyId, t.status), index('fines_due_idx').on(t.status, t.dueAt), uniqueIndex('fines_delivery_violation_idx').on(t.deliveryId, t.violation)],
);

/** The weekly newspaper: one issue per finished week (Monday, Sofia), written by the worker from game data. */
export const newspapers = pgTable('newspapers', {
  weekKey: text('week_key').primaryKey(),
  number: integer('number').notNull(),
  content: jsonb('content').notNull(),
  publishedAt: ts('published_at').notNull().defaultNow(),
});

/** Lanes a player starred on the job board (first in the list, a notification for new jobs). */
export const favoriteLanes = pgTable(
  'favorite_lanes',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    originCityId: integer('origin_city_id').notNull().references(() => cities.id),
    destCityId: integer('dest_city_id').notNull().references(() => cities.id),
    /** Last time the player was told about a new job on this lane (at most one notice an hour). */
    notifiedAt: ts('notified_at'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.originCityId, t.destCityId] }), index('favorite_lanes_lane_idx').on(t.originCityId, t.destCityId)],
);

/** Special loads on auction: lowest bid wins the job. */
export const specialAuctions = pgTable(
  'special_auctions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Start slot (one auction per slot), e.g. '2026-10-20T10'. */
    slot: text('slot').notNull(),
    loadId: text('load_id').notNull(),
    title: text('title').notNull(),
    goods: text('goods').notNull(),
    cargoType: text('cargo_type').notNull(),
    weightTons: real('weight_tons').notNull(),
    originCityId: integer('origin_city_id').notNull().references(() => cities.id),
    destCityId: integer('dest_city_id').notNull().references(() => cities.id),
    routeId: integer('route_id').notNull().references(() => routes.id),
    distanceKm: real('distance_km').notNull(),
    startPriceCents: money('start_price_cents').notNull(),
    coins: integer('coins').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    extensions: integer('extensions').notNull().default(0),
    status: text('status').notNull().default('open'), // open | awarded | no_bids | delivered | forfeited
    winnerCompanyId: uuid('winner_company_id').references(() => companies.id, { onDelete: 'set null' }),
    winningBidCents: money('winning_bid_cents'),
    contractId: uuid('contract_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('special_auctions_slot_idx').on(t.slot), index('special_auctions_status_idx').on(t.status, t.endsAt)],
);

export const auctionBids = pgTable(
  'auction_bids',
  {
    auctionId: uuid('auction_id').notNull().references(() => specialAuctions.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    amountCents: money('amount_cents').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.auctionId, t.companyId] }), index('auction_bids_amount_idx').on(t.auctionId, t.amountCents)],
);

/** Money sent from one player to another (game money; the fee leaves the game). */
export const moneyTransfers = pgTable(
  'money_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromUserId: uuid('from_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    toUserId: uuid('to_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    amountCents: money('amount_cents').notNull(),
    feeCents: money('fee_cents').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('money_transfers_from_idx').on(t.fromUserId, t.createdAt), index('money_transfers_to_idx').on(t.toUserId, t.createdAt)],
);

/** A company hands a board load to a free player for a commission (lib/game/hire.ts). */
export const jobOffers = pgTable(
  'job_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractId: uuid('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    offeredBy: uuid('offered_by').references(() => users.id, { onDelete: 'set null' }),
    toUserId: uuid('to_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Share of the reward the driver pays to the company's treasury. */
    share: real('share').notNull(),
    status: text('status').notNull().default('pending'), // pending | accepted | declined | done
    expiresAt: ts('expires_at').notNull(),
    deliveryId: uuid('delivery_id'),
    createdAt: createdAt(),
  },
  (t) => [index('job_offers_to_idx').on(t.toUserId, t.status), index('job_offers_org_idx').on(t.organizationId, t.status), index('job_offers_delivery_idx').on(t.deliveryId)],
);

/** A company project: the members haul X tonnes of a cargo to a city within a week (lib/game/projects.ts). */
export const companyProjects = pgTable(
  'company_projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: text('template_id').notNull(),
    title: text('title').notNull(),
    cargoType: text('cargo_type').notNull(),
    destCityId: integer('dest_city_id').notNull().references(() => cities.id),
    targetTons: real('target_tons').notNull(),
    progressTons: real('progress_tons').notNull().default(0),
    /** Tonnes per member: { userId: tons }. */
    contributions: jsonb('contributions').$type<Record<string, number>>().notNull().default({}),
    rewardCents: money('reward_cents').notNull(),
    rewardXp: integer('reward_xp').notNull(),
    status: text('status').notNull().default('active'), // active | done | failed
    startedBy: uuid('started_by').references(() => users.id, { onDelete: 'set null' }),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    completedAt: ts('completed_at'),
  },
  (t) => [index('company_projects_org_idx').on(t.organizationId, t.status), index('company_projects_due_idx').on(t.status, t.endsAt)],
);

/** A mentor (level 15+) helping a new player to level 5. One active mentorship per newcomer. */
export const mentorships = pgTable(
  'mentorships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mentorId: uuid('mentor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    menteeId: uuid('mentee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('active'), // active | done | ended | expired
    createdAt: createdAt(),
    endsAt: ts('ends_at').notNull(),
    finishedAt: ts('finished_at'),
  },
  (t) => [uniqueIndex('mentorships_active_mentee_idx').on(t.menteeId).where(sql`status = 'active'`), index('mentorships_mentor_idx').on(t.mentorId, t.status)],
);
