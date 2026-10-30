ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "latitude" double precision;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "longitude" double precision;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "location_source_url" text;