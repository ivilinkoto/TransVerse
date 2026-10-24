CREATE TABLE "truck_contest_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"look" jsonb NOT NULL,
	"title" text NOT NULL,
	"votes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "truck_contest_votes" (
	"month" text NOT NULL,
	"voter_id" uuid NOT NULL,
	"entry_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "truck_contest_votes_month_voter_id_entry_id_pk" PRIMARY KEY("month","voter_id","entry_id")
);
--> statement-breakpoint
ALTER TABLE "truck_contest_entries" ADD CONSTRAINT "truck_contest_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_contest_votes" ADD CONSTRAINT "truck_contest_votes_voter_id_users_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_contest_votes" ADD CONSTRAINT "truck_contest_votes_entry_id_truck_contest_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."truck_contest_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "truck_contest_month_user_idx" ON "truck_contest_entries" USING btree ("month","user_id");--> statement-breakpoint
CREATE INDEX "truck_contest_month_idx" ON "truck_contest_entries" USING btree ("month","votes");