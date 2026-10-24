CREATE TABLE "city_editorial" (
	"city_slug" text PRIMARY KEY NOT NULL,
	"de" jsonb NOT NULL,
	"en" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
