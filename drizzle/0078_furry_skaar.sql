CREATE TABLE "contract_haggles" (
	"contract_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"percent" integer NOT NULL,
	"accepted" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_haggles_contract_id_user_id_pk" PRIMARY KEY("contract_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "sealed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "haggle_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_haggles" ADD CONSTRAINT "contract_haggles_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_haggles" ADD CONSTRAINT "contract_haggles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;