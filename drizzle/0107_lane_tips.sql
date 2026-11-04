CREATE TABLE "lane_tip_votes" (
	"tip_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "lane_tip_votes_tip_id_user_id_pk" PRIMARY KEY("tip_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "lane_tips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"origin_city_id" integer NOT NULL,
	"dest_city_id" integer NOT NULL,
	"body" text NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lane_tip_votes" ADD CONSTRAINT "lane_tip_votes_tip_id_lane_tips_id_fk" FOREIGN KEY ("tip_id") REFERENCES "public"."lane_tips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_tip_votes" ADD CONSTRAINT "lane_tip_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_tips" ADD CONSTRAINT "lane_tips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_tips" ADD CONSTRAINT "lane_tips_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_tips" ADD CONSTRAINT "lane_tips_dest_city_id_cities_id_fk" FOREIGN KEY ("dest_city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lane_tips_user_lane_idx" ON "lane_tips" USING btree ("user_id","origin_city_id","dest_city_id");--> statement-breakpoint
CREATE INDEX "lane_tips_lane_idx" ON "lane_tips" USING btree ("origin_city_id","dest_city_id");