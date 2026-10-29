CREATE TABLE "dj_aliases" (
	"slug" text PRIMARY KEY NOT NULL,
	"dj_id" uuid NOT NULL,
	"evidence" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dj_aliases" ADD CONSTRAINT "dj_aliases_dj_id_djs_id_fk" FOREIGN KEY ("dj_id") REFERENCES "public"."djs"("id") ON DELETE no action ON UPDATE no action;