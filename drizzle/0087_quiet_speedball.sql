CREATE TABLE "city_growth" (
	"city_id" integer PRIMARY KEY NOT NULL,
	"tons" real DEFAULT 0 NOT NULL,
	"week_key" text,
	"week_tons" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harvest_progress" (
	"user_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"loads" integer DEFAULT 0 NOT NULL,
	"rewarded" boolean DEFAULT false NOT NULL,
	CONSTRAINT "harvest_progress_user_id_year_pk" PRIMARY KEY("user_id","year")
);
--> statement-breakpoint
ALTER TABLE "city_growth" ADD CONSTRAINT "city_growth_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harvest_progress" ADD CONSTRAINT "harvest_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "city_growth_week_idx" ON "city_growth" USING btree ("week_key","week_tons");