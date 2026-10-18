CREATE TABLE "newspapers" (
	"week_key" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
