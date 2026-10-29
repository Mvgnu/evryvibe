import Link from "next/link";
import { copy, DemoNotice } from "@/components/catalog-ui";
import { MapExplorer } from "@/components/map-explorer";
import { requestTime } from "@/components/request-time";
import {
  catalogCities,
  cityNights,
  citySlug,
  isScheduled,
  isUpcoming,
} from "@/core/cities";
import { localizePath, localizedTitle } from "@/core/i18n";
import { locationFor } from "@/core/locations";
import { pageMetadata } from "@/core/site";
import { getCatalog } from "@/db/catalog";
import { requestLocale } from "@/lib/locale";
import "./map.css";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const locale = await requestLocale();
  return {
    ...pageMetadata(
      copy(locale, "Nächte auf der Karte", "Nights on the map"),
      copy(
        locale,
        "Entdecke kommende Nächte nach Stadt auf der Karte.",
        "Explore upcoming nights by city on the map.",
      ),
      "/map",
      locale,
    ),
    // This is a preview, not a new search landing page.
    robots: { index: false, follow: true },
  };
}

export default async function MapPage() {
  const locale = await requestLocale();
  const catalog = await getCatalog();
  const now = requestTime();
  const venues = new Map(catalog.venues.map((venue) => [venue.id, venue]));
  const locations = [];
  const missingCities = new Set<string>();
  for (const city of catalogCities(catalog.venues)) {
    const nights = cityNights(catalog, city, now);
    if (!nights.length) continue;
    const place = locationFor(city.name, city.country);
    if (!place) {
      missingCities.add(city.name);
      continue;
    }
    const events = nights.flatMap((event) => {
      const venue = venues.get(event.venueId);
      return venue
        ? [
            {
              slug: event.slug,
              title: localizedTitle(event, locale),
              venueName: venue.name,
              startsAt: event.startsAt,
              timezone: venue.timezone,
            },
          ]
        : [];
    });
    locations.push({
      slug: city.slug,
      name: city.name,
      latitude: place.latitude,
      longitude: place.longitude,
      events,
    });
  }
  for (const event of catalog.events) {
    const venue = venues.get(event.venueId);
    if (
      venue &&
      !citySlug(venue.city) &&
      isScheduled(event) &&
      isUpcoming(event, now, venue.timezone)
    )
      missingCities.add(venue.city);
  }
  return (
    <main id="main" className="map-page">
      <DemoNotice mode={catalog.mode} locale={locale} />
      <div className="map-shell">
        <header className="map-hero">
          <p className="map-kicker">
            {copy(locale, "Entdecken / Karte", "Discover / Map")}{" "}
            <span>01 / 02</span>
          </p>
          <div className="map-hero-row">
            <div>
              <h1>
                {copy(locale, "Nächte auf der Karte", "Nights on the map")}
              </h1>
              <p>
                {copy(
                  locale,
                  "Wähle eine Stadt und entdecke, was dort als Nächstes passiert.",
                  "Choose a city and discover what’s happening next.",
                )}
              </p>
            </div>
            <Link className="map-list-link" href={localizePath("/", locale)}>
              {copy(locale, "Zur Listenansicht", "List view")}{" "}
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </header>
        <MapExplorer
          locations={locations}
          locale={locale}
          missingCities={[...missingCities].sort((a, b) =>
            a.localeCompare(b, locale),
          )}
        />
        <p className="map-source-note">
          {copy(
            locale,
            "Die Markierungen zeigen ungefähre Stadtmittelpunkte, keine Clubstandorte.",
            "Markers show approximate city centres, not venue locations.",
          )}{" "}
          <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">
            GeoNames
          </a>{" "}
          ·{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY 4.0
          </a>
        </p>
      </div>
    </main>
  );
}
