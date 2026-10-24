ALTER TABLE "djs" ADD COLUMN "soundcloud_url" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "soundcloud_url" text;--> statement-breakpoint
ALTER TABLE "djs" ADD CONSTRAINT "djs_soundcloud_url_unique" UNIQUE("soundcloud_url");--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_soundcloud_url_unique" UNIQUE("soundcloud_url");