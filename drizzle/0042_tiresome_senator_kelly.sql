CREATE TABLE "company_buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"target_level" integer NOT NULL,
	"needs" jsonb NOT NULL,
	"delivered" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"minutes" integer NOT NULL,
	"status" text DEFAULT 'materials' NOT NULL,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "construction_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "material" text;--> statement-breakpoint
ALTER TABLE "company_buildings" ADD CONSTRAINT "company_buildings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_builds" ADD CONSTRAINT "company_builds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_builds" ADD CONSTRAINT "company_builds_building_id_company_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."company_buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_builds" ADD CONSTRAINT "company_builds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_buildings_type_idx" ON "company_buildings" USING btree ("organization_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "company_builds_active_idx" ON "company_builds" USING btree ("organization_id") WHERE "company_builds"."status" in ('materials', 'building');--> statement-breakpoint
CREATE INDEX "company_builds_due_idx" ON "company_builds" USING btree ("status","ends_at");--> statement-breakpoint
-- Company plot: the ranks that develop the company also build on the plot.
UPDATE "company_ranks" SET "permissions" = array_append("permissions", 'build') WHERE 'manage_upgrades' = ANY("permissions") AND NOT ('build' = ANY("permissions"));
