CREATE TABLE "discord_giveaway_entries" (
	"giveaway_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_giveaway_entries_giveaway_id_user_id_pk" PRIMARY KEY("giveaway_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "discord_giveaways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"prize_coins" integer NOT NULL,
	"winners" integer DEFAULT 1 NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"channel_id" text,
	"message_id" text,
	"created_by_discord_id" text NOT NULL,
	"created_by_user_id" uuid,
	"drawn_at" timestamp with time zone,
	"winner_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_sanctions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"discord_user_id" text NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"until" timestamp with time zone,
	"in_game" boolean DEFAULT false NOT NULL,
	"moderator_discord_id" text NOT NULL,
	"moderator_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_tickets" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"discord_user_id" text NOT NULL,
	"ticket_id" uuid,
	"subject" text NOT NULL,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_polls" ADD COLUMN "discord_channel_id" text;--> statement-breakpoint
ALTER TABLE "company_polls" ADD COLUMN "discord_message_id" text;--> statement-breakpoint
ALTER TABLE "company_polls" ADD COLUMN "discord_votes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "discord_message_id" text;--> statement-breakpoint
ALTER TABLE "discord_giveaway_entries" ADD CONSTRAINT "discord_giveaway_entries_giveaway_id_discord_giveaways_id_fk" FOREIGN KEY ("giveaway_id") REFERENCES "public"."discord_giveaways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_giveaway_entries" ADD CONSTRAINT "discord_giveaway_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_giveaways" ADD CONSTRAINT "discord_giveaways_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_sanctions" ADD CONSTRAINT "discord_sanctions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_sanctions" ADD CONSTRAINT "discord_sanctions_moderator_user_id_users_id_fk" FOREIGN KEY ("moderator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_tickets" ADD CONSTRAINT "discord_tickets_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_giveaways_due_idx" ON "discord_giveaways" USING btree ("drawn_at","ends_at");--> statement-breakpoint
CREATE INDEX "discord_sanctions_user_idx" ON "discord_sanctions" USING btree ("discord_user_id","created_at");--> statement-breakpoint
CREATE INDEX "discord_tickets_user_idx" ON "discord_tickets" USING btree ("discord_user_id");--> statement-breakpoint
CREATE INDEX "discord_tickets_ticket_idx" ON "discord_tickets" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_messages_discord_idx" ON "support_messages" USING btree ("discord_message_id");