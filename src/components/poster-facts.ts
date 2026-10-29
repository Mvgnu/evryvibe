// Server-side poster facts. Dates are formatted here, in the venue timezone,
// and handed to the (possibly client-rendered) poster as plain strings so
// Node and browser ICU differences cannot cause a hydration mismatch.
import type { Locale } from "@/core/i18n";
import type { Dj, Event, Venue } from "@/core/model";
import { isScheduled } from "@/core/cities";
import { posterSeed, soundFamily, type SoundFamily } from "@/core/sound";

export type PosterWhen = {
  day: string; // "07"
  weekday: string; // "SA" / "SAT"
  month: string; // "OKT" / "OCT"
  dateLabel: string; // "SA 07 OKT"
  timeLabel: string; // "23:00" or "23:00–08:00"
};

export type PosterFacts = {
  title: string;
  genres: string[];
  family: SoundFamily;
  seed: number;
  lineup: string[];
  venue: string | null;
  city: string | null;
  // Null only when no venue timezone is known; the poster then shows no date.
  when: PosterWhen | null;
  cancelled: boolean;
  locale: Locale;
};

export type VenuePosterFacts = {
  name: string;
  city: string;
  country: string;
  address: string;
  seed: number;
  family: SoundFamily;
  // Genre names as written on the upcoming nights, most frequent first.
  genres: { name: string; family: SoundFamily }[];
  upcoming: number;
  locale: Locale;
};

export type DjPosterFacts = {
  name: string;
  genres: string[];
  seed: number;
  family: SoundFamily;
  upcoming: number;
  locale: Locale;
};

function part(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((entry) => entry.type === type)?.value ?? "";
}

function clean(value: string): string {
  return value.replace(/\./g, "").trim().toUpperCase();
}

export function posterWhen(
  event: Pick<Event, "startsAt" | "endsAt">,
  timezone: string,
  locale: Locale,
): PosterWhen {
  const start = new Date(event.startsAt);
  const parts = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).formatToParts(start);
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const day = part(parts, "day");
  const weekday = clean(part(parts, "weekday")).slice(
    0,
    locale === "en" ? 3 : 2,
  );
  const month = clean(part(parts, "month")).slice(0, 3);
  const startTime = clock.format(start);
  const timeLabel = event.endsAt
    ? `${startTime}–${clock.format(new Date(event.endsAt))}`
    : startTime;
  return {
    day,
    weekday,
    month,
    dateLabel: `${weekday} ${day} ${month}`,
    timeLabel,
  };
}

export function posterFacts(
  event: Event,
  venue: Venue | null,
  lineupNames: readonly string[],
  locale: Locale,
): PosterFacts {
  return {
    title: event.title,
    genres: [...event.genres],
    family: soundFamily(event.genres),
    seed: posterSeed(event.slug),
    lineup: [...lineupNames],
    venue: venue?.name ?? null,
    city: venue?.city ?? null,
    when: venue ? posterWhen(event, venue.timezone, locale) : null,
    cancelled: event.status === "cancelled",
    locale,
  };
}

// Lineup names in the order the event lists them; unknown DJ ids are skipped.
export function lineupNames(event: Event, djs: readonly Dj[]): string[] {
  const byId = new Map(djs.map((dj) => [dj.id, dj.name]));
  return [
    ...event.djIds.flatMap((id) => {
      const name = byId.get(id);
      return name ? [name] : [];
    }),
    ...(event.unlinkedArtists ?? []),
  ];
}

// "Upcoming nights" are upcoming and not cancelled. Callers pass upcoming
// events; cancelled ones are dropped here so every count agrees.
const scheduled = (events: readonly Event[]) => events.filter(isScheduled);

export function venuePosterFacts(
  venue: Venue,
  upcomingEvents: readonly Event[],
  locale: Locale,
): VenuePosterFacts {
  const nights = scheduled(upcomingEvents);
  const familyCounts = new Map<SoundFamily, number>();
  const genreCounts = new Map<string, { name: string; count: number }>();
  for (const event of nights) {
    const family = soundFamily(event.genres);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    for (const genre of event.genres) {
      const key = genre.trim().toLowerCase();
      const entry = genreCounts.get(key);
      if (entry) entry.count += 1;
      else genreCounts.set(key, { name: genre.trim(), count: 1 });
    }
  }
  const [family] = [...familyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
  // Map order keeps first appearance, so ties stay in listing order.
  const genres = [...genreCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(({ name }) => ({ name, family: soundFamily([name]) }));
  return {
    name: venue.name,
    city: venue.city,
    country: venue.country,
    address: venue.address,
    seed: posterSeed(venue.slug),
    family: family ?? "techno",
    genres,
    upcoming: nights.length,
    locale,
  };
}

export function djPosterFacts(
  dj: Dj,
  upcomingEvents: readonly Event[],
  locale: Locale,
): DjPosterFacts {
  return {
    name: dj.name,
    genres: [...dj.genres],
    seed: posterSeed(dj.slug),
    family: soundFamily(dj.genres),
    upcoming: scheduled(upcomingEvents).length,
    locale,
  };
}
