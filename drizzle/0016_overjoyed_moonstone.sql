CREATE TABLE "company_tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"status" text DEFAULT 'offer' NOT NULL,
	"title" text NOT NULL,
	"goods" text NOT NULL,
	"cargo_type" text NOT NULL,
	"origin_city_id" integer NOT NULL,
	"dest_city_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"distance_km" real NOT NULL,
	"loads" integer NOT NULL,
	"load_tons" real NOT NULL,
	"reward_per_load_cents" bigint NOT NULL,
	"bonus_cents" bigint NOT NULL,
	"deposit_cents" bigint NOT NULL,
	"xp" integer NOT NULL,
	"duration_hours" integer NOT NULL,
	"offer_expires_at" timestamp with time zone NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"delivered_loads" integer DEFAULT 0 NOT NULL,
	"drivers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "tender_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "login_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_claim_key" text;--> statement-breakpoint
ALTER TABLE "company_tenders" ADD CONSTRAINT "company_tenders_company_id_organizations_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_tenders" ADD CONSTRAINT "company_tenders_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_tenders" ADD CONSTRAINT "company_tenders_dest_city_id_cities_id_fk" FOREIGN KEY ("dest_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_tenders" ADD CONSTRAINT "company_tenders_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_tenders" ADD CONSTRAINT "company_tenders_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_tenders_company_idx" ON "company_tenders" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "contracts_tender_idx" ON "contracts" USING btree ("tender_id");--> statement-breakpoint
-- Existing companies: the default deputy and dispatcher ranks may accept tenders.
UPDATE "company_ranks" SET "permissions" = array_append("permissions", 'manage_tenders') WHERE "name" IN ('Заместник', 'Диспечер') AND "is_owner" = false AND NOT ('manage_tenders' = ANY("permissions"));
