import { copy, translatedEvent } from "@/components/catalog-ui";
import {
  addDays,
  dayLabel,
  type Listing,
} from "@/components/discovery-filters";
import {
  lineupNames,
  posterFacts,
  type PosterFacts,
} from "@/components/poster-facts";
import type { Locale } from "@/core/i18n";
import type { Catalog, Dj, Event } from "@/core/model";
import {
  listenableLineup,
  mapPlaces,
  venuePosition,
  type ListenDj,
  type MapPlace,
  type MapPrecision,
} from "@/core/night-map";

// What the night map needs from the server, formatted once in the venue's
// timezone so the browser never has to read the clock or guess a zone.

export type MapNight = {
  id: string;
  slug: string;
  title: string;
  /** "Heute · 23:00", "Sa., 1. Nov. · 23:00". */
  when: string;
  startsAt: string;
  /** Starts today (venue-local) or started yesterday and is still on. */
  tonight: boolean;
  venue: string;
  city: string;
  /** Map point key; null when the venue has no known position. */
  place: string | null;
  precision: MapPrecision | null;
  lineup: string[];
  genres: string[];
  djIds: string[];
  ticketUrl: string | null;
  listen: ListenDj[];
  artists: Pick<Dj, "id" | "slug" | "name" | "soundcloudUrl" | "instagramUrl">[];
  artwork: { event: Event; poster: PosterFacts };
};

export type NightMapData = {
  nights: MapNight[];
  places: MapPlace[];
  unmapped: string[];
  unmappedNights: number;
};

function startLabel(listing: Listing, locale: Locale): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: listing.venue.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(listing.event.startsAt));
  const day =
    listing.start === listing.today
      ? copy(locale, "Heute", "Today")
      : listing.start === addDays(listing.today, 1)
        ? copy(locale, "Morgen", "Tomorrow")
        : listing.start < listing.today
          ? copy(locale, "Beginn gestern", "Started yesterday")
          : dayLabel(listing.start, locale);
  return `${day} · ${time}`;
}

/** Scheduled nights of the current filter result, ready for the map. */
export function nightMapData(
  listings: readonly Listing[],
  catalog: Catalog,
  locale: Locale,
): NightMapData {
  const djs = new Map(catalog.djs.map((dj) => [dj.id, dj]));
  const scheduled = listings.filter(
    (listing) => listing.event.status !== "cancelled",
  );
  const { places, unmapped, unmappedNights } = mapPlaces(scheduled);
  const nights = scheduled.map((listing): MapNight => {
    const event = translatedEvent(listing.event, locale);
    const names = lineupNames(event, catalog.djs);
    const position = venuePosition(listing.venue);
    return {
      id: event.id,
      slug: event.slug,
      title: event.title,
      when: startLabel(listing, locale),
      startsAt: event.startsAt,
      tonight: listing.start <= listing.today,
      venue: listing.venue.name,
      city: listing.venue.city,
      place: position?.key ?? null,
      precision: position?.precision ?? null,
      lineup: names,
      genres: listing.genres.map((genre) => genre.name),
      djIds: event.djIds,
      ticketUrl: event.ticketUrl,
      listen: listenableLineup(event, djs),
      artists: [...new Set(event.djIds)].flatMap(id => { const dj=djs.get(id); return dj ? [{id:dj.id,slug:dj.slug,name:dj.name,soundcloudUrl:dj.soundcloudUrl,instagramUrl:dj.instagramUrl}] : []; }),
      artwork: {
        // The card needs the cover facts, not the long description.
        event: { ...event, description: "", translations: undefined },
        poster: posterFacts(event, listing.venue, names, locale),
      },
    };
  });
  return { nights, places, unmapped, unmappedNights };
}
