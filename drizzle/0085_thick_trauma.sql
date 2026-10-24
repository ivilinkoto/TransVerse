CREATE TABLE "convoy_members" (
	"convoy_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"reason" text,
	"delivery_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "convoy_members_convoy_id_user_id_pk" PRIMARY KEY("convoy_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "convoy_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"convoy_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "convoy_stats" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"convoys" integer DEFAULT 0 NOT NULL,
	"on_time" integer DEFAULT 0 NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"led" integer DEFAULT 0 NOT NULL,
	"led_on_time" integer DEFAULT 0 NOT NULL,
	"bonuses_today" text
);
--> statement-breakpoint
CREATE TABLE "convoys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"access" text DEFAULT 'open' NOT NULL,
	"organization_id" uuid,
	"leader_id" uuid,
	"title" text,
	"origin_city_id" integer NOT NULL,
	"dest_city_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"depart_at" timestamp with time zone NOT NULL,
	"seats" integer NOT NULL,
	"min_level" integer DEFAULT 1 NOT NULL,
	"shared_cargo" text,
	"shared_tons" real,
	"status" text DEFAULT 'open' NOT NULL,
	"trucks" integer DEFAULT 0 NOT NULL,
	"all_on_time" boolean,
	"arrives_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "convoy_id" uuid;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "organized_convoy_id" uuid;--> statement-breakpoint
ALTER TABLE "convoy_members" ADD CONSTRAINT "convoy_members_convoy_id_convoys_id_fk" FOREIGN KEY ("convoy_id") REFERENCES "public"."convoys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convoy_members" ADD CONSTRAINT "convoy_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convoy_messages" ADD CONSTRAINT "convoy_messages_convoy_id_convoys_id_fk" FOREIGN KEY ("convoy_id") REFERENCES "public"."convoys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convoy_messages" ADD CONSTRAINT "convoy_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convoy_stats" ADD CONSTRAINT "convoy_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convoys" ADD CONSTRAINT "convoys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convoys" ADD CONSTRAINT "convoys_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convoys" ADD CONSTRAINT "convoys_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convoys" ADD CONSTRAINT "convoys_dest_city_id_cities_id_fk" FOREIGN KEY ("dest_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "convoy_members_user_idx" ON "convoy_members" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "convoy_messages_idx" ON "convoy_messages" USING btree ("convoy_id","created_at");--> statement-breakpoint
CREATE INDEX "convoys_status_idx" ON "convoys" USING btree ("status","depart_at");--> statement-breakpoint
CREATE INDEX "convoys_org_idx" ON "convoys" USING btree ("organization_id");