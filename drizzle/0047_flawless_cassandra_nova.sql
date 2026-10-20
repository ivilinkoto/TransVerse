CREATE TABLE "discord_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"target" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_messages" ADD COLUMN "discord_message_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "discord_channel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "discord_channel_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "discord_role_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "discord_webhook" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discord_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discord_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discord_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discord_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "discord_outbox_dedupe_idx" ON "discord_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "discord_outbox_due_idx" ON "discord_outbox" USING btree ("sent_at","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_messages_discord_idx" ON "company_messages" USING btree ("discord_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_discord_idx" ON "users" USING btree ("discord_id");