CREATE TABLE "relays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_city_id" integer NOT NULL,
	"relay_city_id" integer NOT NULL,
	"dest_city_id" integer NOT NULL,
	"leg1_contract_id" uuid NOT NULL,
	"leg2_contract_id" uuid NOT NULL,
	"status" text DEFAULT 'leg1' NOT NULL,
	"leg1_user_id" uuid,
	"leg1_delivery_id" uuid,
	"leg1_late" boolean,
	"leg2_user_id" uuid,
	"handover_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "relay_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "relay_leg" integer;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relays" ADD CONSTRAINT "relays_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relays" ADD CONSTRAINT "relays_relay_city_id_cities_id_fk" FOREIGN KEY ("relay_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relays" ADD CONSTRAINT "relays_dest_city_id_cities_id_fk" FOREIGN KEY ("dest_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "relays_status_idx" ON "relays" USING btree ("status");