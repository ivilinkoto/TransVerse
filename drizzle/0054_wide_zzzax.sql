CREATE TABLE "rallies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_key" text NOT NULL,
	"origin_city_id" integer NOT NULL,
	"dest_city_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"distance_km" real NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rallies_week_key_unique" UNIQUE("week_key")
);
--> statement-breakpoint
CREATE TABLE "rally_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rally_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"contract_id" uuid,
	"minutes" integer,
	"fuel_cents_per_100" integer,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "rally_id" uuid;--> statement-breakpoint
ALTER TABLE "rallies" ADD CONSTRAINT "rallies_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rallies" ADD CONSTRAINT "rallies_dest_city_id_cities_id_fk" FOREIGN KEY ("dest_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rallies" ADD CONSTRAINT "rallies_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rally_entries" ADD CONSTRAINT "rally_entries_rally_id_rallies_id_fk" FOREIGN KEY ("rally_id") REFERENCES "public"."rallies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rally_entries" ADD CONSTRAINT "rally_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rally_entries" ADD CONSTRAINT "rally_entries_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rally_entries_user_idx" ON "rally_entries" USING btree ("rally_id","user_id");