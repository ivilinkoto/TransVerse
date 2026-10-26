CREATE TABLE "intermodal_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_id" text NOT NULL,
	"reversed" boolean DEFAULT false NOT NULL,
	"origin_city_id" integer NOT NULL,
	"dest_city_id" integer NOT NULL,
	"cargo_type" text NOT NULL,
	"goods" text NOT NULL,
	"tons" real NOT NULL,
	"leg1_contract_id" uuid,
	"leg2_contract_id" uuid,
	"status" text DEFAULT 'leg1' NOT NULL,
	"first_user_id" uuid,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "city_markets" ADD COLUMN "supply" real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "intermodal_shipments" ADD CONSTRAINT "intermodal_shipments_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intermodal_shipments" ADD CONSTRAINT "intermodal_shipments_dest_city_id_cities_id_fk" FOREIGN KEY ("dest_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intermodal_shipments" ADD CONSTRAINT "intermodal_shipments_leg1_contract_id_contracts_id_fk" FOREIGN KEY ("leg1_contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intermodal_shipments" ADD CONSTRAINT "intermodal_shipments_leg2_contract_id_contracts_id_fk" FOREIGN KEY ("leg2_contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intermodal_shipments" ADD CONSTRAINT "intermodal_shipments_first_user_id_users_id_fk" FOREIGN KEY ("first_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intermodal_status_idx" ON "intermodal_shipments" USING btree ("status","ready_at");--> statement-breakpoint
CREATE INDEX "intermodal_leg1_idx" ON "intermodal_shipments" USING btree ("leg1_contract_id");--> statement-breakpoint
CREATE INDEX "intermodal_leg2_idx" ON "intermodal_shipments" USING btree ("leg2_contract_id");