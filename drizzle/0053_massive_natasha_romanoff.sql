ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_driver_id_drivers_id_fk";
--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "driver_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "loyalty" integer DEFAULT 70 NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "request" text;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "request_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "vacation_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "last_vacation_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "cosmetics" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;