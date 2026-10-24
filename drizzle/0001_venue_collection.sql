CREATE TABLE "package_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_sources" (
	"venue_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"last_error" text,
	"last_post_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "package_history" ADD CONSTRAINT "package_history_package_id_post_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."post_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_sources" ADD CONSTRAINT "venue_sources_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;