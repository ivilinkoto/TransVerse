ALTER TABLE "relays" ADD COLUMN "partner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "leader_id" uuid;--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "asked_at" timestamp with time zone;