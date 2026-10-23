CREATE TABLE "plate_auctions" (
	"week_key" text PRIMARY KEY NOT NULL,
	"plate" text NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"bid_user_id" uuid,
	"bid_coins" integer,
	"bids" integer DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone,
	"vehicle_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trailer_hires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trailer_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"price_per_day_cents" bigint NOT NULL,
	"max_days" integer NOT NULL,
	"renter_id" uuid,
	"hired_trailer_id" uuid,
	"days" integer,
	"started_at" timestamp with time zone,
	"until" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trailers" ADD COLUMN "hired_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trailers" ADD COLUMN "hire_id" uuid;--> statement-breakpoint
ALTER TABLE "plate_auctions" ADD CONSTRAINT "plate_auctions_bid_user_id_users_id_fk" FOREIGN KEY ("bid_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trailer_hires" ADD CONSTRAINT "trailer_hires_trailer_id_trailers_id_fk" FOREIGN KEY ("trailer_id") REFERENCES "public"."trailers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trailer_hires" ADD CONSTRAINT "trailer_hires_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trailer_hires" ADD CONSTRAINT "trailer_hires_renter_id_users_id_fk" FOREIGN KEY ("renter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trailer_hires_open_idx" ON "trailer_hires" USING btree ("ended_at","until");--> statement-breakpoint
CREATE UNIQUE INDEX "trailer_hires_trailer_idx" ON "trailer_hires" USING btree ("trailer_id") WHERE ended_at is null;