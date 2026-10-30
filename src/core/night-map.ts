import { isScheduled } from "./cities";
import { normalizeGenres } from "./genres";
import { locationFor } from "./locations";
import type { Dj, Event, Venue } from "./model";
import { soundcloudProfileSchema } from "./soundcloud";

// The night map plots where upcoming nights happen. A venue with confirmed
// coordinates is a point at the club; any other venue falls back to its
// city's GeoNames centre and is marked as approximate. A venue with neither
// stays off the map: an unknown location is never guessed.

export type MapPrecision = "venue" | "city";

export type MapPosition = {
  /** Stable key shared by every night at this point. */
  key: string;
  precision: MapPrecision;
  latitude: number;
  longitude: number;
  /** The venue for a venue point, the city for an approximate one. */
  name: string;
  /** Where the position comes from (OSM object or GeoNames record). */
  sourceUrl: string | null;
};

/** Where a venue goes on the map, or null when no position is known. */
export function venuePosition(
  venue: Pick<
    Venue,
    | "slug"
    | "name"
    | "city"
    | "country"
    | "latitude"
    | "longitude"
    | "locationSourceUrl"
  >,
): MapPosition | null {
  const { latitude, longitude } = venue;
  // 0,0 is the classic "no value" artefact, never a club in the Atlantic.
  if (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    !(latitude === 0 && longitude === 0)
  )
    return {
      key: `venue:${venue.slug}`,
      precision: "venue",
      latitude,
      longitude,
      name: venue.name,
      sourceUrl: venue.locationSourceUrl ?? null,
    };
  const centre = locationFor(venue.city, venue.country);
  return centre
    ? {
        key: `city:${centre.id}`,
        precision: "city",
        latitude: centre.latitude,
        longitude: centre.longitude,
        name: centre.name,
        sourceUrl: centre.sourceUrl,
      }
    : null;
}

export type MapPlace = MapPosition & {
  /** Event ids at this point, soonest first. */
  eventIds: string[];
  /** Venue names at this point (several for an approximate city point). */
  venues: string[];
};

/**
 * Groups scheduled events into map points. Cancelled listings are left out:
 * they never count as a night. `unmapped` names the venues (with their city)
 * whose nights cannot be placed, so the page can say so instead of hiding them.
 */
export function mapPlaces(items: readonly { event: Event; venue: Venue }[]): {
  places: MapPlace[];
  unmapped: string[];
  unmappedNights: number;
} {
  const places = new Map<string, MapPlace>();
  const unmapped = new Set<string>();
  let unmappedNights = 0;
  const sorted = [...items]
    .filter((item) => isScheduled(item.event))
    .sort(
      (a, b) =>
        Date.parse(a.event.startsAt) - Date.parse(b.event.startsAt) ||
        a.event.slug.localeCompare(b.event.slug, "en"),
    );
  for (const { event, venue } of sorted) {
    const position = venuePosition(venue);
    if (!position) {
      unmapped.add(`${venue.name} (${venue.city})`);
      unmappedNights += 1;
      continue;
    }
    const place = places.get(position.key) ?? {
      ...position,
      eventIds: [],
      venues: [],
    };
    place.eventIds.push(event.id);
    if (!place.venues.includes(venue.name)) place.venues.push(venue.name);
    places.set(position.key, place);
  }
  return {
    places: [...places.values()],
    unmapped: [...unmapped].sort((a, b) => a.localeCompare(b, "de")),
    unmappedNights,
  };
}

export type ListenDj = {
  id: string;
  slug: string;
  name: string;
  soundcloudUrl: string;
  /** Canonical genres: the DJ profile's, else the night's. */
  genres: string[];
};

/** Lineup DJs with a verified SoundCloud profile, in billing order. */
export function listenableLineup(
  event: Pick<Event, "djIds" | "genres">,
  djs: ReadonlyMap<string, Dj>,
): ListenDj[] {
  return [...new Set(event.djIds)].flatMap((id) => {
    const dj = djs.get(id);
    const profile = soundcloudProfileSchema.safeParse(dj?.soundcloudUrl);
    if (!dj || !profile.success) return [];
    const own = normalizeGenres(dj.genres).genres;
    return [
      {
        id: dj.id,
        slug: dj.slug,
        name: dj.name,
        soundcloudUrl: profile.data,
        genres: own.length ? own : normalizeGenres(event.genres).genres,
      },
    ];
  });
}
