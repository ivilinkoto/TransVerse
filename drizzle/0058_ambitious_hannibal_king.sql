CREATE TABLE "city_visits" (
	"user_id" uuid NOT NULL,
	"city_id" integer NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	CONSTRAINT "city_visits_user_id_city_id_pk" PRIMARY KEY("user_id","city_id")
);
--> statement-breakpoint
CREATE TABLE "division_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month_key" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"division" text NOT NULL,
	"rank" integer NOT NULL,
	"tons" real NOT NULL,
	"move" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "division" text DEFAULT 'bronze' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perfect_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "best_perfect_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "city_visits" ADD CONSTRAINT "city_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_visits" ADD CONSTRAINT "city_visits_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "division_results" ADD CONSTRAINT "division_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "division_results_idx" ON "division_results" USING btree ("month_key","organization_id");