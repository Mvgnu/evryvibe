import { catalogCities, isScheduled, isUpcoming, type City } from "./cities";
import {
  canonicalGenre,
  canonicalGenresOf,
  genreFamilies,
  type CanonicalGenre,
  type GenreFamily,
  type GenreFamilySlug,
} from "./genres";
import type { Catalog, Dj, Event } from "./model";

// DJ discovery is derived from the catalogue: a DJ is listed once they have a
// scheduled night (past or upcoming), and their cities come from the venues
// of those nights. Past events stay in the catalogue, so "has played in this
// city" is answered from the same data as the listings.

export type DjCityTally = { city: City; past: number; upcoming: number };

export type DirectoryEntry = {
  dj: Dj;
  /** Canonical genres: the profile's, else up to three from their nights. */
  genres: CanonicalGenre[];
  genresFromEvents: boolean;
  /** Cities with scheduled nights, most nights first. */
  cities: DjCityTally[];
  pastNights: number;
  upcomingNights: number;
  /** Next scheduled night, or null. */
  next: Event | null;
  /** Most recent past scheduled night, or null. */
  last: Event | null;
};

export type DirectoryFilter = {
  genre?: CanonicalGenre | null;
  family?: GenreFamilySlug | null;
  /** DJs with a scheduled night in this city, past or upcoming. */
  city?: City | null;
};

export type Count<T> = { item: T; count: number };
export type DirectoryFacets = {
  families: Count<GenreFamily>[];
  genres: Count<CanonicalGenre>[];
  cities: Count<City>[];
};

const derivedGenreLimit = 3;

function tallyIn(entry: DirectoryEntry, city: City) {
  return entry.cities.find((item) => item.city.slug === city.slug);
}

function nightsIn(entry: DirectoryEntry, city: City | null | undefined) {
  if (!city) return entry.pastNights + entry.upcomingNights;
  const tally = tallyIn(entry, city);
  return tally ? tally.past + tally.upcoming : 0;
}

const playedIn = (entry: DirectoryEntry, city: City | null | undefined) =>
  city ? (tallyIn(entry, city)?.past ?? 0) : 0;

/**
 * Ranking: a DJ you can listen to first (SoundCloud is the point of the
 * page). In a filtered city, DJs who have played there come before DJs only
 * booked there, most nights played first. Then most nights (in the filtered
 * city when there is one), then an upcoming night, then name.
 */
export function compareEntries(
  a: DirectoryEntry,
  b: DirectoryEntry,
  city?: City | null,
): number {
  return (
    Number(Boolean(b.dj.soundcloudUrl)) - Number(Boolean(a.dj.soundcloudUrl)) ||
    playedIn(b, city) - playedIn(a, city) ||
    nightsIn(b, city) - nightsIn(a, city) ||
    Number(b.upcomingNights > 0) - Number(a.upcomingNights > 0) ||
    a.dj.name.localeCompare(b.dj.name, "de")
  );
}

/** Every DJ with at least one scheduled night, ranked by `compareEntries`. */
export function directoryEntries(
  catalog: Pick<Catalog, "djs" | "events" | "venues">,
  now: number,
): DirectoryEntry[] {
  const cityOfVenue = new Map<string, City>();
  for (const city of catalogCities(catalog.venues))
    for (const venueId of city.venueIds) cityOfVenue.set(venueId, city);
  const nights = new Map<string, Event[]>();
  // Catalogue events are in start order, so each DJ's list is too.
  const ordered = [...catalog.events].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
  for (const event of ordered) {
    if (!isScheduled(event)) continue;
    for (const djId of new Set(event.djIds)) {
      const list = nights.get(djId);
      if (list) list.push(event);
      else nights.set(djId, [event]);
    }
  }
  const entries: DirectoryEntry[] = [];
  for (const dj of catalog.djs) {
    const events = nights.get(dj.id);
    if (!events?.length) continue;
    const cities = new Map<string, DjCityTally>();
    let pastNights = 0;
    let upcomingNights = 0;
    let next: Event | null = null;
    let last: Event | null = null;
    for (const event of events) {
      const upcoming = catalog.venues.some(
        (venue) =>
          venue.id === event.venueId && isUpcoming(event, now, venue.timezone),
      );
      if (upcoming) {
        upcomingNights += 1;
        next ??= event;
      } else {
        pastNights += 1;
        last = event;
      }
      const city = cityOfVenue.get(event.venueId);
      if (!city) continue;
      const tally = cities.get(city.slug) ?? { city, past: 0, upcoming: 0 };
      if (upcoming) tally.upcoming += 1;
      else tally.past += 1;
      cities.set(city.slug, tally);
    }
    const profileGenres = canonicalGenresOf(dj.genres);
    const genres = profileGenres.length
      ? profileGenres
      : derivedGenres(events).slice(0, derivedGenreLimit);
    entries.push({
      dj,
      genres,
      genresFromEvents: !profileGenres.length && genres.length > 0,
      cities: [...cities.values()].sort(
        (a, b) =>
          b.past + b.upcoming - (a.past + a.upcoming) ||
          a.city.name.localeCompare(b.city.name, "de"),
      ),
      pastNights,
      upcomingNights,
      next,
      last,
    });
  }
  return entries.sort((a, b) => compareEntries(a, b));
}

// Most frequent canonical genre across a DJ's nights; ties keep first seen.
function derivedGenres(events: Event[]): CanonicalGenre[] {
  const counts = new Map<string, Count<CanonicalGenre>>();
  for (const event of events)
    for (const genre of canonicalGenresOf(event.genres)) {
      const tally = counts.get(genre.slug) ?? { item: genre, count: 0 };
      tally.count += 1;
      counts.set(genre.slug, tally);
    }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .map((tally) => tally.item);
}

export function matchesFilter(
  entry: DirectoryEntry,
  filter: DirectoryFilter,
): boolean {
  if (
    filter.genre &&
    !entry.genres.some((genre) => genre.slug === filter.genre?.slug)
  )
    return false;
  if (
    filter.family &&
    !entry.genres.some((genre) => genre.family === filter.family)
  )
    return false;
  if (filter.city && nightsIn(entry, filter.city) === 0) return false;
  return true;
}

/** Entries matching every filter, re-ranked by nights in the filtered city. */
export function filterDirectory(
  entries: readonly DirectoryEntry[],
  filter: DirectoryFilter,
): DirectoryEntry[] {
  const matching = entries.filter((entry) => matchesFilter(entry, filter));
  return filter.city
    ? matching.sort((a, b) => compareEntries(a, b, filter.city))
    : matching;
}

/**
 * Chip counts. Each facet counts entries matching the other filters, so a
 * chip shows how many DJs selecting it would leave. Zero counts are omitted;
 * families keep taxonomy order, genres and cities are most DJs first.
 */
export function directoryFacets(
  entries: readonly DirectoryEntry[],
  filter: DirectoryFilter,
): DirectoryFacets {
  const families = new Map<string, number>();
  const genres = new Map<string, Count<CanonicalGenre>>();
  const cities = new Map<string, Count<City>>();
  for (const entry of entries) {
    if (matchesFilter(entry, { ...filter, family: null, genre: null })) {
      const seen = new Set<string>();
      for (const genre of entry.genres) {
        if (seen.has(genre.family)) continue;
        seen.add(genre.family);
        families.set(genre.family, (families.get(genre.family) ?? 0) + 1);
      }
    }
    if (matchesFilter(entry, { ...filter, genre: null }))
      for (const genre of entry.genres) {
        const tally = genres.get(genre.slug) ?? { item: genre, count: 0 };
        tally.count += 1;
        genres.set(genre.slug, tally);
      }
    if (matchesFilter(entry, { ...filter, city: null }))
      for (const { city } of entry.cities) {
        const tally = cities.get(city.slug) ?? { item: city, count: 0 };
        tally.count += 1;
        cities.set(city.slug, tally);
      }
  }
  const byCount = <T>(a: Count<T>, b: Count<T>, name: (item: T) => string) =>
    b.count - a.count || name(a.item).localeCompare(name(b.item), "de");
  return {
    families: genreFamilies
      .filter((family) => families.has(family.slug))
      .map((family) => ({
        item: family,
        count: families.get(family.slug) ?? 0,
      })),
    genres: [...genres.values()].sort((a, b) =>
      byCount(a, b, (genre) => genre.name),
    ),
    cities: [...cities.values()].sort((a, b) =>
      byCount(a, b, (city) => city.name),
    ),
  };
}

/** Upcoming scheduled nights tagged with a genre, in start order. */
export function upcomingGenreEvents(
  catalog: Pick<Catalog, "events" | "venues">,
  genre: CanonicalGenre,
  now: number,
): Event[] {
  return catalog.events
    .filter(
      (event) =>
        isScheduled(event) &&
        catalog.venues.some(
          (venue) =>
            venue.id === event.venueId &&
            isUpcoming(event, now, venue.timezone),
        ) &&
        event.genres.some(
          (spelling) => canonicalGenre(spelling)?.slug === genre.slug,
        ),
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
