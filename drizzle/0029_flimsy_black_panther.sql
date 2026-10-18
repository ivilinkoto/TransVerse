CREATE TABLE "auction_bids" (
	"auction_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auction_bids_auction_id_company_id_pk" PRIMARY KEY("auction_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "special_auctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot" text NOT NULL,
	"load_id" text NOT NULL,
	"title" text NOT NULL,
	"goods" text NOT NULL,
	"cargo_type" text NOT NULL,
	"weight_tons" real NOT NULL,
	"origin_city_id" integer NOT NULL,
	"dest_city_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"distance_km" real NOT NULL,
	"start_price_cents" bigint NOT NULL,
	"coins" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"extensions" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"winner_company_id" uuid,
	"winning_bid_cents" bigint,
	"contract_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "auction_id" uuid;--> statement-breakpoint
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_auction_id_special_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."special_auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_auctions" ADD CONSTRAINT "special_auctions_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_auctions" ADD CONSTRAINT "special_auctions_dest_city_id_cities_id_fk" FOREIGN KEY ("dest_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_auctions" ADD CONSTRAINT "special_auctions_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_auctions" ADD CONSTRAINT "special_auctions_winner_company_id_companies_id_fk" FOREIGN KEY ("winner_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auction_bids_amount_idx" ON "auction_bids" USING btree ("auction_id","amount_cents");--> statement-breakpoint
CREATE UNIQUE INDEX "special_auctions_slot_idx" ON "special_auctions" USING btree ("slot");--> statement-breakpoint
CREATE INDEX "special_auctions_status_idx" ON "special_auctions" USING btree ("status","ends_at");