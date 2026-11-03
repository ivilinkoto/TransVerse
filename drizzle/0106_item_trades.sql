CREATE TABLE "company_chest" (
	"organization_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_chest_organization_id_item_id_pk" PRIMARY KEY("organization_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "company_chest_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"user_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_gifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "item_serials" (
	"item_id" text NOT NULL,
	"serial" integer NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_serials_item_id_serial_pk" PRIMARY KEY("item_id","serial")
);
--> statement-breakpoint
CREATE TABLE "item_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"give_item" text NOT NULL,
	"want_item" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "item_effects" ADD COLUMN "data" jsonb;--> statement-breakpoint
ALTER TABLE "company_chest" ADD CONSTRAINT "company_chest_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chest_log" ADD CONSTRAINT "company_chest_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chest_log" ADD CONSTRAINT "company_chest_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_gifts" ADD CONSTRAINT "item_gifts_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_gifts" ADD CONSTRAINT "item_gifts_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_serials" ADD CONSTRAINT "item_serials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_trades" ADD CONSTRAINT "item_trades_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_trades" ADD CONSTRAINT "item_trades_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_chest_log_key_idx" ON "company_chest_log" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "company_chest_log_org_idx" ON "company_chest_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "item_gifts_to_idx" ON "item_gifts" USING btree ("to_user_id","opened_at");--> statement-breakpoint
CREATE INDEX "item_trades_to_idx" ON "item_trades" USING btree ("to_user_id","status");--> statement-breakpoint
CREATE INDEX "item_trades_from_idx" ON "item_trades" USING btree ("from_user_id","status");