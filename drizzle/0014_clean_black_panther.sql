CREATE TABLE "company_licences" (
	"company_id" uuid NOT NULL,
	"licence" text NOT NULL,
	"price_cents" bigint DEFAULT 0 NOT NULL,
	"bought_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_licences_company_id_licence_pk" PRIMARY KEY("company_id","licence")
);
--> statement-breakpoint
ALTER TABLE "company_licences" ADD CONSTRAINT "company_licences_company_id_organizations_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_licences" ADD CONSTRAINT "company_licences_bought_by_users_id_fk" FOREIGN KEY ("bought_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The default deputy rank of existing companies may now clear the company chat.
UPDATE "company_ranks" SET "permissions" = array_append("permissions", 'manage_chat') WHERE "name" = 'Заместник' AND "is_owner" = false AND NOT ('manage_chat' = ANY("permissions"));
