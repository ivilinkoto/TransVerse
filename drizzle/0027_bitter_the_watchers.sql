CREATE TABLE "favorite_lanes" (
	"user_id" uuid NOT NULL,
	"origin_city_id" integer NOT NULL,
	"dest_city_id" integer NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorite_lanes_user_id_origin_city_id_dest_city_id_pk" PRIMARY KEY("user_id","origin_city_id","dest_city_id")
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "auto_dispatched" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "seen_hints" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quiet_hours" jsonb;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "auto_dispatch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "favorite_lanes" ADD CONSTRAINT "favorite_lanes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_lanes" ADD CONSTRAINT "favorite_lanes_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_lanes" ADD CONSTRAINT "favorite_lanes_dest_city_id_cities_id_fk" FOREIGN KEY ("dest_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "favorite_lanes_lane_idx" ON "favorite_lanes" USING btree ("origin_city_id","dest_city_id");