CREATE TABLE "company_mission_progress" (
	"company_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"mission_id" text NOT NULL,
	"target" real NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"reward_cents" bigint NOT NULL,
	"reward_xp" integer NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_mission_progress_company_id_period_key_mission_id_pk" PRIMARY KEY("company_id","period_key","mission_id")
);
--> statement-breakpoint
CREATE TABLE "global_event_contributions" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"amount" double precision DEFAULT 0 NOT NULL,
	"deliveries" integer DEFAULT 0 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rank" integer,
	"reward" jsonb,
	CONSTRAINT "global_event_contributions_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "global_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"metric" text NOT NULL,
	"cargo_type" text,
	"country_code" text,
	"target" double precision NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"min_contribution" double precision NOT NULL,
	"rewards" jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"outcome" text,
	"template" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_mission_progress" ADD CONSTRAINT "company_mission_progress_company_id_organizations_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_event_contributions" ADD CONSTRAINT "global_event_contributions_event_id_global_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."global_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_event_contributions" ADD CONSTRAINT "global_event_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_event_contributions" ADD CONSTRAINT "global_event_contributions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_events" ADD CONSTRAINT "global_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "global_event_contributions_rank_idx" ON "global_event_contributions" USING btree ("event_id","amount");--> statement-breakpoint
CREATE INDEX "global_events_time_idx" ON "global_events" USING btree ("ends_at","starts_at");