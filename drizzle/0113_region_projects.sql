CREATE TABLE "region_project_shares" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"stage" integer NOT NULL,
	"tons" real DEFAULT 0 NOT NULL,
	"loads" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "region_project_shares_project_id_user_id_stage_pk" PRIMARY KEY("project_id","user_id","stage")
);
--> statement-breakpoint
CREATE TABLE "region_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" text NOT NULL,
	"week" text NOT NULL,
	"country" text NOT NULL,
	"stage" integer DEFAULT 0 NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "region_project_shares" ADD CONSTRAINT "region_project_shares_project_id_region_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."region_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_project_shares" ADD CONSTRAINT "region_project_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "region_project_shares_user_idx" ON "region_project_shares" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "region_projects_week_idx" ON "region_projects" USING btree ("week");--> statement-breakpoint
CREATE INDEX "region_projects_status_idx" ON "region_projects" USING btree ("status");