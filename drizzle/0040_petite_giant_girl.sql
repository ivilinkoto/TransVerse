CREATE TABLE "weekly_goals" (
	"user_id" uuid NOT NULL,
	"week_key" text NOT NULL,
	"difficulty" text NOT NULL,
	"metric" text NOT NULL,
	"target" real NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"reward_cents" bigint NOT NULL,
	"reward_coins" integer NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_goals_user_id_week_key_pk" PRIMARY KEY("user_id","week_key")
);
--> statement-breakpoint
ALTER TABLE "weekly_goals" ADD CONSTRAINT "weekly_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;