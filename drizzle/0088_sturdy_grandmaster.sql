CREATE TABLE "story_progress" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"chapter" integer DEFAULT 0 NOT NULL,
	"counts" integer[] DEFAULT '{0,0,0}'::int[] NOT NULL,
	"cities" integer[] DEFAULT '{}'::int[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "choice" jsonb;--> statement-breakpoint
ALTER TABLE "story_progress" ADD CONSTRAINT "story_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;