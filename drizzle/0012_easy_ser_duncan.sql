CREATE TABLE "artist_claim_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"dj_id" uuid NOT NULL,
	"instagram_scoped_id" text NOT NULL,
	"instagram_url" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_claim_links_message_id_unique" UNIQUE("message_id"),
	CONSTRAINT "artist_claim_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "artist_owners" (
	"dj_id" uuid PRIMARY KEY NOT NULL,
	"instagram_scoped_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_owners_instagram_scoped_id_unique" UNIQUE("instagram_scoped_id")
);
--> statement-breakpoint
CREATE TABLE "artist_profiles" (
	"dj_id" uuid PRIMARY KEY NOT NULL,
	"bio" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artist_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dj_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "artist_claim_links" ADD CONSTRAINT "artist_claim_links_dj_id_djs_id_fk" FOREIGN KEY ("dj_id") REFERENCES "public"."djs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_owners" ADD CONSTRAINT "artist_owners_dj_id_djs_id_fk" FOREIGN KEY ("dj_id") REFERENCES "public"."djs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_profiles" ADD CONSTRAINT "artist_profiles_dj_id_artist_owners_dj_id_fk" FOREIGN KEY ("dj_id") REFERENCES "public"."artist_owners"("dj_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_sessions" ADD CONSTRAINT "artist_sessions_dj_id_artist_owners_dj_id_fk" FOREIGN KEY ("dj_id") REFERENCES "public"."artist_owners"("dj_id") ON DELETE no action ON UPDATE no action;