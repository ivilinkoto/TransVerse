CREATE TABLE "company_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "company_assets" (
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_assets_company_id_kind_pk" PRIMARY KEY("company_id","kind")
);
--> statement-breakpoint
CREATE TABLE "company_members" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"rank_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deliveries" integer DEFAULT 0 NOT NULL,
	"contributed_cents" bigint DEFAULT 0 NOT NULL,
	"xp_contributed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_ranks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" integer NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tag" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "rules" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "recruitment" text DEFAULT 'application' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "min_join_level" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "contribution_rate" real DEFAULT 0.05 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "company_xp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "company_level" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "upgrades" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "branding_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_applications" ADD CONSTRAINT "company_applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_applications" ADD CONSTRAINT "company_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_applications" ADD CONSTRAINT "company_applications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_assets" ADD CONSTRAINT "company_assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_rank_id_company_ranks_id_fk" FOREIGN KEY ("rank_id") REFERENCES "public"."company_ranks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_ranks" ADD CONSTRAINT "company_ranks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_applications_company_idx" ON "company_applications" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "company_applications_pending_idx" ON "company_applications" USING btree ("company_id","user_id") WHERE "company_applications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "company_members_company_idx" ON "company_members" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_ranks_company_idx" ON "company_ranks" USING btree ("company_id","priority");--> statement-breakpoint
-- Backfill: every already founded company gets the default ranks and its owner as a member.
INSERT INTO "company_ranks" ("company_id", "name", "priority", "permissions", "is_owner")
SELECT c."id", r."name", r."priority", r."permissions", r."is_owner"
FROM "companies" c
CROSS JOIN (VALUES
  ('Собственик', 0, ARRAY['edit_profile','manage_members','manage_ranks','manage_upgrades','manage_settings']::text[], true),
  ('Заместник', 10, ARRAY['edit_profile','manage_members','manage_upgrades','manage_settings']::text[], false),
  ('Диспечер', 20, ARRAY['manage_members']::text[], false),
  ('Шофьор', 30, ARRAY[]::text[], false)
) AS r("name", "priority", "permissions", "is_owner")
WHERE c."kind" = 'company';--> statement-breakpoint
INSERT INTO "company_members" ("user_id", "company_id", "rank_id")
SELECT c."owner_id", c."id", r."id"
FROM "companies" c
JOIN "company_ranks" r ON r."company_id" = c."id" AND r."is_owner"
WHERE c."kind" = 'company'
ON CONFLICT DO NOTHING;
