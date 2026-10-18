ALTER TABLE "users" ADD COLUMN "seen_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "seasonal_theme" boolean DEFAULT true NOT NULL;