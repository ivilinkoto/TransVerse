CREATE TABLE "community_cup_entries" (
	"tournament_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "community_cup_entries_tournament_id_user_id_pk" PRIMARY KEY("tournament_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "community_tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"metric" text NOT NULL,
	"cargo_type" text,
	"country_code" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"pool_cents" bigint NOT NULL,
	"entry_fee_cents" bigint DEFAULT 0 NOT NULL,
	"max_players" integer NOT NULL,
	"announcement" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_cup_entries" ADD CONSTRAINT "community_cup_entries_tournament_id_community_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."community_tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_cup_entries" ADD CONSTRAINT "community_cup_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_tournaments" ADD CONSTRAINT "community_tournaments_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_cup_entries_user_idx" ON "community_cup_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "community_tournaments_status_idx" ON "community_tournaments" USING btree ("status","ends_at");