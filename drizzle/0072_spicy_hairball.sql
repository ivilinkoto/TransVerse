ALTER TABLE "reports" ADD COLUMN "post_id" uuid;--> statement-breakpoint
CREATE INDEX "deliveries_completed_idx" ON "deliveries" USING btree ("completed_at") WHERE status = 'completed';