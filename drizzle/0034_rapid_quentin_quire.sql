CREATE TABLE "company_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"title" text NOT NULL,
	"cargo_type" text NOT NULL,
	"dest_city_id" integer NOT NULL,
	"target_tons" real NOT NULL,
	"progress_tons" real DEFAULT 0 NOT NULL,
	"contributions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reward_cents" bigint NOT NULL,
	"reward_xp" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_by" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "company_projects" ADD CONSTRAINT "company_projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_projects" ADD CONSTRAINT "company_projects_dest_city_id_cities_id_fk" FOREIGN KEY ("dest_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_projects" ADD CONSTRAINT "company_projects_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_projects_org_idx" ON "company_projects" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "company_projects_due_idx" ON "company_projects" USING btree ("status","ends_at");