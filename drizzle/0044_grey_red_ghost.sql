CREATE TABLE "company_decor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_poll_votes" (
	"poll_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"option" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_poll_votes_poll_id_user_id_pk" PRIMARY KEY("poll_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "company_polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"question" text NOT NULL,
	"options" text[] NOT NULL,
	"created_by" uuid,
	"closes_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"plate" text NOT NULL,
	"city_id" integer NOT NULL,
	"condition" real DEFAULT 100 NOT NULL,
	"odometer_km" real DEFAULT 0 NOT NULL,
	"service_km" real DEFAULT 0 NOT NULL,
	"lent_to" uuid,
	"vehicle_id" uuid,
	"sold_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plot_expansions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "org_vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "company_decor" ADD CONSTRAINT "company_decor_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_poll_votes" ADD CONSTRAINT "company_poll_votes_poll_id_company_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."company_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_poll_votes" ADD CONSTRAINT "company_poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_polls" ADD CONSTRAINT "company_polls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_polls" ADD CONSTRAINT "company_polls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_vehicles" ADD CONSTRAINT "org_vehicles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_vehicles" ADD CONSTRAINT "org_vehicles_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_vehicles" ADD CONSTRAINT "org_vehicles_lent_to_users_id_fk" FOREIGN KEY ("lent_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_decor_org_idx" ON "company_decor" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "company_polls_org_idx" ON "company_polls" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "org_vehicles_org_idx" ON "org_vehicles" USING btree ("organization_id");