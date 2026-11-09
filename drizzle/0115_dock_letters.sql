CREATE TABLE "client_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"client" text NOT NULL,
	"goods" text NOT NULL,
	"city_id" integer NOT NULL,
	"bonus_cents" integer DEFAULT 0 NOT NULL,
	"contract_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dock_slots" (
	"delivery_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"city_id" integer NOT NULL,
	"slot_at" timestamp with time zone NOT NULL,
	"arrive_at" timestamp with time zone NOT NULL,
	"wait_min" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dock_swaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_delivery_id" uuid NOT NULL,
	"to_delivery_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"gift_cents" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_letters" ADD CONSTRAINT "client_letters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_letters" ADD CONSTRAINT "client_letters_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_letters" ADD CONSTRAINT "client_letters_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_letters" ADD CONSTRAINT "client_letters_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dock_slots" ADD CONSTRAINT "dock_slots_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dock_slots" ADD CONSTRAINT "dock_slots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dock_slots" ADD CONSTRAINT "dock_slots_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dock_swaps" ADD CONSTRAINT "dock_swaps_from_delivery_id_deliveries_id_fk" FOREIGN KEY ("from_delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dock_swaps" ADD CONSTRAINT "dock_swaps_to_delivery_id_deliveries_id_fk" FOREIGN KEY ("to_delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dock_swaps" ADD CONSTRAINT "dock_swaps_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dock_swaps" ADD CONSTRAINT "dock_swaps_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_letters_delivery_idx" ON "client_letters" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "client_letters_user_idx" ON "client_letters" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "dock_slots_city_slot_idx" ON "dock_slots" USING btree ("city_id","slot_at");--> statement-breakpoint
CREATE INDEX "dock_slots_user_idx" ON "dock_slots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dock_swaps_to_idx" ON "dock_swaps" USING btree ("to_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "dock_swaps_pair_idx" ON "dock_swaps" USING btree ("from_delivery_id","to_delivery_id");