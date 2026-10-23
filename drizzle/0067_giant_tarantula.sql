CREATE TABLE "pass_openings" (
	"year" integer NOT NULL,
	"country" text NOT NULL,
	"rank" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "pass_openings_year_country_rank_pk" PRIMARY KEY("year","country","rank")
);
--> statement-breakpoint
ALTER TABLE "pass_openings" ADD CONSTRAINT "pass_openings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pass_openings_user_idx" ON "pass_openings" USING btree ("year","country","user_id");