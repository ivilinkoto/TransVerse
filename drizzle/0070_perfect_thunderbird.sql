CREATE TABLE "museum_exhibits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"plate" text NOT NULL,
	"color" text NOT NULL,
	"livery" text,
	"odometer_km" real NOT NULL,
	"donated_by" uuid,
	"donated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "spare_parts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "museum_exhibits" ADD CONSTRAINT "museum_exhibits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "museum_exhibits" ADD CONSTRAINT "museum_exhibits_donated_by_users_id_fk" FOREIGN KEY ("donated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "museum_exhibits_org_idx" ON "museum_exhibits" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "museum_exhibits_vehicle_idx" ON "museum_exhibits" USING btree ("vehicle_id");