CREATE TABLE "mission_progress" (
	"user_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"mission_id" text NOT NULL,
	"period" text NOT NULL,
	"target" real NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"reward_cents" bigint NOT NULL,
	"reward_xp" integer NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_progress_user_id_period_key_mission_id_pk" PRIMARY KEY("user_id","period_key","mission_id")
);
--> statement-breakpoint
ALTER TABLE "mission_progress" ADD CONSTRAINT "mission_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mission_progress_user_idx" ON "mission_progress" USING btree ("user_id","ends_at");