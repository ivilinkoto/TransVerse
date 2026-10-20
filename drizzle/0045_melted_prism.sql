CREATE TABLE "chat_reads" (
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"last_read_id" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_reads_user_id_channel_pk" PRIMARY KEY("user_id","channel")
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "reply_to_id" bigint;--> statement-breakpoint
ALTER TABLE "company_messages" ADD COLUMN "reply_to_id" bigint;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD COLUMN "reply_to_id" bigint;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;