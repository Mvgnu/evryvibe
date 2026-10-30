-- Public-map rollout: pre-apply only coordinate columns, without artist migrations.
BEGIN;
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "latitude" double precision;

ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "longitude" double precision;

ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "location_source_url" text;
COMMIT;
