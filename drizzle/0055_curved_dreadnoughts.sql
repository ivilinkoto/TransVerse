CREATE TABLE "org_trailers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"plate" text NOT NULL,
	"city_id" integer NOT NULL,
	"condition" real DEFAULT 100 NOT NULL,
	"upgrades" text[] DEFAULT '{}'::text[] NOT NULL,
	"lent_to" uuid,
	"trailer_id" uuid,
	"sold_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trailers" ADD COLUMN "upgrades" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "trailers" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "trailers" ADD COLUMN "org_trailer_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "moving_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org_trailers" ADD CONSTRAINT "org_trailers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_trailers" ADD CONSTRAINT "org_trailers_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_trailers" ADD CONSTRAINT "org_trailers_lent_to_users_id_fk" FOREIGN KEY ("lent_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_trailers_org_idx" ON "org_trailers" USING btree ("organization_id");