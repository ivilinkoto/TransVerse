CREATE TABLE "cb_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"near" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "road_report_votes" (
	"report_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"vote" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "road_report_votes_report_id_user_id_pk" PRIMARY KEY("report_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "road_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"near" text NOT NULL,
	"confirms" integer DEFAULT 0 NOT NULL,
	"denies" integer DEFAULT 0 NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cb_messages" ADD CONSTRAINT "cb_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_report_votes" ADD CONSTRAINT "road_report_votes_report_id_road_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."road_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_report_votes" ADD CONSTRAINT "road_report_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_reports" ADD CONSTRAINT "road_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cb_messages_created_idx" ON "cb_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "road_reports_expires_idx" ON "road_reports" USING btree ("expires_at");