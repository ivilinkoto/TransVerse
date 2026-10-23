ALTER TABLE "deliveries" ADD COLUMN "convoy_lead" uuid;--> statement-breakpoint
CREATE INDEX "deliveries_convoy_lead_idx" ON "deliveries" USING btree ("convoy_lead");