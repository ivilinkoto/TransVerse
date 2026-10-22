CREATE TABLE "company_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"city_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_factories" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"recipe" text,
	"stock" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"product_tons" real DEFAULT 0 NOT NULL,
	"batch_ends_at" timestamp with time zone,
	"batch_tons" real,
	"batches" integer DEFAULT 0 NOT NULL,
	"sold_cents" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hauler_ratings" (
	"contract_id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"hauler_user_id" uuid NOT NULL,
	"stars" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"principal_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"weekly_cents" bigint NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"weeks" integer NOT NULL,
	"rate_bps" integer NOT NULL,
	"missed" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "exchange" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "factory_org_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "branch_org_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "factory_sale_cents" bigint;--> statement-breakpoint
ALTER TABLE "company_branches" ADD CONSTRAINT "company_branches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_branches" ADD CONSTRAINT "company_branches_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_factories" ADD CONSTRAINT "company_factories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hauler_ratings" ADD CONSTRAINT "hauler_ratings_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hauler_ratings" ADD CONSTRAINT "hauler_ratings_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hauler_ratings" ADD CONSTRAINT "hauler_ratings_hauler_user_id_users_id_fk" FOREIGN KEY ("hauler_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_branches_city_idx" ON "company_branches" USING btree ("organization_id","city_id");--> statement-breakpoint
CREATE INDEX "hauler_ratings_hauler_idx" ON "hauler_ratings" USING btree ("hauler_user_id");--> statement-breakpoint
CREATE INDEX "loans_company_idx" ON "loans" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "loans_due_idx" ON "loans" USING btree ("status","next_due_at");