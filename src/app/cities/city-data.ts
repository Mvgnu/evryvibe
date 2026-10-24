import { cityNights, cityEvents, type City } from "@/core/cities";
import type { Locale } from "@/core/i18n";
import { canonicalGenre, canonicalGenresOf } from "@/core/genres";
import type { Catalog, Dj, Event, Venue } from "@/core/model";
import { copy } from "@/components/catalog-ui";
import { compound } from "@/components/german-compound";

export type Tally<T> = { item: T; nights: number };

export type CityView = {
  city: City;
  // Every upcoming listing, cancelled ones included, in start order.
  events: Event[];
  // Upcoming nights that still take place.
  nights: Event[];
  venues: Tally<Venue>[];
  djs: Tally<Dj>[];
  genres: Tally<string>[];
};

function tally<T>(
  entries: Iterable<[string, T]>,
  name: (item: T) => string,
): Tally<T>[] {
  const counts = new Map<string, Tally<T>>();
  for (const [key, item] of entries) {
    const current = counts.get(key);
    if (current) current.nights += 1;
    else counts.set(key, { item, nights: 1 });
  }
  return [...counts.values()].sort(
    (a, b) =>
      b.nights - a.nights || name(a.item).localeCompare(name(b.item), "de"),
  );
}

export function cityView(catalog: Catalog, city: City, now: number): CityView {
  const events = cityEvents(catalog, city, now);
  const nights = cityNights(catalog, city, now);
  const djs = new Map(catalog.djs.map((dj) => [dj.id, dj]));
  const venueIds = new Set(city.venueIds);
  const cityVenues = catalog.venues.filter((venue) => venueIds.has(venue.id));
  const venueNights = new Map<string, number>();
  for (const event of nights)
    venueNights.set(event.venueId, (venueNights.get(event.venueId) ?? 0) + 1);
  return {
    city,
    events,
    nights,
    venues: cityVenues
      .map((venue) => ({ item: venue, nights: venueNights.get(venue.id) ?? 0 }))
      .sort(
        (a, b) =>
          b.nights - a.nights || a.item.name.localeCompare(b.item.name, "de"),
      ),
    // Only DJs that resolve to a published profile; one count per night.
    djs: tally(
      nights.flatMap((event) =>
        [...new Set(event.djIds)].flatMap((id): [string, Dj][] => {
          const dj = djs.get(id);
          return dj ? [[dj.id, dj]] : [];
        }),
      ),
      (dj) => dj.name,
    ),
    // Canonical genres only: spelling variants are one genre and unknown
    // spellings are not offered.
    genres: tally(
      nights.flatMap((event) =>
        canonicalGenresOf(event.genres).map((genre): [string, string] => [
          genre.slug,
          genre.name,
        ]),
      ),
      (genre) => genre,
    ),
  };
}

/** The city's canonical genre a requested spelling names, or "" when none. */
export function cityGenre(view: CityView, requested: string): string {
  const genre = requested ? canonicalGenre(requested) : null;
  return view.genres.find(({ item }) => item === genre?.name)?.item ?? "";
}

export function cityTitle(city: City, locale: Locale) {
  return copy(
    locale,
    `Techno-Partys in ${city.name}`,
    `Techno parties in ${city.name}`,
  );
}

function list(items: string[], locale: Locale) {
  return new Intl.ListFormat(locale === "en" ? "en-GB" : "de-DE", {
    type: "conjunction",
  }).format(items);
}

// Built only from catalogue facts: counts, frequent genres, and which kinds of
// information the listings actually carry.
export function cityDescription(view: CityView, locale: Locale, genre = "") {
  const { city, nights, venues } = view;
  if (!nights.length) {
    return copy(
      locale,
      `Auf EVRYVIBE sind gerade keine kommenden Nächte in ${city.name} veröffentlicht. ${venues.length} ${venues.length === 1 ? "Club" : "Clubs"} in ${city.name} auf EVRYVIBE.`,
      `No upcoming nights in ${city.name} are published on EVRYVIBE right now. ${venues.length} ${venues.length === 1 ? "venue" : "venues"} in ${city.name} on EVRYVIBE.`,
    );
  }
  const sounds = view.genres.slice(0, 3).map(({ item }) => item);
  const lead = copy(
    locale,
    genre
      ? `${nights.length} ${nights.length === 1 ? `kommendes ${compound(genre, "Event", "de")}` : `kommende ${compound(genre, "Events", "de")}`} in ${city.name}`
      : `${nights.length} ${nights.length === 1 ? "kommende Nacht" : "kommende Nächte"} in ${city.name}`,
    genre
      ? `${nights.length} upcoming ${genre} ${nights.length === 1 ? "event" : "events"} in ${city.name}`
      : `${nights.length} upcoming ${nights.length === 1 ? "night" : "nights"} in ${city.name}`,
  );
  const facets = [
    ...(view.djs.length ? [copy(locale, "Line-ups", "line-ups")] : []),
    copy(locale, "Clubs", "venues"),
    ...(nights.some((event) => event.ticketUrl)
      ? [copy(locale, "Tickets", "tickets")]
      : []),
  ];
  const tail = list(facets, locale);
  return `${lead}${sounds.length ? `: ${sounds.join(", ")}` : ""}. ${tail.charAt(0).toUpperCase()}${tail.slice(1)}.`;
}

// Venue records carry ISO country codes; show the localized name when known.
export function countryName(code: string, locale: Locale) {
  try {
    return (
      new Intl.DisplayNames([locale === "en" ? "en-GB" : "de-DE"], {
        type: "region",
      }).of(code.toUpperCase()) ?? code
    );
  } catch {
    return code;
  }
}

function eventMonth(event: Event, venues: Map<string, Venue>): string | null {
  const venue = venues.get(event.venueId);
  if (!venue) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: venue.timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(event.startsAt));
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

// Start month uses each venue's timezone, including overnight/DST events.
export function cityMonthEvents(
  catalog: Catalog,
  city: City,
  month: string,
  now: number,
): Event[] {
  const venues = new Map(catalog.venues.map((venue) => [venue.id, venue]));
  return cityEvents(catalog, city, now).filter(
    (event) => eventMonth(event, venues) === month,
  );
}

// A programme qualifies only while it has scheduled events yet to start.
export function cityMonths(
  catalog: Catalog,
  city: City,
  now: number,
): string[] {
  const venues = new Map(catalog.venues.map((venue) => [venue.id, venue]));
  const months = cityNights(catalog, city, now)
    .filter((event) => Date.parse(event.startsAt) >= now)
    .flatMap((event) => {
      const month = eventMonth(event, venues);
      return month ? [month] : [];
    });
  return [...new Set(months)].sort();
}

export function monthName(month: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-01T12:00:00Z`));
}

export function cityGenreTitle(city: City, genre: string, locale: Locale) {
  return copy(
    locale,
    `Kommende ${compound(genre, "Events", "de")} in ${city.name}`,
    `Upcoming ${genre} events in ${city.name}`,
  );
}

export function cityIntro(view: CityView, locale: Locale, genre = ""): string {
  const lead = copy(
    locale,
    genre
      ? `Entdecke kommende ${compound(genre, "Events", "de")} in ${view.city.name}.`
      : `Entdecke kommende Techno-Partys und Events in ${view.city.name}.`,
    genre
      ? `Discover upcoming ${genre} events in ${view.city.name}.`
      : `Discover upcoming techno parties and events in ${view.city.name}.`,
  );
  const venues = view.venues
    .filter((venue) => venue.nights > 0)
    .slice(0, 4)
    .map(({ item }) => item.name);
  return `${lead} ${cityDescription(view, locale, genre)}${venues.length ? copy(locale, ` Das veröffentlichte Programm umfasst ${list(venues, locale)}.`, ` The published programme includes ${list(venues, locale)}.`) : ""} ${copy(locale, "Die Termine stammen aus veröffentlichten Ankündigungen; die jeweilige Quelle findest du auf der Eventseite. Weitere Clubs und Events können fehlen.", "Dates come from published announcements; each event page links to its source. Other venues and events may be missing.")}`;
}

// Observation time measures source freshness, not catalogue modification.
export function latestObservation(events: Event[]): string | null {
  return events.reduce<string | null>(
    (latest, event) =>
      !latest || Date.parse(event.observedAt) > Date.parse(latest)
        ? event.observedAt
        : latest,
    null,
  );
}
