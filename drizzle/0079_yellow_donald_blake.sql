CREATE TABLE "share_holdings" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"shares" integer NOT NULL,
	"cost_cents" bigint NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "share_holdings_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "share_prices" (
	"organization_id" uuid NOT NULL,
	"day" text NOT NULL,
	"price_cents" bigint NOT NULL,
	CONSTRAINT "share_prices_organization_id_day_pk" PRIMARY KEY("organization_id","day")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "listed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "share_price_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "share_holdings" ADD CONSTRAINT "share_holdings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_holdings" ADD CONSTRAINT "share_holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_prices" ADD CONSTRAINT "share_prices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_holdings_user_idx" ON "share_holdings" USING btree ("user_id");