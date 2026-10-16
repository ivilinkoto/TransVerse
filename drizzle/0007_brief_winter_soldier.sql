CREATE TABLE "coin_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" text NOT NULL,
	"description" text NOT NULL,
	"actor_user_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "reserved_by_company_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "reserved_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "coins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "xp_boost_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vip_reroll_key" text;--> statement-breakpoint
ALTER TABLE "coin_entries" ADD CONSTRAINT "coin_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_entries" ADD CONSTRAINT "coin_entries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coin_entries_idempotency_idx" ON "coin_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "coin_entries_user_idx" ON "coin_entries" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_reserved_by_company_id_companies_id_fk" FOREIGN KEY ("reserved_by_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;