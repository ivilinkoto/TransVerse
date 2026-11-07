ALTER TABLE "chat_messages" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "meta" jsonb;