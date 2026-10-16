CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hq_city_id" integer NOT NULL,
	"tag" text,
	"description" text,
	"rules" text,
	"color" text,
	"recruitment" text DEFAULT 'application' NOT NULL,
	"min_join_level" integer DEFAULT 1 NOT NULL,
	"contribution_rate" real DEFAULT 0.05 NOT NULL,
	"company_xp" integer DEFAULT 0 NOT NULL,
	"company_level" integer DEFAULT 1 NOT NULL,
	"upgrades" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"branding_version" integer DEFAULT 0 NOT NULL,
	"treasury_cents" bigint DEFAULT 0 NOT NULL,
	"founded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"category" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"balance_after_cents" bigint NOT NULL,
	"description" text NOT NULL,
	"actor_user_id" uuid,
	"idempotency_key" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Every founded company becomes its own organisation (same id, so ranks, members,
-- applications and images stay attached). The treasury starts empty: until now company
-- money and the owner's personal money were one balance, which stays with the owner.
INSERT INTO "organizations" ("id", "owner_id", "name", "hq_city_id", "tag", "description", "rules", "color", "recruitment", "min_join_level", "contribution_rate", "company_xp", "company_level", "upgrades", "branding_version", "treasury_cents", "founded_at", "created_at")
SELECT c."id", c."owner_id", coalesce(c."name", 'Компания ' || left(c."id"::text, 8)), c."hq_city_id", c."tag", c."description", c."rules", c."color", c."recruitment", c."min_join_level", c."contribution_rate", c."company_xp", c."company_level", c."upgrades", c."branding_version", 0, coalesce(c."founded_at", c."created_at"), c."created_at"
FROM "companies" c
WHERE c."kind" = 'company';
--> statement-breakpoint
ALTER TABLE "company_applications" DROP CONSTRAINT "company_applications_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "company_assets" DROP CONSTRAINT "company_assets_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "company_members" DROP CONSTRAINT "company_members_company_id_companies_id_fk";
--> statement-breakpoint
ALTER TABLE "company_ranks" DROP CONSTRAINT "company_ranks_company_id_companies_id_fk";
--> statement-breakpoint
DROP INDEX "companies_name_idx";--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_hq_city_id_cities_id_fk" FOREIGN KEY ("hq_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_entries" ADD CONSTRAINT "treasury_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_entries" ADD CONSTRAINT "treasury_entries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_name_idx" ON "organizations" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_owner_idx" ON "organizations" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_idempotency_idx" ON "treasury_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "treasury_org_idx" ON "treasury_entries" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "company_applications" ADD CONSTRAINT "company_applications_company_id_organizations_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_assets" ADD CONSTRAINT "company_assets_company_id_organizations_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_organizations_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_ranks" ADD CONSTRAINT "company_ranks_company_id_organizations_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "tag";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "rules";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "color";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "recruitment";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "min_join_level";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "contribution_rate";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "company_xp";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "company_level";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "upgrades";--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "branding_version";