-- Existing covers came from the event's own public post/reel source; record
-- that provenance so later story or post updates cannot orphan the cover.
UPDATE "events"
SET "image_source_url" = "source_url"
WHERE "image_url" IS NOT NULL
  AND "image_source_url" IS NULL
  AND "source_url" ~ '^https://www\.instagram\.com/(p|reel)/';
