CREATE TABLE "egg_fights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"year" integer NOT NULL,
	"winner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "urgent_raises" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "egg_fights" ADD CONSTRAINT "egg_fights_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "egg_fights" ADD CONSTRAINT "egg_fights_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "egg_fights" ADD CONSTRAINT "egg_fights_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "egg_fights_pair_idx" ON "egg_fights" USING btree ("user_a","user_b","year");--> statement-breakpoint
CREATE INDEX "egg_fights_winner_idx" ON "egg_fights" USING btree ("winner_id");