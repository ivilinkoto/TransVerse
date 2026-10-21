CREATE TABLE "duels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenger_id" uuid NOT NULL,
	"opponent_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"challenger_tons" real DEFAULT 0 NOT NULL,
	"opponent_tons" real DEFAULT 0 NOT NULL,
	"winner_id" uuid,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "livery_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"model_id" text NOT NULL,
	"trailer_model_id" text,
	"color" text NOT NULL,
	"livery" text,
	"plate" text NOT NULL,
	"message_id" text,
	"votes" integer DEFAULT 0 NOT NULL,
	"won" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "livery_votes" (
	"entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "livery_votes_entry_id_user_id_pk" PRIMARY KEY("entry_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "open_convoys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"origin_city_id" integer NOT NULL,
	"dest_city_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_loads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"shared_by" uuid,
	"tons" real NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "shared_load_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "featured" text;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_challenger_id_users_id_fk" FOREIGN KEY ("challenger_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_opponent_id_users_id_fk" FOREIGN KEY ("opponent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duels" ADD CONSTRAINT "duels_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livery_entries" ADD CONSTRAINT "livery_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livery_entries" ADD CONSTRAINT "livery_entries_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livery_votes" ADD CONSTRAINT "livery_votes_entry_id_livery_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."livery_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "livery_votes" ADD CONSTRAINT "livery_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_convoys" ADD CONSTRAINT "open_convoys_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_convoys" ADD CONSTRAINT "open_convoys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_convoys" ADD CONSTRAINT "open_convoys_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_convoys" ADD CONSTRAINT "open_convoys_dest_city_id_cities_id_fk" FOREIGN KEY ("dest_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_loads" ADD CONSTRAINT "shared_loads_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_loads" ADD CONSTRAINT "shared_loads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_loads" ADD CONSTRAINT "shared_loads_shared_by_users_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duels_challenger_idx" ON "duels" USING btree ("challenger_id","status");--> statement-breakpoint
CREATE INDEX "duels_opponent_idx" ON "duels" USING btree ("opponent_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "livery_entries_month_user_idx" ON "livery_entries" USING btree ("month_key","user_id");--> statement-breakpoint
CREATE INDEX "livery_entries_month_idx" ON "livery_entries" USING btree ("month_key","votes");--> statement-breakpoint
CREATE UNIQUE INDEX "open_convoys_delivery_idx" ON "open_convoys" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "open_convoys_lane_idx" ON "open_convoys" USING btree ("origin_city_id","dest_city_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_loads_contract_idx" ON "shared_loads" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "shared_loads_org_idx" ON "shared_loads" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "contracts_shared_idx" ON "contracts" USING btree ("shared_load_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_featured_idx" ON "contracts" USING btree ("featured");