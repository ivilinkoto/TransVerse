CREATE TABLE "duo_signups" (
	"week" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duo_signups_week_user_id_pk" PRIMARY KEY("week","user_id")
);
--> statement-breakpoint
CREATE TABLE "duos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week" text NOT NULL,
	"a_id" uuid NOT NULL,
	"b_id" uuid NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"target" integer NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"main_contract_id" uuid NOT NULL,
	"main_delivery_id" uuid,
	"leader_id" uuid NOT NULL,
	"escort_contract_id" uuid,
	"escort_user_id" uuid,
	"escort_delivery_id" uuid,
	"main_done" boolean DEFAULT false NOT NULL,
	"main_late" boolean,
	"escort_done" boolean DEFAULT false NOT NULL,
	"escort_late" boolean,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_wants" (
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_wants_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "market_rumors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" text NOT NULL,
	"country" text NOT NULL,
	"cargo" text NOT NULL,
	"real" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_ratings" (
	"rater_id" uuid NOT NULL,
	"ratee_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"good" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_ratings_rater_id_ref_pk" PRIMARY KEY("rater_id","ref")
);
--> statement-breakpoint
CREATE TABLE "road_waves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"a_id" uuid NOT NULL,
	"b_id" uuid NOT NULL,
	"a_delivery_id" uuid NOT NULL,
	"b_delivery_id" uuid NOT NULL,
	"a_waved" boolean DEFAULT false NOT NULL,
	"b_waved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "escort" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "escort_for" uuid;--> statement-breakpoint
ALTER TABLE "duo_signups" ADD CONSTRAINT "duo_signups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duos" ADD CONSTRAINT "duos_a_id_users_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duos" ADD CONSTRAINT "duos_b_id_users_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escorts" ADD CONSTRAINT "escorts_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_wants" ADD CONSTRAINT "item_wants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ratings" ADD CONSTRAINT "partner_ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_ratings" ADD CONSTRAINT "partner_ratings_ratee_id_users_id_fk" FOREIGN KEY ("ratee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_waves" ADD CONSTRAINT "road_waves_a_id_users_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_waves" ADD CONSTRAINT "road_waves_b_id_users_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "duos_a_idx" ON "duos" USING btree ("week","a_id");--> statement-breakpoint
CREATE UNIQUE INDEX "duos_b_idx" ON "duos" USING btree ("week","b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "escorts_main_idx" ON "escorts" USING btree ("main_contract_id");--> statement-breakpoint
CREATE INDEX "escorts_status_idx" ON "escorts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "item_wants_item_idx" ON "item_wants" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "market_rumors_day_idx" ON "market_rumors" USING btree ("day");--> statement-breakpoint
CREATE INDEX "partner_ratings_ratee_idx" ON "partner_ratings" USING btree ("ratee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "road_waves_pair_idx" ON "road_waves" USING btree ("a_delivery_id","b_delivery_id");--> statement-breakpoint
CREATE INDEX "road_waves_b_idx" ON "road_waves" USING btree ("b_id");