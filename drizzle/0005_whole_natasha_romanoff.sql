DROP INDEX "deliveries_contract_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_contract_company_idx" ON "deliveries" USING btree ("contract_id","company_id");