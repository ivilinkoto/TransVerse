CREATE TABLE "ad_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"offer_key" text NOT NULL,
	"brand" text NOT NULL,
	"country" text NOT NULL,
	"target_km" integer NOT NULL,
	"progress_km" real DEFAULT 0 NOT NULL,
	"pay_cents" bigint NOT NULL,
	"rule" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenge_entries" (
	"challenge_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"delivery_id" uuid,
	"minutes" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_entries_challenge_id_user_id_pk" PRIMARY KEY("challenge_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "co2_credits" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"tonnes" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "co2_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tonnes" real NOT NULL,
	"price_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "co2_weeks" (
	"company_id" uuid NOT NULL,
	"week" text NOT NULL,
	"kg" real DEFAULT 0 NOT NULL,
	"quota_kg" real,
	"settled_at" timestamp with time zone,
	CONSTRAINT "co2_weeks_company_id_week_pk" PRIMARY KEY("company_id","week")
);
--> statement-breakpoint
CREATE TABLE "contract_gifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_extras" (
	"delivery_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"promise" text,
	"puzzle" jsonb,
	"stars" integer,
	"mystery" boolean DEFAULT false NOT NULL,
	"fog" boolean DEFAULT false NOT NULL,
	"co2_kg" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_wishes" (
	"driver_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"city_id" integer NOT NULL,
	"reason" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"missed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"litres" real NOT NULL,
	"litres_left" real NOT NULL,
	"price_cents" integer NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_plans" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"premium_cents" bigint NOT NULL,
	"cover_pct" integer NOT NULL,
	"max_payout_cents" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"cover_pct" integer NOT NULL,
	"max_payout_cents" bigint NOT NULL,
	"paid_out_cents" bigint DEFAULT 0 NOT NULL,
	"premium_cents" bigint NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"occasion" text NOT NULL,
	"answer" text,
	"effect_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lane_repeats" (
	"vehicle_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"a_city_id" integer NOT NULL,
	"b_city_id" integer NOT NULL,
	"trips" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lost_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delivery_id" uuid,
	"goods" text NOT NULL,
	"seed" integer NOT NULL,
	"clues" text[] DEFAULT '{}'::text[] NOT NULL,
	"accused" text,
	"solved" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "office_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"trait" text NOT NULL,
	"salary_cents_per_day" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"title" text NOT NULL,
	"origin_city_id" integer NOT NULL,
	"dest_city_id" integer NOT NULL,
	"solo_only" boolean DEFAULT false NOT NULL,
	"prize_cents" bigint NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"winner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research" (
	"company_id" uuid NOT NULL,
	"tech" text NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"busy_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_company_id_tech_pk" PRIMARY KEY("company_id","tech")
);
--> statement-breakpoint
CREATE TABLE "support_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track_links" (
	"token" text PRIMARY KEY NOT NULL,
	"delivery_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "tag" text;--> statement-breakpoint
ALTER TABLE "trip_queue" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vacation_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_contracts" ADD CONSTRAINT "ad_contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_entries" ADD CONSTRAINT "challenge_entries_challenge_id_player_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."player_challenges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_entries" ADD CONSTRAINT "challenge_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co2_credits" ADD CONSTRAINT "co2_credits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co2_listings" ADD CONSTRAINT "co2_listings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co2_weeks" ADD CONSTRAINT "co2_weeks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_gifts" ADD CONSTRAINT "contract_gifts_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_gifts" ADD CONSTRAINT "contract_gifts_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_gifts" ADD CONSTRAINT "contract_gifts_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_extras" ADD CONSTRAINT "delivery_extras_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_extras" ADD CONSTRAINT "delivery_extras_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_wishes" ADD CONSTRAINT "driver_wishes_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_wishes" ADD CONSTRAINT "driver_wishes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_wishes" ADD CONSTRAINT "driver_wishes_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_locks" ADD CONSTRAINT "fuel_locks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_plans" ADD CONSTRAINT "insurance_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_repeats" ADD CONSTRAINT "lane_repeats_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_repeats" ADD CONSTRAINT "lane_repeats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_repeats" ADD CONSTRAINT "lane_repeats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_repeats" ADD CONSTRAINT "lane_repeats_a_city_id_cities_id_fk" FOREIGN KEY ("a_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_repeats" ADD CONSTRAINT "lane_repeats_b_city_id_cities_id_fk" FOREIGN KEY ("b_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_cases" ADD CONSTRAINT "lost_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_cases" ADD CONSTRAINT "lost_cases_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_staff" ADD CONSTRAINT "office_staff_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_challenges" ADD CONSTRAINT "player_challenges_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_challenges" ADD CONSTRAINT "player_challenges_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_challenges" ADD CONSTRAINT "player_challenges_dest_city_id_cities_id_fk" FOREIGN KEY ("dest_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research" ADD CONSTRAINT "research_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_templates" ADD CONSTRAINT "support_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_links" ADD CONSTRAINT "track_links_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_links" ADD CONSTRAINT "track_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_contracts_offer_idx" ON "ad_contracts" USING btree ("company_id","offer_key");--> statement-breakpoint
CREATE INDEX "ad_contracts_active_idx" ON "ad_contracts" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "co2_listings_price_idx" ON "co2_listings" USING btree ("price_cents");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_gifts_contract_idx" ON "contract_gifts" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contract_gifts_from_idx" ON "contract_gifts" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "delivery_extras_user_idx" ON "delivery_extras" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "fuel_locks_company_idx" ON "fuel_locks" USING btree ("company_id","ends_at");--> statement-breakpoint
CREATE INDEX "insurance_policies_company_idx" ON "insurance_policies" USING btree ("company_id","ends_at");--> statement-breakpoint
CREATE INDEX "insurance_policies_org_idx" ON "insurance_policies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "interviews_user_idx" ON "interviews" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "lost_cases_user_idx" ON "lost_cases" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "office_staff_role_idx" ON "office_staff" USING btree ("company_id","role");--> statement-breakpoint
CREATE INDEX "player_challenges_lane_idx" ON "player_challenges" USING btree ("origin_city_id","dest_city_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "track_links_delivery_idx" ON "track_links" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "contracts_tag_idx" ON "contracts" USING btree ("tag","status") WHERE tag is not null;