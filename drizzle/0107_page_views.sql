CREATE TABLE "page_views" (
	"day" text NOT NULL,
	"path" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "page_views_day_path_pk" PRIMARY KEY("day","path")
);
--> statement-breakpoint
CREATE TABLE "page_visitors" (
	"day" text NOT NULL,
	"path" text NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "page_visitors_day_path_user_id_pk" PRIMARY KEY("day","path","user_id")
);
--> statement-breakpoint
ALTER TABLE "page_visitors" ADD CONSTRAINT "page_visitors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_visitors_path_idx" ON "page_visitors" USING btree ("path","day");