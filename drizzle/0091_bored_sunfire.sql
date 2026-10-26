CREATE TABLE "holding_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holding_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holding_members" (
	"holding_id" uuid NOT NULL,
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"joined_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holdings_parent_id_unique" UNIQUE("parent_id")
);
--> statement-breakpoint
CREATE TABLE "legacy_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"star" integer NOT NULL,
	"level" integer NOT NULL,
	"deliveries" integer NOT NULL,
	"total_km" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "territories" (
	"week" text NOT NULL,
	"country_code" text NOT NULL,
	"region" text NOT NULL,
	"region_bg" text,
	"organization_id" uuid NOT NULL,
	"tons" real NOT NULL,
	CONSTRAINT "territories_week_country_code_region_pk" PRIMARY KEY("week","country_code","region")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "legacy_stars" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "holding_invites" ADD CONSTRAINT "holding_invites_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_invites" ADD CONSTRAINT "holding_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_members" ADD CONSTRAINT "holding_members_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_members" ADD CONSTRAINT "holding_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_parent_id_organizations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_runs" ADD CONSTRAINT "legacy_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territories" ADD CONSTRAINT "territories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holding_invites_org_idx" ON "holding_invites" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "holding_members_holding_idx" ON "holding_members" USING btree ("holding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_runs_user_star_idx" ON "legacy_runs" USING btree ("user_id","star");--> statement-breakpoint
CREATE INDEX "territories_org_idx" ON "territories" USING btree ("organization_id","week");