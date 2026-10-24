CREATE TABLE "assembly_votes" (
	"assembly_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"option" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assembly_votes_assembly_id_user_id_pk" PRIMARY KEY("assembly_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "company_assemblies" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"question" text NOT NULL,
	"kind" text NOT NULL,
	"options" jsonb NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"result" integer,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"head_user_id" uuid,
	"goal_tons" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_owners" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone,
	CONSTRAINT "company_owners_organization_id_user_id_from_at_pk" PRIMARY KEY("organization_id","user_id","from_at")
);
--> statement-breakpoint
CREATE TABLE "intern_stays" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"home_org_id" uuid,
	"host_org_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "key_clients" (
	"month" text NOT NULL,
	"city_id" integer NOT NULL,
	"organization_id" uuid NOT NULL,
	"client" text NOT NULL,
	"tons" real NOT NULL,
	CONSTRAINT "key_clients_month_city_id_pk" PRIMARY KEY("month","city_id")
);
--> statement-breakpoint
CREATE TABLE "merger_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_org_id" uuid NOT NULL,
	"to_org_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "company_members" ADD COLUMN "department_id" integer;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "key_client" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_design" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tradition_day" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tradition_name" text;--> statement-breakpoint
ALTER TABLE "assembly_votes" ADD CONSTRAINT "assembly_votes_assembly_id_company_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."company_assemblies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_votes" ADD CONSTRAINT "assembly_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_assemblies" ADD CONSTRAINT "company_assemblies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_assemblies" ADD CONSTRAINT "company_assemblies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_departments" ADD CONSTRAINT "company_departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_departments" ADD CONSTRAINT "company_departments_head_user_id_users_id_fk" FOREIGN KEY ("head_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_owners" ADD CONSTRAINT "company_owners_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_owners" ADD CONSTRAINT "company_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intern_stays" ADD CONSTRAINT "intern_stays_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intern_stays" ADD CONSTRAINT "intern_stays_home_org_id_organizations_id_fk" FOREIGN KEY ("home_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intern_stays" ADD CONSTRAINT "intern_stays_host_org_id_organizations_id_fk" FOREIGN KEY ("host_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_clients" ADD CONSTRAINT "key_clients_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_clients" ADD CONSTRAINT "key_clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merger_offers" ADD CONSTRAINT "merger_offers_from_org_id_organizations_id_fk" FOREIGN KEY ("from_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merger_offers" ADD CONSTRAINT "merger_offers_to_org_id_organizations_id_fk" FOREIGN KEY ("to_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_assemblies_org_idx" ON "company_assemblies" USING btree ("organization_id","closes_at");--> statement-breakpoint
CREATE INDEX "company_departments_org_idx" ON "company_departments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "intern_stays_user_idx" ON "intern_stays" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "intern_stays_host_idx" ON "intern_stays" USING btree ("host_org_id","status");--> statement-breakpoint
CREATE INDEX "key_clients_org_idx" ON "key_clients" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "merger_offers_to_idx" ON "merger_offers" USING btree ("to_org_id","status");