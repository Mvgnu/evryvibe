-- Captured Instagram media is OCR input only. Retire previously published CDN
-- links and remove legacy capture URLs/candidates from queued evidence.
UPDATE "events" SET "image_url" = NULL WHERE "image_url" IS NOT NULL;--> statement-breakpoint
UPDATE "venues" SET "image_url" = NULL WHERE "image_url" IS NOT NULL;--> statement-breakpoint
UPDATE "djs" SET "image_url" = NULL WHERE "image_url" IS NOT NULL;--> statement-breakpoint
UPDATE "post_packages" SET "payload" = "payload" - 'imageUrls' - 'imageCandidates' WHERE "payload" ? 'imageUrls' OR "payload" ? 'imageCandidates';--> statement-breakpoint
UPDATE "package_history" SET "payload" = "payload" - 'imageUrls' - 'imageCandidates' WHERE "payload" ? 'imageUrls' OR "payload" ? 'imageCandidates';
