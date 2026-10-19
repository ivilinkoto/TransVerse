ALTER TABLE "payments" ADD COLUMN "purchase_token" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_purchase_token_idx" ON "payments" USING btree ("purchase_token");