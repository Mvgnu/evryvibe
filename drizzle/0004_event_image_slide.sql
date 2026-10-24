ALTER TABLE "events" ADD COLUMN "image_slide" integer;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "event_image_slide_valid" CHECK ("image_slide" IS NULL OR ("image_slide" BETWEEN 1 AND 20));
