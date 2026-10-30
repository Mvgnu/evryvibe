import type { MetadataRoute } from "next";
import { absoluteUrl, isPublicSite, languageAlternates } from "@/core/site";
import { getCatalog } from "@/db/catalog";
import { catalogCities, cityNights, isUpcoming } from "@/core/cities";
import { cityMonths } from "@/app/cities/city-data";
import { directoryEntries } from "@/core/dj-directory";
import { buildReels } from "@/core/reels";
import {
  genrePath,
  genreStats,
  isIndexableGenre,
} from "@/components/dj-directory-view";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isPublicSite()) return [];
  const catalog = await getCatalog();
  if (catalog.mode === "demo") return [];
  // Empty city pages are noindex, so only cities with upcoming events are listed,
  // and the city index only once there is at least one.
  const now = Date.now();
  const cities = catalogCities(catalog.venues).filter(
    (city) => cityNights(catalog, city, now).length > 0,
  );
  // Source observation and editorial timestamps do not capture every change
  // to a rolling calendar. Omit lastmod until page modifications are tracked.
  const monthlyPaths = cities.flatMap((city) =>
    cityMonths(catalog, city, now).map(
      (month) => `/cities/${city.slug}/${month}`,
    ),
  );
  // The DJ directory and genre pages follow their own robots rules: a genre
  // page with fewer than five DJs and no upcoming night is noindex.
  const entries = directoryEntries(catalog, now);
  const genres = [...genreStats(entries, catalog, now).values()].filter(
    isIndexableGenre,
  );
  const paths = [
    "/",
    ...(cities.length
      ? ["/cities", ...cities.map(({ slug }) => `/cities/${slug}`)]
      : []),
    ...monthlyPaths,
    ...(entries.length ? ["/djs"] : []),
    ...(genres.length
      ? ["/genres", ...genres.map(({ genre }) => genrePath(genre))]
      : []),
    // Reels has something to play only with a booked SoundCloud DJ.
    ...(buildReels(catalog, now).length ? ["/reels"] : []),
    "/impressum",
    "/datenschutz",
    "/kontakt",
    "/takedown",
    ...catalog.events
      .filter((event) => {
        const venue = catalog.venues.find(
          (venue) => venue.id === event.venueId,
        );
        return venue && isUpcoming(event, now, venue.timezone);
      })
      .map(({ slug }) => `/events/${slug}`),
    ...catalog.venues.map(({ slug }) => `/venues/${slug}`),
    ...catalog.djs.map(({ slug }) => `/djs/${slug}`),
  ];
  return paths.flatMap((path) =>
    (["de", "en"] as const).map((locale) => ({
      url: absoluteUrl(path, locale),
      alternates: { languages: languageAlternates(path) },
    })),
  );
}
