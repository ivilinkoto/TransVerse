CREATE TABLE "country_kings" (
	"month" text NOT NULL,
	"country_code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"tons" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "country_kings_month_country_code_pk" PRIMARY KEY("month","country_code")
);
--> statement-breakpoint
ALTER TABLE "country_kings" ADD CONSTRAINT "country_kings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "country_kings_user_idx" ON "country_kings" USING btree ("user_id");