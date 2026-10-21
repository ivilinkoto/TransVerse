CREATE TABLE "ship_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"port_city_id" integer NOT NULL,
	"ship" text NOT NULL,
	"containers" integer NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"winner_organization_id" uuid,
	"discord_channel_id" text,
	"discord_message_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weather_now" (
	"city_id" integer PRIMARY KEY NOT NULL,
	"country_code" text NOT NULL,
	"temp_c" real NOT NULL,
	"precip_mm" real NOT NULL,
	"snow_cm" real NOT NULL,
	"gust_kmh" real NOT NULL,
	"code" integer NOT NULL,
	"condition" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "port" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "port_call_id" uuid;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "crossing" jsonb;--> statement-breakpoint
ALTER TABLE "ship_calls" ADD CONSTRAINT "ship_calls_port_city_id_cities_id_fk" FOREIGN KEY ("port_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ship_calls" ADD CONSTRAINT "ship_calls_winner_organization_id_organizations_id_fk" FOREIGN KEY ("winner_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_now" ADD CONSTRAINT "weather_now_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ship_calls_status_idx" ON "ship_calls" USING btree ("status","ends_at");