ALTER TABLE "users" ADD COLUMN "vip_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vip_level_floor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- 1.3.2.2: everyone with VIP when the levels came keeps VIP5.
UPDATE "users" SET "vip_level_floor" = 5 WHERE "vip_until" > now();--> statement-breakpoint
-- The level by what each player has paid so far (euro cents; refunded payments do not count).
UPDATE "users" u SET "vip_level" = greatest(u."vip_level_floor", CASE
  WHEN s.spent >= 20000 THEN 5 WHEN s.spent >= 10000 THEN 4 WHEN s.spent >= 5000 THEN 3 WHEN s.spent >= 2000 THEN 2 WHEN s.spent >= 500 THEN 1 ELSE 0 END)
FROM (SELECT "user_id", sum("amount_cents") AS spent FROM "payments" WHERE "status" = 'paid' GROUP BY "user_id") s
WHERE s."user_id" = u."id";--> statement-breakpoint
UPDATE "users" SET "vip_level" = "vip_level_floor" WHERE "vip_level" < "vip_level_floor";
