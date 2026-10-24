CREATE TABLE "reconciliation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dj_id" uuid,
	"venue_id" uuid,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_reason" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"completed_token" uuid,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "reconciliation_entity_valid" CHECK (num_nonnulls("reconciliation_tasks"."dj_id", "reconciliation_tasks"."venue_id") = 1),
	CONSTRAINT "reconciliation_state_valid" CHECK ("reconciliation_tasks"."state" IN ('pending', 'processing', 'done', 'deferred')),
	CONSTRAINT "reconciliation_claim_valid" CHECK (("reconciliation_tasks"."state" = 'processing' AND "reconciliation_tasks"."lease_token" IS NOT NULL AND "reconciliation_tasks"."lease_expires_at" IS NOT NULL) OR ("reconciliation_tasks"."state" <> 'processing' AND "reconciliation_tasks"."lease_token" IS NULL AND "reconciliation_tasks"."lease_expires_at" IS NULL)),
	CONSTRAINT "reconciliation_done_valid" CHECK ("reconciliation_tasks"."state" <> 'done' OR ("reconciliation_tasks"."completed_token" IS NOT NULL AND "reconciliation_tasks"."outcome" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "image_source_url" text;--> statement-breakpoint
ALTER TABLE "reconciliation_tasks" ADD CONSTRAINT "reconciliation_tasks_dj_id_djs_id_fk" FOREIGN KEY ("dj_id") REFERENCES "public"."djs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_tasks" ADD CONSTRAINT "reconciliation_tasks_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_open_dj" ON "reconciliation_tasks" USING btree ("dj_id") WHERE "reconciliation_tasks"."state" <> 'done' AND "reconciliation_tasks"."dj_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_open_venue" ON "reconciliation_tasks" USING btree ("venue_id") WHERE "reconciliation_tasks"."state" <> 'done' AND "reconciliation_tasks"."venue_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reconciliation_claim_order" ON "reconciliation_tasks" USING btree ("state","priority","created_at");