CREATE TABLE "client_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"client" text NOT NULL,
	"cargo_type" text NOT NULL,
	"goods" text NOT NULL,
	"origin_city_id" integer NOT NULL,
	"dest_city_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"distance_km" real NOT NULL,
	"tons_per_load" real NOT NULL,
	"loads_total" integer NOT NULL,
	"loads_done" integer DEFAULT 0 NOT NULL,
	"loads_late" integer DEFAULT 0 NOT NULL,
	"reward_per_load_cents" bigint NOT NULL,
	"bonus_cents" bigint NOT NULL,
	"min_reputation" integer DEFAULT 0 NOT NULL,
	"duration_hours" integer NOT NULL,
	"status" text DEFAULT 'offer' NOT NULL,
	"offer_expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "client_contract_id" uuid;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "co_driver_id" uuid;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "end_duty_min" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "co_vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "duty_min" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "rested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "traits" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "client_contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "client_contracts_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "client_contracts_dest_city_id_cities_id_fk" FOREIGN KEY ("dest_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "client_contracts_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_contracts_company_idx" ON "client_contracts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "client_contracts_due_idx" ON "client_contracts" USING btree ("status","due_at");--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_co_driver_id_drivers_id_fk" FOREIGN KEY ("co_driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_co_vehicle_id_vehicles_id_fk" FOREIGN KEY ("co_vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_co_vehicle_idx" ON "drivers" USING btree ("co_vehicle_id");