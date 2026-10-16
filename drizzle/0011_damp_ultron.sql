ALTER TABLE "payments" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "capture_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_capture_idx" ON "payments" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "payments_pending_idx" ON "payments" USING btree ("provider","status","created_at");