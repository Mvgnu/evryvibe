import type { Catalog, Event, Venue } from "./model";

// Cities are derived from venue records; there is no separate city table.
export type City = {
  slug: string;
  name: string;
  country: string;
  timezone: string;
  venueIds: string[];
};

const transliterations: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
  æ: "ae",
  ø: "oe",
  å: "aa",
};

// Returns null when a name has no Latin letters or digits to build a URL from.
export function citySlug(name: string): string | null {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[äöüßæøå]/g, (character) => transliterations[character] ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug || null;
}

export function cityPath(name: string): string | null {
  const slug = citySlug(name);
  return slug ? `/cities/${slug}` : null;
}

function mostCommon(first: string, rest: string[]): string {
  const counts = new Map<string, number>();
  for (const value of [first, ...rest])
    counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = first;
  for (const [value, count] of counts) {
    const bestCount = counts.get(best) ?? 0;
    if (count > bestCount || (count === bestCount && value < best))
      best = value;
  }
  return best;
}

// Spellings that share a slug ("Köln", "Koeln") form one city named by the
// most common spelling.
export function catalogCities(venues: Venue[]): City[] {
  const groups = new Map<string, [Venue, ...Venue[]]>();
  for (const venue of venues) {
    const slug = citySlug(venue.city);
    if (!slug) continue;
    const group = groups.get(slug);
    if (group) group.push(venue);
    else groups.set(slug, [venue]);
  }
  return [...groups.entries()]
    .map(([slug, [head, ...tail]]) => ({
      slug,
      name: mostCommon(
        head.city,
        tail.map((venue) => venue.city),
      ),
      country: mostCommon(
        head.country,
        tail.map((venue) => venue.country),
      ),
      timezone: mostCommon(
        head.timezone,
        tail.map((venue) => venue.timezone),
      ),
      venueIds: [head, ...tail].map((venue) => venue.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export function findCity(venues: Venue[], slug: string): City | undefined {
  return catalogCities(venues).find((city) => city.slug === slug);
}

// A cancelled listing stays visible but is never counted as a night.
export function isScheduled(event: Event): boolean {
  return event.status !== "cancelled";
}

const lifecycleFormats = new Map<string, Intl.DateTimeFormat>();

// The fallback is a visibility policy, never evidence that a night is running.
export function isUpcoming(
  event: Pick<Event, "startsAt" | "endsAt">,
  now: number,
  timezone: string,
): boolean {
  if (event.endsAt) return now < Date.parse(event.endsAt);
  let format = lifecycleFormats.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    lifecycleFormats.set(timezone, format);
  }
  const parts = (instant: number) => {
    const values = new Map(
      format?.formatToParts(instant).map((p) => [p.type, p.value]),
    );
    return {
      date: `${values.get("year")}-${values.get("month")}-${values.get("day")}`,
      hour: Number(values.get("hour")),
    };
  };
  const start = parts(Date.parse(event.startsAt));
  const nextDay = new Date(`${start.date}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const cutoffDate = nextDay.toISOString().slice(0, 10);
  const current = parts(now);
  return (
    current.date < cutoffDate ||
    (current.date === cutoffDate && current.hour < 9)
  );
}

export function cityEvents(
  catalog: Pick<Catalog, "events" | "venues">,
  city: City,
  now: number,
): Event[] {
  const venueIds = new Set(city.venueIds);
  return catalog.events
    .filter(
      (event) =>
        venueIds.has(event.venueId) &&
        catalog.venues.some(
          (venue) =>
            venue.id === event.venueId &&
            isUpcoming(event, now, venue.timezone),
        ),
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

// Upcoming nights that still take place. Cancelled listings stay visible on
// city pages but never count towards what's on, indexing or the sitemap.
export function cityNights(
  catalog: Pick<Catalog, "events" | "venues">,
  city: City,
  now: number,
): Event[] {
  return cityEvents(catalog, city, now).filter(isScheduled);
}
