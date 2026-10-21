CREATE TABLE "discord_company_activity" (
	"organization_id" uuid NOT NULL,
	"week_key" text NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "discord_company_activity_organization_id_week_key_pk" PRIMARY KEY("organization_id","week_key")
);
--> statement-breakpoint
CREATE TABLE "discord_members" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"avatar" text,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"voice_minutes" integer DEFAULT 0 NOT NULL,
	"last_xp_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_quiz_answers" (
	"quiz_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"option" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_quiz_answers_quiz_id_discord_user_id_pk" PRIMARY KEY("quiz_id","discord_user_id")
);
--> statement-breakpoint
CREATE TABLE "discord_quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"options" text[] NOT NULL,
	"correct" integer NOT NULL,
	"prize_coins" integer NOT NULL,
	"channel_id" text,
	"message_id" text,
	"winner_user_id" uuid,
	"winner_discord_id" text,
	"closes_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_temp_rooms" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"owner_discord_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_voice" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discord_sanctions" ADD COLUMN "appeal_text" text;--> statement-breakpoint
ALTER TABLE "discord_sanctions" ADD COLUMN "appealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discord_sanctions" ADD COLUMN "appeal_status" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "discord_voice_id" text;--> statement-breakpoint
ALTER TABLE "discord_company_activity" ADD CONSTRAINT "discord_company_activity_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_quiz_answers" ADD CONSTRAINT "discord_quiz_answers_quiz_id_discord_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."discord_quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_quizzes" ADD CONSTRAINT "discord_quizzes_winner_user_id_users_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_members_xp_idx" ON "discord_members" USING btree ("xp");