CREATE TABLE "fines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"delivery_id" uuid,
	"violation" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"appealed" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "violations" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "insured_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fines" ADD CONSTRAINT "fines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fines" ADD CONSTRAINT "fines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fines" ADD CONSTRAINT "fines_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fines_company_idx" ON "fines" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "fines_due_idx" ON "fines" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fines_delivery_violation_idx" ON "fines" USING btree ("delivery_id","violation");