CREATE TABLE "plot_likes" (
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plot_likes_user_id_organization_id_pk" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "livery_color" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "company_livery" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "service_km" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plot_likes" ADD CONSTRAINT "plot_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_likes" ADD CONSTRAINT "plot_likes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plot_likes_org_idx" ON "plot_likes" USING btree ("organization_id","created_at");--> statement-breakpoint
-- Maintenance: trucks bought before it count as just serviced.
UPDATE "vehicles" SET "service_km" = "odometer_km";
