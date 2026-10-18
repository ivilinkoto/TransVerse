CREATE TABLE "seasonal_quests" (
	"user_id" uuid NOT NULL,
	"quest" text NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasonal_quests_user_id_quest_pk" PRIMARY KEY("user_id","quest")
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"user_id" uuid NOT NULL,
	"badge" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_badges_user_id_badge_pk" PRIMARY KEY("user_id","badge")
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "holiday" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "livery" text;--> statement-breakpoint
ALTER TABLE "seasonal_quests" ADD CONSTRAINT "seasonal_quests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;