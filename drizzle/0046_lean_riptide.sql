CREATE TABLE "chat_reactions" (
	"kind" text NOT NULL,
	"message_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_reactions_kind_message_id_user_id_emoji_pk" PRIMARY KEY("kind","message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "company_builder_weeks" (
	"organization_id" uuid NOT NULL,
	"week_key" text NOT NULL,
	"user_id" uuid,
	"tons" real NOT NULL,
	"reward_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_builder_weeks_organization_id_week_key_pk" PRIMARY KEY("organization_id","week_key")
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "last_load" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_vehicles" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "org_vehicles" ADD COLUMN "note_by" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "pinned_message_id" bigint;--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_builder_weeks" ADD CONSTRAINT "company_builder_weeks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_builder_weeks" ADD CONSTRAINT "company_builder_weeks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_reactions_message_idx" ON "chat_reactions" USING btree ("kind","message_id");--> statement-breakpoint
ALTER TABLE "org_vehicles" ADD CONSTRAINT "org_vehicles_note_by_users_id_fk" FOREIGN KEY ("note_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;