CREATE TABLE "company_chronicle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "driver_of_month_prize_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "driver_of_month" jsonb;--> statement-breakpoint
ALTER TABLE "company_chronicle" ADD CONSTRAINT "company_chronicle_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_chronicle_org_idx" ON "company_chronicle" USING btree ("organization_id","at");