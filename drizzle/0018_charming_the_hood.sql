CREATE TABLE "chat_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "company_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invited_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "direct_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"hidden_for_sender" boolean DEFAULT false NOT NULL,
	"hidden_for_recipient" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"addressee_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "min_reputation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_invites" ADD CONSTRAINT "company_invites_company_id_organizations_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_invites" ADD CONSTRAINT "company_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_invites" ADD CONSTRAINT "company_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_users_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_channel_idx" ON "chat_messages" USING btree ("channel","id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_invites_pending_idx" ON "company_invites" USING btree ("company_id","user_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "company_invites_user_idx" ON "company_invites" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "direct_messages_pair_idx" ON "direct_messages" USING btree (least("sender_id", "recipient_id"),greatest("sender_id", "recipient_id"),"id");--> statement-breakpoint
CREATE INDEX "direct_messages_unread_idx" ON "direct_messages" USING btree ("recipient_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_idx" ON "friendships" USING btree (least("requester_id", "addressee_id"),greatest("requester_id", "addressee_id"));--> statement-breakpoint
CREATE INDEX "friendships_addressee_idx" ON "friendships" USING btree ("addressee_id","status");--> statement-breakpoint
CREATE INDEX "friendships_requester_idx" ON "friendships" USING btree ("requester_id","status");