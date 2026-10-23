ALTER TABLE "alliances" ADD COLUMN "hall_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN "hall_tons" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN "discord_channel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN "discord_channel_id" text;--> statement-breakpoint
ALTER TABLE "alliances" ADD COLUMN "discord_role_id" text;