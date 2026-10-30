import { describe, expect, it } from "vitest";
import type { Dj, Event, Venue } from "../src/core/model";
import {
  listenableLineup,
  mapPlaces,
  venuePosition,
} from "../src/core/night-map";
import { contrastRatio, nightColors } from "../src/lib/map-themes";
import { demoCatalog } from "../src/db/demo";

const baseVenue = demoCatalog.venues[0];
const baseDj = demoCatalog.djs[0];
const baseEvent = demoCatalog.events[0];
if (!baseVenue || !baseDj || !baseEvent)
  throw new Error("Demo catalog needs a venue, DJ and event");

const uuid = (kind: number, n: number) =>
  `${kind}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const venue = (n: number, city: string, over: Partial<Venue> = {}): Venue => ({
  ...baseVenue,
  id: uuid(1, n),
  slug: `venue-${n}`,
  name: `Venue ${n}`,
  city,
  country: "Deutschland",
  latitude: null,
  longitude: null,
  locationSourceUrl: null,
  ...over,
});
const event = (
  n: number,
  where: Venue,
  day: number,
  over: Partial<Event> = {},
): { event: Event; venue: Venue } => ({
  venue: where,
  event: {
    ...baseEvent,
    id: uuid(3, n),
    slug: `night-${n}`,
    venueId: where.id,
    startsAt: `2026-11-${String(day).padStart(2, "0")}T22:00:00.000Z`,
    endsAt: null,
    status: "scheduled",
    ...over,
  },
});

const club = venue(1, "Köln", {
  latitude: 50.9513194,
  longitude: 6.9837508,
  locationSourceUrl: "https://www.openstreetmap.org/node/6551673916",
});
const koelnA = venue(2, "Köln");
const koelnB = venue(3, "Koeln");
const atlantis = venue(4, "Atlantis");

describe("venuePosition", () => {
  it("plots a venue with confirmed coordinates at the venue", () => {
    expect(venuePosition(club)).toEqual({
      key: "venue:venue-1",
      precision: "venue",
      latitude: 50.9513194,
      longitude: 6.9837508,
      name: "Venue 1",
      sourceUrl: "https://www.openstreetmap.org/node/6551673916",
    });
  });

  it("falls back to the GeoNames city centre and says it is approximate", () => {
    const position = venuePosition(koelnA);
    expect(position?.precision).toBe("city");
    expect(position?.key).toBe("city:de:koeln");
    expect(position?.name).toBe("Köln");
    expect(position?.sourceUrl).toMatch(/^https:\/\/www\.geonames\.org\//);
    // Another spelling of the same city shares the point.
    expect(venuePosition(koelnB)?.key).toBe(position?.key);
  });

  it("never guesses: unknown cities and 0,0 artefacts stay off the map", () => {
    expect(venuePosition(atlantis)).toBeNull();
    expect(
      venuePosition(venue(5, "Atlantis", { latitude: 0, longitude: 0 })),
    ).toBeNull();
    // Half a coordinate is no coordinate: the city centre is used instead.
    expect(
      venuePosition(venue(6, "Berlin", { latitude: 52.5, longitude: null }))
        ?.precision,
    ).toBe("city");
  });
});

describe("mapPlaces", () => {
  it("groups scheduled nights per point, soonest first, and names what cannot be placed", () => {
    const { places, unmapped, unmappedNights } = mapPlaces([
      event(1, koelnA, 7),
      event(2, club, 5),
      event(3, koelnB, 3),
      event(4, club, 2),
      event(5, atlantis, 4),
      event(6, koelnA, 1, { status: "cancelled" }),
    ]);
    const city = places.find((place) => place.key === "city:de:koeln");
    const exact = places.find((place) => place.key === "venue:venue-1");
    expect(city?.eventIds).toEqual([uuid(3, 3), uuid(3, 1)]);
    expect(city?.venues).toEqual(["Venue 3", "Venue 2"]);
    expect(exact?.eventIds).toEqual([uuid(3, 4), uuid(3, 2)]);
    // A cancelled listing is never counted as a night, on the map either.
    expect(places.flatMap((place) => place.eventIds)).not.toContain(uuid(3, 6));
    expect(unmapped).toEqual(["Venue 4 (Atlantis)"]);
    expect(unmappedNights).toBe(1);
  });
});

describe("listenableLineup", () => {
  const dj = (
    n: number,
    soundcloudUrl: string | null,
    genres: string[],
  ): Dj => ({
    ...baseDj,
    id: uuid(2, n),
    slug: `dj-${n}`,
    name: `DJ ${n}`,
    genres,
    soundcloudUrl,
  });
  const djs = new Map(
    [
      dj(1, "https://soundcloud.com/dj-one", ["Hard Techno"]),
      dj(2, null, ["Techno"]),
      dj(3, "https://soundcloud.com/dj-three", []),
    ].map((entry) => [entry.id, entry]),
  );

  it("keeps lineup DJs with a SoundCloud profile in billing order", () => {
    const lineup = listenableLineup(
      {
        djIds: [uuid(2, 3), uuid(2, 2), uuid(2, 1), uuid(2, 3)],
        genres: ["Dub Techno"],
      },
      djs,
    );
    expect(lineup.map((entry) => entry.name)).toEqual(["DJ 3", "DJ 1"]);
    // Without profile genres the night's genres stand in.
    expect(lineup[0]?.genres).toEqual(["Dub Techno"]);
    expect(lineup[1]?.genres).toEqual(["Hard Techno"]);
  });
});

describe("night map theme", () => {
  it("keeps place and street names readable on both grounds", () => {
    for (const flavor of ["dark", "light"] as const) {
      const colors = nightColors[flavor];
      const ground = colors.earth ?? "";
      for (const key of [
        "city_label",
        "state_label",
        "country_label",
        "subplace_label",
        "roads_label_major",
        "roads_label_minor",
        "address_label",
        "ocean_label",
      ] as const)
        expect(
          contrastRatio(colors[key] ?? "", ground),
          `${flavor} ${key}`,
        ).toBeGreaterThanOrEqual(4.5);
      // Coasts must read; buildings stay quiet but visible.
      expect(contrastRatio(colors.water ?? "", ground)).toBeGreaterThanOrEqual(
        1.3,
      );
      expect(
        contrastRatio(colors.buildings ?? "", ground),
      ).toBeGreaterThanOrEqual(1.08);
    }
  });
});
