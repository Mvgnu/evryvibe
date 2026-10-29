CREATE TABLE "artist_event_covers" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"image_base64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"results" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "source_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "artist_created_by" uuid;--> statement-breakpoint
ALTER TABLE "artist_event_covers" ADD CONSTRAINT "artist_event_covers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_artist_created_by_djs_id_fk" FOREIGN KEY ("artist_created_by") REFERENCES "public"."djs"("id") ON DELETE no action ON UPDATE no action;