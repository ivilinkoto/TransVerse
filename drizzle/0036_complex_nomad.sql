CREATE TABLE "roadside_helps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"stop_at" timestamp with time zone NOT NULL,
	"helper_id" uuid NOT NULL,
	"saved_ms" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roadside_helps" ADD CONSTRAINT "roadside_helps_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadside_helps" ADD CONSTRAINT "roadside_helps_helper_id_users_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roadside_helps_stop_idx" ON "roadside_helps" USING btree ("delivery_id","stop_at");--> statement-breakpoint
CREATE INDEX "roadside_helps_helper_idx" ON "roadside_helps" USING btree ("helper_id","created_at");