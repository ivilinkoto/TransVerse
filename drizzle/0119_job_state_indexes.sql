CREATE INDEX "job_state_key_prefix_idx" ON "job_state" USING btree ("key" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "job_state_train_owner_idx" ON "job_state" USING btree ((value->>'ownerId')) WHERE key like 'train:%';--> statement-breakpoint
CREATE INDEX "job_state_train_hirer_idx" ON "job_state" USING btree ((value->'run'->>'hirerId')) WHERE key like 'train:%';