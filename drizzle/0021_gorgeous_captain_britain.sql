CREATE TABLE "mail_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"recipient" text NOT NULL,
	"user_id" uuid,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"message_id" text,
	"response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_log" ADD CONSTRAINT "mail_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_log_created_idx" ON "mail_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mail_log_recipient_idx" ON "mail_log" USING btree ("recipient");