// Home discovery filters: URL parsing, venue-local date windows, sound
// families and facet counts. Pure and server-side; the page renders links.
import { z } from "zod";
import {
  catalogCities,
  citySlug,
  isScheduled,
  isUpcoming,
} from "@/core/cities";
import { localizePath, type Locale } from "@/core/i18n";
import type { Catalog, Event, Venue } from "@/core/model";
import {
  canonicalGenre,
  canonicalGenresOf,
  genreFamilies,
  genreFamilyBySlug,
  isGenreFamilySlug,
  type CanonicalGenre,
  type GenreFamilySlug,
} from "@/core/genres";

export const whenValues = ["today", "tomorrow", "weekend", "week"] as const;
export type When = (typeof whenValues)[number];

export type HomeFilters = {
  q: string;
  when: When | null;
  // ISO local date; when set it replaces `when`.
  date: string;
  // City slug (`citySlug`), so "Köln", "koeln" and "Koeln" are one filter.
  city: string;
  // Genre family (`genreFamilies`): the Sound chip row.
  sound: GenreFamilySlug | null;
  // Canonical genre name (`canonicalGenres`); a refinement inside a sound.
  genre: string;
  // How many listings to show before the "more" link; null is the default.
  limit: number | null;
};

export const pageSize = 60;
const maxLimit = 2000;

const fields = {
  // Long searches are cut, not rejected.
  q: z
    .string()
    .trim()
    .transform((value) => value.slice(0, 200).trim()),
  when: z.enum(whenValues),
  date: z.iso.date(),
  city: z.string().trim().max(100),
  sound: z.string().trim().max(100),
  genre: z.string().trim().max(100),
  // Any number is brought into range; only non-numbers are ignored.
  limit: z.coerce
    .number()
    .refine(Number.isFinite)
    .transform((value) => Math.min(maxLimit, Math.max(1, Math.round(value)))),
};

export type FilterKey = keyof typeof fields;

export const emptyFilters: HomeFilters = {
  q: "",
  when: null,
  date: "",
  city: "",
  sound: null,
  genre: "",
  limit: null,
};

// Each parameter is parsed on its own: a malformed one is dropped and named
// in `ignored` while the others keep working.
export function parseHomeFilters(
  params: Record<string, string | string[] | undefined>,
): { filters: HomeFilters; ignored: FilterKey[] } {
  const ignored: FilterKey[] = [];
  function read<T>(key: FilterKey, schema: z.ZodType<T>): T | null {
    const raw = params[key];
    if (raw === undefined || raw === "") return null;
    // A repeated parameter is ambiguous, so it is treated as malformed.
    const parsed = Array.isArray(raw) ? null : schema.safeParse(raw);
    if (!parsed?.success) {
      ignored.push(key);
      return null;
    }
    return parsed.data;
  }
  const date = read("date", fields.date) ?? "";
  const rawCity = read("city", fields.city) ?? "";
  const city = rawCity ? citySlug(rawCity) : "";
  if (city === null) ignored.push("city");
  const rawSound = read("sound", fields.sound);
  const sound = rawSound ? resolveSound(rawSound) : null;
  if (rawSound && !sound) ignored.push("sound");
  const rawGenre = read("genre", fields.genre);
  // Any spelling of a genre is accepted and canonicalised, so shared links
  // with an alias or older spelling keep working.
  const genre = rawGenre ? canonicalGenre(rawGenre) : null;
  if (rawGenre && !genre) ignored.push("genre");
  return {
    filters: {
      q: read("q", fields.q) ?? "",
      date,
      when: date ? null : read("when", fields.when),
      city: city ?? "",
      // A genre names its own family, so the two can never disagree.
      sound: genre ? genre.family : (sound?.family ?? null),
      genre: genre?.name ?? sound?.genre?.name ?? "",
      limit: read("limit", fields.limit),
    },
    ignored,
  };
}

// Sound slugs of the earlier nine-family chip row, mapped to the closest
// family or genre: old shared links keep working.
const legacySounds: Record<
  string,
  { family: GenreFamilySlug; genre?: string }
> = {
  techno: { family: "techno" },
  hard: { family: "hard-techno" },
  acid: { family: "techno", genre: "Acid Techno" },
  dub: { family: "techno", genre: "Dub Techno" },
  house: { family: "house" },
  electro: { family: "electro-wave" },
  breaks: { family: "bass" },
  trance: { family: "trance" },
  ambient: { family: "ambient" },
};

function resolveSound(
  value: string,
): { family: GenreFamilySlug; genre?: CanonicalGenre } | null {
  const slug = value.toLowerCase();
  if (isGenreFamilySlug(slug)) return { family: slug };
  const legacy = Object.hasOwn(legacySounds, slug) ? legacySounds[slug] : null;
  if (!legacy) return null;
  const genre = legacy.genre ? canonicalGenre(legacy.genre) : null;
  return { family: legacy.family, ...(genre ? { genre } : {}) };
}

export function filterLabel(key: FilterKey, locale: Locale): string {
  const de = locale === "de";
  switch (key) {
    case "q":
      return de ? "Suche" : "search";
    case "when":
      return de ? "Wann" : "when";
    case "date":
      return de ? "Datum" : "date";
    case "city":
      return de ? "Stadt" : "city";
    case "sound":
      return "Sound";
    case "genre":
      return "Genre";
    case "limit":
      return de ? "Anzahl" : "number of nights";
  }
}

export function isFiltered(filters: HomeFilters) {
  return Boolean(
    filters.q ||
    filters.when ||
    filters.date ||
    filters.city ||
    filters.sound ||
    filters.genre,
  );
}

// Builds a home URL from the current filters with some values changed.
// Any filter change starts the listing from the top again.
export function homeHref(
  locale: Locale,
  filters: HomeFilters,
  change: Partial<HomeFilters> = {},
): string {
  const next = { ...filters, limit: null, ...change };
  const query = new URLSearchParams();
  if (next.q) query.set("q", next.q);
  if (next.date) query.set("date", next.date);
  else if (next.when) query.set("when", next.when);
  if (next.city) query.set("city", next.city);
  if (next.sound) query.set("sound", next.sound);
  if (next.genre) query.set("genre", next.genre);
  if (next.limit) query.set("limit", String(next.limit));
  const search = query.toString();
  return `${localizePath("/", locale)}${search ? `?${search}` : ""}`;
}

/* ----------------------------------------------------------- sounds */

export function soundLabel(family: GenreFamilySlug, locale: Locale): string {
  return genreFamilyBySlug(family)?.label[locale] ?? family;
}

export function eventFamilies(
  event: Pick<Event, "genres">,
): Set<GenreFamilySlug> {
  return new Set(canonicalGenresOf(event.genres).map((genre) => genre.family));
}

/* ------------------------------------------------------------ dates */

export function localDate(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// Calendar arithmetic on YYYY-MM-DD strings, independent of the server zone.
export function addDays(date: string, days: number) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function weekday(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

type Window = { from: string; to: string };

// Days covered by a quick pick, seen from `today` at one venue. The weekend
// is Friday to Sunday; from Friday on it is the current one.
export function whenWindow(when: When, today: string): Window {
  switch (when) {
    case "today":
      return { from: today, to: today };
    case "tomorrow": {
      const tomorrow = addDays(today, 1);
      return { from: tomorrow, to: tomorrow };
    }
    case "week":
      return { from: today, to: addDays(today, 6) };
    case "weekend": {
      const day = weekday(today);
      if (day === 5) return { from: today, to: addDays(today, 2) };
      if (day === 6) return { from: today, to: addDays(today, 1) };
      if (day === 0) return { from: today, to: today };
      const friday = addDays(today, 5 - day);
      return { from: friday, to: addDays(friday, 2) };
    }
  }
}

/* ---------------------------------------------------------- listing */

// One upcoming listing with everything the filters need, computed once.
export type Listing = {
  event: Event;
  venue: Venue;
  city: string;
  start: string; // venue-local start date
  today: string; // venue-local date of the request
  running: boolean; // started before the request and still on
  // Families and canonical genres of the event's genre tags.
  families: Set<GenreFamilySlug>;
  genres: CanonicalGenre[];
  text: string;
};

export function upcomingListings(catalog: Catalog, now: number): Listing[] {
  const venues = new Map(catalog.venues.map((venue) => [venue.id, venue]));
  const djs = new Map(catalog.djs.map((dj) => [dj.id, dj.name]));
  const nowIso = new Date(now).toISOString();
  const todays = new Map<string, string>();
  return [...catalog.events]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .flatMap((event) => {
      const venue = venues.get(event.venueId);
      if (!venue || !isUpcoming(event, now, venue.timezone)) return [];
      let today = todays.get(venue.timezone);
      if (!today) {
        today = localDate(nowIso, venue.timezone);
        todays.set(venue.timezone, today);
      }
      const start = localDate(event.startsAt, venue.timezone);
      return [
        {
          event,
          venue,
          city: citySlug(venue.city) ?? "",
          start,
          today,
          running: Boolean(event.endsAt) && start < today,
          families: eventFamilies(event),
          genres: canonicalGenresOf(event.genres),
          text: [
            event.title,
            event.description,
            event.translations?.en?.title ?? "",
            event.translations?.en?.description ?? "",
            venue.name,
            venue.city,
            ...event.genres,
            ...event.djIds.map((id) => djs.get(id) ?? ""),
          ]
            .join(" ")
            .toLowerCase(),
        },
      ];
    });
}

// A listing falls in a window when it starts on one of its days, or when it
// is still running and the window includes today.
function inWindow(listing: Listing, window: Window) {
  if (listing.start >= window.from && listing.start <= window.to) return true;
  return (
    listing.start < listing.today &&
    window.from <= listing.today &&
    listing.today <= window.to
  );
}

export function matchesWhen(
  listing: Listing,
  when: When | null,
  date: string,
): boolean {
  if (date) return inWindow(listing, { from: date, to: date });
  if (when) return inWindow(listing, whenWindow(when, listing.today));
  return true;
}

// Whether the event carries a genre, in any spelling of it.
export const hasGenre = (event: Pick<Event, "genres">, genre: string) => {
  const wanted = canonicalGenre(genre);
  return (
    !!wanted &&
    canonicalGenresOf(event.genres).some((name) => name.slug === wanted.slug)
  );
};

type Dimension = "q" | "when" | "city" | "sound" | "genre";

function matcher(filters: HomeFilters) {
  const q = filters.q.toLowerCase();
  const checks: Record<Dimension, (listing: Listing) => boolean> = {
    q: (listing) => !q || listing.text.includes(q),
    when: (listing) => matchesWhen(listing, filters.when, filters.date),
    city: (listing) => !filters.city || listing.city === filters.city,
    sound: (listing) => !filters.sound || listing.families.has(filters.sound),
    genre: (listing) =>
      !filters.genre || hasGenre(listing.event, filters.genre),
  };
  // Every filter except the ones named: the base for a facet's counts.
  return (listing: Listing, ...skip: Dimension[]) =>
    (Object.keys(checks) as Dimension[]).every(
      (dimension) => skip.includes(dimension) || checks[dimension](listing),
    );
}

export type Facet<T> = { value: T; label: string; count: number };

export type HomeView = {
  results: Listing[];
  // Scheduled nights among the results and in the whole upcoming programme.
  shown: number;
  total: number;
  when: Facet<When>[];
  days: Facet<string>[];
  cities: Facet<string>[];
  sounds: Facet<GenreFamilySlug>[];
  genres: Facet<string>[];
  cityName: string | null;
};

export function whenLabel(when: When, locale: Locale): string {
  const de = locale === "de";
  switch (when) {
    case "today":
      return de ? "Heute" : "Today";
    case "tomorrow":
      return de ? "Morgen" : "Tomorrow";
    case "weekend":
      return de ? "Wochenende" : "Weekend";
    case "week":
      return de ? "7 Tage" : "7 days";
  }
}

export function dayLabel(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T12:00:00Z`));
}

function counted<T>(
  listings: Listing[],
  key: (listing: Listing) => Iterable<T>,
): Map<T, number> {
  const counts = new Map<T, number>();
  for (const listing of listings) {
    if (!isScheduled(listing.event)) continue;
    for (const value of new Set(key(listing)))
      counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export function homeView(
  listings: Listing[],
  catalog: Catalog,
  filters: HomeFilters,
  locale: Locale,
): HomeView {
  const matches = matcher(filters);
  const results = listings.filter((listing) => matches(listing));
  const scheduled = (items: Listing[]) =>
    items.filter((listing) => isScheduled(listing.event)).length;

  const forWhen = listings.filter((listing) => matches(listing, "when"));
  const when = whenValues.map((value) => ({
    value,
    label: whenLabel(value, locale),
    count: scheduled(
      forWhen.filter((listing) => matchesWhen(listing, value, "")),
    ),
  }));
  // The next fortnight of dates that have something on, for the date picker.
  const dayCounts = counted(
    forWhen.filter((listing) => listing.start >= listing.today),
    (listing) => [listing.start],
  );
  const days = [...dayCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 14)
    .map(([value, count]) => ({
      value,
      label: dayLabel(value, locale),
      count,
    }));

  const cityCounts = counted(
    listings.filter((listing) => matches(listing, "city")),
    (listing) => [listing.city],
  );
  const known = catalogCities(catalog.venues);
  const cities = known
    .map((city) => ({
      value: city.slug,
      label: city.name,
      count: cityCounts.get(city.slug) ?? 0,
    }))
    .filter((city) => city.count > 0 || city.value === filters.city)
    .sort(
      (a, b) =>
        Number(b.value === filters.city) - Number(a.value === filters.city) ||
        b.count - a.count ||
        a.label.localeCompare(b.label, "de"),
    );

  const soundCounts = counted(
    listings.filter((listing) => matches(listing, "sound", "genre")),
    (listing) => listing.families,
  );
  const sounds = genreFamilies
    .map((family) => ({
      value: family.slug,
      label: family.label[locale],
      count: soundCounts.get(family.slug) ?? 0,
    }))
    .filter((sound) => sound.count > 0 || sound.value === filters.sound);

  // The canonical genres of the chosen family, most frequent first.
  const genres: Facet<string>[] = [];
  if (filters.sound) {
    const sound = filters.sound;
    const genreCounts = counted(
      listings.filter((listing) => matches(listing, "genre")),
      (listing) =>
        listing.genres
          .filter((genre) => genre.family === sound)
          .map((genre) => genre.name),
    );
    for (const [name, count] of genreCounts)
      genres.push({ value: name, label: name, count });
    genres.sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, "de"),
    );
    if (filters.genre && !genres.some((genre) => genre.value === filters.genre))
      genres.unshift({ value: filters.genre, label: filters.genre, count: 0 });
  }

  return {
    results,
    shown: scheduled(results),
    total: scheduled(listings),
    when,
    days,
    cities,
    sounds,
    genres,
    cityName: known.find((city) => city.slug === filters.city)?.name ?? null,
  };
}

// Shows whole days: the window ends after the day that reaches the limit.
export function windowed(
  results: Listing[],
  limit: number,
): { shown: Listing[]; rest: Listing[] } {
  if (results.length <= limit) return { shown: results, rest: [] };
  const day = results[limit - 1]?.start;
  let end = limit;
  while (end < results.length && results[end]?.start === day) end += 1;
  return { shown: results.slice(0, end), rest: results.slice(end) };
}

// The earliest venue-local "today" in the programme: a chosen date before it
// lies in the past everywhere.
export function earliestToday(listings: Listing[], now: number): string {
  return listings.reduce(
    (earliest, listing) =>
      listing.today < earliest ? listing.today : earliest,
    new Date(now).toISOString().slice(0, 10),
  );
}

// A chosen date names its year when it is not this year.
export function dateChipLabel(
  date: string,
  today: string,
  locale: Locale,
): string {
  return date.slice(0, 4) === today.slice(0, 4)
    ? dayLabel(date, locale)
    : new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", {
        timeZone: "UTC",
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(`${date}T12:00:00Z`));
}
