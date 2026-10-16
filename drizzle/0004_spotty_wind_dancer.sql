CREATE TABLE "user_licences" (
	"user_id" uuid NOT NULL,
	"licence" text NOT NULL,
	"price_cents" bigint DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'purchase' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_licences_user_id_licence_pk" PRIMARY KEY("user_id","licence")
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "speed_factor" real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "vip_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_licences" ADD CONSTRAINT "user_licences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Licences did not exist before: existing players keep everything they already did or equipped for.
-- 1) From completed deliveries (route countries + both ends, and the cargo type).
INSERT INTO "user_licences" ("user_id", "licence", "source")
SELECT DISTINCT c."owner_id", l.licence, 'legacy'
FROM "deliveries" d
JOIN "companies" c ON c."id" = d."company_id"
JOIN "contracts" k ON k."id" = d."contract_id"
JOIN "cities" o ON o."id" = k."origin_city_id"
JOIN "cities" t ON t."id" = k."dest_city_id"
JOIN "routes" r ON r."id" = d."route_id"
CROSS JOIN LATERAL (
  SELECT array(SELECT DISTINCT x FROM unnest(r."countries" || ARRAY[o."country_code", t."country_code"]) x) AS cs
) cc
CROSS JOIN LATERAL (
  SELECT 'international' AS licence WHERE cardinality(cc.cs) > 1
  UNION ALL SELECT 'customs' WHERE cardinality(cc.cs) > 1 AND cc.cs && ARRAY['TR', 'RS', 'MK']
  UNION ALL SELECT 'reefer' WHERE k."cargo_type" = 'refrigerated'
  UNION ALL SELECT 'adr' WHERE k."cargo_type" = 'liquid'
  UNION ALL SELECT 'oversize' WHERE k."cargo_type" = 'special'
) l
WHERE d."status" IN ('completed', 'in_progress')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 2) From equipment the player already has (reefer, tanker, low-bed bodies).
INSERT INTO "user_licences" ("user_id", "licence", "source")
SELECT DISTINCT c."owner_id", e.licence, 'legacy'
FROM "companies" c
JOIN (
  SELECT "company_id", CASE "model_id" WHEN 'hemus-r12-frigo' THEN 'reefer' END AS licence FROM "vehicles" WHERE "sold_at" IS NULL
  UNION ALL
  SELECT "company_id", CASE "model_id" WHEN 'reefer-13' THEN 'reefer' WHEN 'tanker-32' THEN 'adr' WHEN 'lowbed-4' THEN 'oversize' END FROM "trailers" WHERE "sold_at" IS NULL
) e ON e."company_id" = c."id"
WHERE e.licence IS NOT NULL
ON CONFLICT DO NOTHING;
