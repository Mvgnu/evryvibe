ALTER TABLE "djs" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source_account_url" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "translations" jsonb DEFAULT '{}'::jsonb NOT NULL;