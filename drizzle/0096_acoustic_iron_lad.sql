ALTER TABLE "deliveries" ADD COLUMN "soon_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "favorite_vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_favorite_vehicle_id_vehicles_id_fk" FOREIGN KEY ("favorite_vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;