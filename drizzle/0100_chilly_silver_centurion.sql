ALTER TABLE "idea_votes" ADD COLUMN "source" text DEFAULT 'game' NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "discord_votes" integer DEFAULT 0 NOT NULL;