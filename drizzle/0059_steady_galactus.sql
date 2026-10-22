CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"battle_id" uuid NOT NULL,
	"pick_org_id" uuid NOT NULL,
	"week_key" text NOT NULL,
	"correct" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_battle_id_company_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."company_battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "predictions_user_battle_idx" ON "predictions" USING btree ("user_id","battle_id");--> statement-breakpoint
CREATE INDEX "predictions_user_week_idx" ON "predictions" USING btree ("user_id","week_key");