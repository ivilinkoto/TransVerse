CREATE TABLE "alliance_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alliance_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"depot_id" uuid NOT NULL,
	"city_id" integer NOT NULL,
	"cargo_type" text NOT NULL,
	"tons" real NOT NULL,
	"cost_cents" bigint NOT NULL,
	"price_cents" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"buyer_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lane_records" (
	"month" text NOT NULL,
	"origin_city_id" integer NOT NULL,
	"dest_city_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"km" real NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lane_records_month_origin_city_id_dest_city_id_pk" PRIMARY KEY("month","origin_city_id","dest_city_id")
);
--> statement-breakpoint
ALTER TABLE "company_members" ADD COLUMN "bus_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_members" ADD COLUMN "first_trip_bonus" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "showcase" jsonb DEFAULT '{"trucks":[],"badges":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "alliance_listings" ADD CONSTRAINT "alliance_listings_alliance_id_alliances_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliance_listings" ADD CONSTRAINT "alliance_listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliance_listings" ADD CONSTRAINT "alliance_listings_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliance_listings" ADD CONSTRAINT "alliance_listings_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliance_listings" ADD CONSTRAINT "alliance_listings_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_records" ADD CONSTRAINT "lane_records_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_records" ADD CONSTRAINT "lane_records_dest_city_id_cities_id_fk" FOREIGN KEY ("dest_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_records" ADD CONSTRAINT "lane_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alliance_listings_open_idx" ON "alliance_listings" USING btree ("alliance_id","status");--> statement-breakpoint
CREATE INDEX "alliance_listings_seller_idx" ON "alliance_listings" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "lane_records_user_idx" ON "lane_records" USING btree ("user_id","month");