CREATE TABLE "hitchhikers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"persona" integer NOT NULL,
	"from_city_id" integer NOT NULL,
	"to_city_id" integer NOT NULL,
	"fare_cents" bigint NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"wait_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_postcards" (
	"user_id" uuid NOT NULL,
	"landmark" text NOT NULL,
	"delivery_id" uuid,
	"collected_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_postcards_user_id_landmark_pk" PRIMARY KEY("user_id","landmark")
);
--> statement-breakpoint
ALTER TABLE "hitchhikers" ADD CONSTRAINT "hitchhikers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hitchhikers" ADD CONSTRAINT "hitchhikers_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hitchhikers" ADD CONSTRAINT "hitchhikers_from_city_id_cities_id_fk" FOREIGN KEY ("from_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hitchhikers" ADD CONSTRAINT "hitchhikers_to_city_id_cities_id_fk" FOREIGN KEY ("to_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_postcards" ADD CONSTRAINT "user_postcards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hitchhikers_delivery_idx" ON "hitchhikers" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "hitchhikers_user_idx" ON "hitchhikers" USING btree ("user_id","status");