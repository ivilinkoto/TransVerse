CREATE TABLE "vehicle_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"price_cents" bigint NOT NULL,
	"down_cents" bigint NOT NULL,
	"weekly_cents" bigint NOT NULL,
	"payments" integer NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"missed" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "stops" jsonb;--> statement-breakpoint
ALTER TABLE "vehicle_leases" ADD CONSTRAINT "vehicle_leases_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_leases" ADD CONSTRAINT "vehicle_leases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_leases_vehicle_idx" ON "vehicle_leases" USING btree ("vehicle_id") WHERE "vehicle_leases"."status" = 'active';--> statement-breakpoint
CREATE INDEX "vehicle_leases_due_idx" ON "vehicle_leases" USING btree ("status","next_due_at");--> statement-breakpoint
CREATE INDEX "vehicle_leases_company_idx" ON "vehicle_leases" USING btree ("company_id");--> statement-breakpoint
-- Company roles: recruiting becomes its own right; every rank that managed members keeps recruiting.
UPDATE "company_ranks" SET "permissions" = array_append("permissions", 'recruit') WHERE 'manage_members' = ANY("permissions") AND NOT ('recruit' = ANY("permissions"));
