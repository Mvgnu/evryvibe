CREATE TABLE "djs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"genres" jsonb NOT NULL,
	"image_url" text,
	"instagram_url" text,
	"website_url" text,
	"sample_post_url" text,
	CONSTRAINT "djs_slug_unique" UNIQUE("slug"),
	CONSTRAINT "djs_instagram_url_unique" UNIQUE("instagram_url")
);
--> statement-breakpoint
CREATE TABLE "event_djs" (
	"event_id" uuid NOT NULL,
	"dj_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "event_djs_event_id_dj_id_pk" PRIMARY KEY("event_id","dj_id")
);
--> statement-breakpoint
CREATE TABLE "event_sources" (
	"event_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	CONSTRAINT "event_sources_event_id_package_id_pk" PRIMARY KEY("event_id","package_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"venue_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"genres" jsonb NOT NULL,
	"image_url" text,
	"ticket_url" text,
	"website_url" text,
	"source_url" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "event_status_valid" CHECK ("events"."status" IN ('scheduled', 'cancelled')),
	CONSTRAINT "event_end_after_start" CHECK ("events"."ends_at" IS NULL OR "events"."ends_at" > "events"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "post_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_url" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_reason" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"completed_token" uuid,
	"result_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_packages_post_url_unique" UNIQUE("post_url"),
	CONSTRAINT "package_state_valid" CHECK ("post_packages"."state" IN ('pending', 'processing', 'done', 'deferred', 'discarded')),
	CONSTRAINT "package_claim_valid" CHECK (("post_packages"."state" = 'processing' AND "post_packages"."lease_token" IS NOT NULL AND "post_packages"."lease_expires_at" IS NOT NULL) OR ("post_packages"."state" <> 'processing' AND "post_packages"."lease_token" IS NULL AND "post_packages"."lease_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"country" text NOT NULL,
	"address" text NOT NULL,
	"timezone" text NOT NULL,
	"description" text NOT NULL,
	"image_url" text,
	"instagram_url" text,
	"website_url" text,
	CONSTRAINT "venues_slug_unique" UNIQUE("slug"),
	CONSTRAINT "venues_instagram_url_unique" UNIQUE("instagram_url")
);
--> statement-breakpoint
ALTER TABLE "event_djs" ADD CONSTRAINT "event_djs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_djs" ADD CONSTRAINT "event_djs_dj_id_djs_id_fk" FOREIGN KEY ("dj_id") REFERENCES "public"."djs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_package_id_post_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."post_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_venue_start_unique" ON "events" USING btree ("venue_id","starts_at");