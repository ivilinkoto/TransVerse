CREATE TABLE "organization_season_scores" (
	"season_id" integer NOT NULL,
	"organization_id" uuid NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"deliveries" integer DEFAULT 0 NOT NULL,
	"final_rank" integer,
	"prize_cents" bigint,
	CONSTRAINT "organization_season_scores_season_id_organization_id_pk" PRIMARY KEY("season_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"vehicle_id" uuid,
	"trailer_id" uuid,
	"model_id" text NOT NULL,
	"price_cents" bigint NOT NULL,
	"city_id" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"buyer_company_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "road_events" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "next_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trailers" ADD COLUMN "listed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_rewarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_outcome" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signup_ip_hash" text;--> statement-breakpoint
ALTER TABLE "organization_season_scores" ADD CONSTRAINT "organization_season_scores_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_season_scores" ADD CONSTRAINT "organization_season_scores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_listings" ADD CONSTRAINT "vehicle_listings_seller_company_id_companies_id_fk" FOREIGN KEY ("seller_company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_listings" ADD CONSTRAINT "vehicle_listings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_listings" ADD CONSTRAINT "vehicle_listings_trailer_id_trailers_id_fk" FOREIGN KEY ("trailer_id") REFERENCES "public"."trailers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_listings" ADD CONSTRAINT "vehicle_listings_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_listings" ADD CONSTRAINT "vehicle_listings_buyer_company_id_companies_id_fk" FOREIGN KEY ("buyer_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_season_scores_points_idx" ON "organization_season_scores" USING btree ("season_id","points");--> statement-breakpoint
CREATE INDEX "vehicle_listings_open_idx" ON "vehicle_listings" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "vehicle_listings_seller_idx" ON "vehicle_listings" USING btree ("seller_company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_listings_vehicle_open_idx" ON "vehicle_listings" USING btree ("vehicle_id") WHERE status = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_listings_trailer_open_idx" ON "vehicle_listings" USING btree ("trailer_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "deliveries_next_event_idx" ON "deliveries" USING btree ("next_event_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_idx" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by_id");--> statement-breakpoint
-- The season already running when company seasons start: companies begin with their current members' points.
INSERT INTO "organization_season_scores" ("season_id", "organization_id", "points", "deliveries")
SELECT s."season_id", m."company_id", sum(s."points")::int, sum(s."deliveries")::int
FROM "season_scores" s
JOIN "seasons" se ON se."id" = s."season_id" AND se."status" = 'active'
JOIN "companies" c ON c."id" = s."company_id"
JOIN "company_members" m ON m."user_id" = c."owner_id"
GROUP BY s."season_id", m."company_id"
ON CONFLICT DO NOTHING;
