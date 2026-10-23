CREATE TABLE "recruitment_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"text" text NOT NULL,
	"min_level" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_entries" (
	"tournament" text NOT NULL,
	"user_id" uuid NOT NULL,
	"seed" integer,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tournament_entries_tournament_user_id_pk" PRIMARY KEY("tournament","user_id")
);
--> statement-breakpoint
CREATE TABLE "tournament_matches" (
	"tournament" text NOT NULL,
	"round" integer NOT NULL,
	"slot" integer NOT NULL,
	"a_user_id" uuid,
	"b_user_id" uuid,
	"a_km" real,
	"b_km" real,
	"winner_id" uuid,
	"settled_at" timestamp with time zone,
	CONSTRAINT "tournament_matches_tournament_round_slot_pk" PRIMARY KEY("tournament","round","slot")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "specialization" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "specialization_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recruitment_posts" ADD CONSTRAINT "recruitment_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_posts" ADD CONSTRAINT "recruitment_posts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_a_user_id_users_id_fk" FOREIGN KEY ("a_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_b_user_id_users_id_fk" FOREIGN KEY ("b_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_posts_org_idx" ON "recruitment_posts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_posts_driver_idx" ON "recruitment_posts" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "recruitment_posts_expires_idx" ON "recruitment_posts" USING btree ("expires_at");