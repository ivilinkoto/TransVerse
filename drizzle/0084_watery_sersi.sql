CREATE TABLE "smuggling_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"delivery_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"borders" integer DEFAULT 0 NOT NULL,
	"caught" boolean NOT NULL,
	"fine_cents" bigint DEFAULT 0 NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "smuggling_checks_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
CREATE TABLE "smuggling_contacts" (
	"user_id" uuid NOT NULL,
	"city_id" integer NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "smuggling_contacts_user_id_city_id_pk" PRIMARY KEY("user_id","city_id")
);
--> statement-breakpoint
CREATE TABLE "smuggling_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"opt_in" boolean DEFAULT false NOT NULL,
	"heat" integer DEFAULT 0 NOT NULL,
	"underground" integer DEFAULT 0 NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"caught" integer DEFAULT 0 NOT NULL,
	"reports" integer DEFAULT 0 NOT NULL,
	"reports_today" text,
	"heat_decayed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "shady" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "hidden_compartment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "smuggling_checks" ADD CONSTRAINT "smuggling_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smuggling_contacts" ADD CONSTRAINT "smuggling_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smuggling_contacts" ADD CONSTRAINT "smuggling_contacts_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smuggling_profiles" ADD CONSTRAINT "smuggling_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "smuggling_checks_at_idx" ON "smuggling_checks" USING btree ("at");