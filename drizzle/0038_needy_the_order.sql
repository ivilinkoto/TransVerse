CREATE TABLE "company_battles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_key" text NOT NULL,
	"a_id" uuid NOT NULL,
	"b_id" uuid NOT NULL,
	"a_tons" real DEFAULT 0 NOT NULL,
	"b_tons" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"winner_id" uuid,
	"ends_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_battles" ADD CONSTRAINT "company_battles_a_id_organizations_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_battles" ADD CONSTRAINT "company_battles_b_id_organizations_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_battles" ADD CONSTRAINT "company_battles_winner_id_organizations_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_battles_a_idx" ON "company_battles" USING btree ("week_key","a_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_battles_b_idx" ON "company_battles" USING btree ("week_key","b_id");--> statement-breakpoint
CREATE INDEX "company_battles_status_idx" ON "company_battles" USING btree ("status","ends_at");