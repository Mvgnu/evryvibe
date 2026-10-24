// View helpers for the DJ directory (`/djs`) and the genre pages
// (`/genres`, `/genres/[slug]`). Pure and server-side over the contract in
// `src/core/dj-directory.ts`; the pages render links from what this returns.
import {
  catalogCities,
  isScheduled,
  isUpcoming,
  type City,
} from "@/core/cities";
import {
  directoryFacets,
  type Count,
  type DirectoryEntry,
  type DirectoryFilter,
} from "@/core/dj-directory";
import {
  canonicalGenres,
  canonicalGenresOf,
  genreFamilies,
  genreFamilyBySlug,
  type CanonicalGenre,
  type GenreFamily,
  type GenreFamilySlug,
} from "@/core/genres";
import { localizePath, type Locale } from "@/core/i18n";
import type { Catalog, Event, Venue } from "@/core/model";
import { copy } from "@/components/catalog-ui";
import { compound } from "@/components/german-compound";
import {
  dateChipLabel,
  localDate,
  parseHomeFilters,
} from "@/components/discovery-filters";

export const djPageSize = 60;
// The "more" link grows the list in place; past this the visitor narrows by
// city or sound instead of loading thousands of rows.
export const maxDjLimit = 180;
// A genre page is worth indexing with this many DJs or any upcoming night.
export const minIndexableGenreDjs = 5;
// Upcoming nights shown on a genre page before linking to the home filter.
export const genreNightsShown = 8;

/* ------------------------------------------------------------ query */

export type DirectoryQuery = {
  family: GenreFamilySlug | null;
  genre: CanonicalGenre | null;
  city: City | null;
  limit: number | null;
};

export type DirectoryParam = "sound" | "genre" | "city" | "limit";

export const emptyDirectoryQuery: DirectoryQuery = {
  family: null,
  genre: null,
  city: null,
  limit: null,
};

type Params = Record<string, string | string[] | undefined>;

/**
 * Reads the directory filters with the home conventions: `sound` is a family
 * slug (old slugs keep working), `genre` any spelling of a canonical genre,
 * `city` a city slug or name, `limit` the list length. Other parameters are
 * not filters here and are left alone. A malformed value is dropped and
 * named in `ignored`; `redirect` is set when a valid but non-canonical
 * spelling should answer with the one canonical URL.
 */
export function parseDirectoryQuery(
  params: Params,
  cities: readonly City[],
  accepted: readonly DirectoryParam[] = ["sound", "genre", "city", "limit"],
): { query: DirectoryQuery; ignored: DirectoryParam[]; redirect: boolean } {
  const own: Params = {};
  for (const key of accepted) own[key] = params[key];
  const { filters, ignored: homeIgnored } = parseHomeFilters(own);
  const ignored = homeIgnored.filter((key): key is DirectoryParam =>
    (accepted as readonly string[]).includes(key),
  );
  const city = filters.city
    ? (cities.find((item) => item.slug === filters.city) ?? null)
    : null;
  if (filters.city && !city && !ignored.includes("city")) ignored.push("city");
  const genre = filters.genre
    ? (canonicalGenres.find((item) => item.name === filters.genre) ?? null)
    : null;
  const query: DirectoryQuery = {
    family: filters.sound,
    genre,
    city,
    limit: filters.limit === null ? null : Math.min(maxDjLimit, filters.limit),
  };
  // Only a fully valid query is redirected, so a notice about a dropped
  // parameter is never lost to the redirect.
  const raw = (key: DirectoryParam) => {
    const value = own[key];
    return typeof value === "string" ? value : "";
  };
  const redirect =
    !ignored.length &&
    ((accepted.includes("genre") && raw("genre") !== (genre?.name ?? "")) ||
      (accepted.includes("sound") &&
        raw("sound") !== (query.family ?? "") &&
        Boolean(raw("sound") || raw("genre"))) ||
      (accepted.includes("city") && raw("city") !== (city?.slug ?? "")) ||
      (accepted.includes("limit") &&
        raw("limit") !== "" &&
        raw("limit") !== String(query.limit)));
  return { query, ignored, redirect };
}

export function isFilteredQuery(query: DirectoryQuery): boolean {
  return Boolean(query.family || query.genre || query.city);
}

export function directoryFilter(query: DirectoryQuery): DirectoryFilter {
  return { family: query.family, genre: query.genre, city: query.city };
}

/**
 * A URL on `path` with the current filters, some of them changed. Any filter
 * change starts the list from the top again. `sound` follows `genre`.
 */
export function directoryHref(
  path: string,
  locale: Locale,
  query: DirectoryQuery,
  change: Partial<DirectoryQuery> = {},
): string {
  const next = { ...query, limit: null, ...change };
  const search = new URLSearchParams();
  const family = next.genre?.family ?? next.family;
  if (family) search.set("sound", family);
  if (next.genre) search.set("genre", next.genre.name);
  if (next.city) search.set("city", next.city.slug);
  if (next.limit) search.set("limit", String(next.limit));
  const value = search.toString();
  return `${localizePath(path, locale)}${value ? `?${value}` : ""}`;
}

export function paramLabel(key: DirectoryParam, locale: Locale): string {
  switch (key) {
    case "sound":
      return "Sound";
    case "genre":
      return "Genre";
    case "city":
      return copy(locale, "Stadt", "city");
    case "limit":
      return copy(locale, "Anzahl", "number of DJs");
  }
}

/* ------------------------------------------------------------ paths */

export const genrePath = (genre: Pick<CanonicalGenre, "slug">) =>
  `/genres/${genre.slug}`;

/** The genre page of a canonical genre name, or null for unknown names. */
export function genrePathOf(name: string): string | null {
  const genre = canonicalGenres.find((item) => item.name === name);
  return genre ? genrePath(genre) : null;
}

/* ------------------------------------------------------------ counts */

export type GenreStats = {
  genre: CanonicalGenre;
  djs: number;
  listenable: number;
  /** Upcoming scheduled nights tagged with the genre. */
  nights: number;
};

/**
 * DJ and upcoming-night counts for every canonical genre in one pass each.
 * DJs count by the directory's genres, nights like `upcomingGenreEvents`.
 */
export function genreStats(
  entries: readonly DirectoryEntry[],
  catalog: Pick<Catalog, "events" | "venues">,
  now: number,
): Map<string, GenreStats> {
  const stats = new Map<string, GenreStats>(
    canonicalGenres.map((genre) => [
      genre.slug,
      { genre, djs: 0, listenable: 0, nights: 0 },
    ]),
  );
  for (const entry of entries)
    for (const genre of entry.genres) {
      const tally = stats.get(genre.slug);
      if (!tally) continue;
      tally.djs += 1;
      if (entry.dj.soundcloudUrl) tally.listenable += 1;
    }
  for (const event of catalog.events) {
    if (
      !isScheduled(event) ||
      !catalog.venues.some(
        (venue) =>
          venue.id === event.venueId && isUpcoming(event, now, venue.timezone),
      )
    )
      continue;
    for (const genre of canonicalGenresOf(event.genres)) {
      const tally = stats.get(genre.slug);
      if (tally) tally.nights += 1;
    }
  }
  return stats;
}

/** Fewer than five DJs and no upcoming night: too thin to index. */
export function isIndexableGenre(stats: Pick<GenreStats, "djs" | "nights">) {
  return stats.djs >= minIndexableGenreDjs || stats.nights > 0;
}

/**
 * Genres with at least one listed DJ or upcoming night. Keep navigation
 * useful while retaining known empty taxonomy pages for existing URLs.
 */
export function listedGenreSlugs(
  entries: readonly DirectoryEntry[],
  catalog: Pick<Catalog, "events" | "venues">,
  now: number,
): Set<string> {
  return new Set(
    [...genreStats(entries, catalog, now).values()]
      .filter((tally) => tally.djs > 0 || tally.nights > 0)
      .map((tally) => tally.genre.slug),
  );
}

export type FamilyGroup = {
  family: GenreFamily;
  /** DJs with at least one genre of the family. */
  djs: number;
  genres: GenreStats[];
};

/** Families in taxonomy order with their genres that have DJs or nights. */
export function genreIndex(
  entries: readonly DirectoryEntry[],
  stats: Map<string, GenreStats>,
): FamilyGroup[] {
  const families = new Map(
    directoryFacets(entries, {}).families.map(({ item, count }) => [
      item.slug,
      count,
    ]),
  );
  return genreFamilies.flatMap((family) => {
    const genres = family.genres
      .flatMap((genre) => {
        const tally = stats.get(genre.slug);
        return tally && (tally.djs || tally.nights) ? [tally] : [];
      })
      .sort(
        (a, b) =>
          b.djs - a.djs ||
          b.nights - a.nights ||
          a.genre.name.localeCompare(b.genre.name, "de"),
      );
    return genres.length
      ? [{ family, djs: families.get(family.slug) ?? 0, genres }]
      : [];
  });
}

/* -------------------------------------------------------------- rows */

export type DjRow = {
  entry: DirectoryEntry;
  /** "5 Gigs · Köln, Stuttgart +1", or "3× in Berlin" for a city. */
  where: string;
  /** "Nächster Gig Fr., 24. Okt. · Köln" or "Zuletzt …"; null if unknown. */
  when: string | null;
  /** Up to two canonical genres. */
  sound: string;
};

type Places = {
  venues: Map<string, Venue>;
  cityOfVenue: Map<string, City>;
  nights: Map<string, Event[]>;
};

/** Lookups for the rows of one page: venues, cities and each DJ's nights. */
export function placesOf(catalog: Pick<Catalog, "venues" | "events">): Places {
  const cityOfVenue = new Map<string, City>();
  for (const city of catalogCities(catalog.venues))
    for (const id of city.venueIds) cityOfVenue.set(id, city);
  const nights = new Map<string, Event[]>();
  for (const event of catalog.events) {
    if (!isScheduled(event)) continue;
    for (const id of new Set(event.djIds)) {
      const list = nights.get(id);
      if (list) list.push(event);
      else nights.set(id, [event]);
    }
  }
  for (const list of nights.values())
    list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return {
    venues: new Map(catalog.venues.map((venue) => [venue.id, venue])),
    cityOfVenue,
    nights,
  };
}

/**
 * Up to two genres for a row. The page's genre (or, with only a family
 * filter, the DJ's first genre of that family) comes first, so a drum and
 * bass page never shows a row tagged "Techno · House" alone.
 */
export function rowGenres(
  entry: DirectoryEntry,
  focus: Pick<DirectoryQuery, "genre" | "family"> = emptyDirectoryQuery,
): CanonicalGenre[] {
  const lead =
    (focus.genre &&
      entry.genres.find((item) => item.slug === focus.genre?.slug)) ||
    (focus.family &&
      entry.genres.find((item) => item.family === focus.family)) ||
    null;
  return lead
    ? [lead, ...entry.genres.filter((item) => item.slug !== lead.slug)].slice(
        0,
        2,
      )
    : entry.genres.slice(0, 2);
}

const gigsWord = (count: number) => (count === 1 ? "Gig" : "Gigs");

/**
 * What a row says about where and when a DJ plays. With a city filter the
 * count and dates are that city's; a past night reads "Zuletzt", an upcoming
 * one "Nächster Gig", so an announced booking is never called played.
 */
export function djRow(
  entry: DirectoryEntry,
  city: City | null,
  places: Places,
  locale: Locale,
  now: number,
  focus: Pick<DirectoryQuery, "genre" | "family"> = emptyDirectoryQuery,
): DjRow {
  const today = new Date(now).toISOString().slice(0, 10);
  let where: string;
  let nights = places.nights.get(entry.dj.id) ?? [];
  if (city) {
    const tally = entry.cities.find((item) => item.city.slug === city.slug);
    const count = tally ? tally.past + tally.upcoming : 0;
    where = `${count}× in ${city.name}`;
    nights = nights.filter(
      (event) => places.cityOfVenue.get(event.venueId)?.slug === city.slug,
    );
  } else {
    const count = entry.pastNights + entry.upcomingNights;
    const names = entry.cities.map((item) => item.city.name);
    const shown = names.slice(0, 2);
    where = [
      `${count} ${gigsWord(count)}`,
      shown.length
        ? `${shown.join(", ")}${names.length > shown.length ? ` +${names.length - shown.length}` : ""}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const upcoming = (event: Event) => {
    const venue = places.venues.get(event.venueId);
    return Boolean(venue && isUpcoming(event, now, venue.timezone));
  };
  const next = nights.find(upcoming) ?? null;
  const last = next
    ? null
    : ([...nights].reverse().find((event) => !upcoming(event)) ?? null);
  const event = next ?? last;
  const venue = event ? places.venues.get(event.venueId) : undefined;
  let when: string | null = null;
  if (event && venue) {
    const date = dateChipLabel(
      localDate(event.startsAt, venue.timezone),
      today,
      locale,
    );
    const place = city ? "" : places.cityOfVenue.get(venue.id)?.name;
    const label = next
      ? copy(locale, "Nächster Gig", "Next gig")
      : copy(locale, "Zuletzt", "Last gig");
    when = `${label} ${date}${place ? ` · ${place}` : ""}`;
  }
  return {
    entry,
    where,
    when,
    sound: rowGenres(entry, focus)
      .map((genre) => genre.name)
      .join(" · "),
  };
}

/** The first `limit` entries; the rest are counted for the "more" link. */
export function windowedEntries<T>(
  items: readonly T[],
  limit: number,
): { shown: T[]; rest: number } {
  return {
    shown: items.slice(0, limit),
    rest: Math.max(0, items.length - limit),
  };
}

/** Sibling genres of a family with DJ counts for the other filters. */
export function familyGenreCounts(
  entries: readonly DirectoryEntry[],
  family: GenreFamilySlug,
  city: City | null,
): Count<CanonicalGenre>[] {
  return directoryFacets(entries, { family, city }).genres.filter(
    ({ item }) => item.family === family,
  );
}

export function familyName(slug: GenreFamilySlug, locale: Locale): string {
  return genreFamilyBySlug(slug)?.label[locale] ?? slug;
}

/** Locale-formatted count: "2.681" / "2,681". */
export function formatCount(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "de-DE").format(
    value,
  );
}

function list(items: readonly string[], locale: Locale) {
  return new Intl.ListFormat(locale === "en" ? "en-GB" : "de-DE", {
    type: "conjunction",
  }).format(items);
}

/** "Hard-Techno-DJs" / "Hard Techno DJs"; the index is "Techno-DJs". */
export function djsTitle(subject: string, locale: Locale): string {
  return compound(subject, "DJs", locale);
}

/** Factual description of the directory or a filtered view of it. */
export function directoryDescription(
  entries: readonly DirectoryEntry[],
  cities: readonly Count<City>[],
  locale: Locale,
  subject = "Techno",
  city: City | null = null,
): string {
  const listenable = entries.filter((entry) => entry.dj.soundcloudUrl).length;
  if (!entries.length)
    return copy(
      locale,
      `Auf EVRYVIBE sind noch keine ${djsTitle(subject, locale)} mit Gigs${city ? ` in ${city.name}` : ""} veröffentlicht.`,
      `No ${djsTitle(subject, locale)} with gigs${city ? ` in ${city.name}` : ""} are published on EVRYVIBE yet.`,
    );
  const top = cities.slice(0, 3).map(({ item }) => item.name);
  const where = city
    ? copy(locale, ` mit Gigs in ${city.name}`, ` with gigs in ${city.name}`)
    : top.length
      ? copy(
          locale,
          ` mit Gigs in ${list([...top, ...(cities.length > 3 ? ["weiteren Städten"] : [])], locale)}`,
          ` with gigs in ${list([...top, ...(cities.length > 3 ? ["more cities"] : [])], locale)}`,
        )
      : "";
  const count = formatCount(entries.length, locale);
  const heard = formatCount(listenable, locale);
  return copy(
    locale,
    `${count} ${djsTitle(subject, locale)}${where}. ${listenable ? `${heard} davon direkt auf SoundCloud anhören, nach` : "Nach"} Sound und Stadt filtern und die nächsten Partys finden.`,
    `${count} ${djsTitle(subject, locale)}${where}. ${listenable ? `Listen to ${heard} of them straight from SoundCloud, filter` : "Filter"} by sound and city and find their next parties.`,
  );
}
