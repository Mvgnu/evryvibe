import { describe, expect, it } from "vitest";
import {
  catalogCities,
  cityEvents,
  cityNights,
  citySlug,
  findCity,
  isUpcoming,
} from "../src/core/cities";
import { demoCatalog } from "../src/db/demo";
import type { Event, Venue } from "../src/core/model";

const venue = demoCatalog.venues[0];
const event = demoCatalog.events[0];
if (!venue || !event) throw new Error("Demo catalog needs a venue and event");

const venueIn = (id: string, city: string, country = "DE"): Venue => ({
  ...venue,
  id,
  slug: `venue-${id.slice(-1)}`,
  city,
  country,
});

describe("city identity", () => {
  it("builds readable URL slugs from German and accented names", () => {
    expect(citySlug("München")).toBe("muenchen");
    expect(citySlug("Frankfurt am Main")).toBe("frankfurt-am-main");
    expect(citySlug(" Zürich ")).toBe("zuerich");
    expect(citySlug("São Paulo")).toBe("sao-paulo");
  });

  it("gives no city page to names without Latin letters or digits", () => {
    expect(citySlug("東京")).toBeNull();
    const cities = catalogCities([
      venueIn("10000000-0000-4000-8000-00000000000a", "東京", "JP"),
    ]);
    expect(cities).toEqual([]);
  });

  it("merges spellings that share a slug under the most common spelling", () => {
    const cities = catalogCities([
      venueIn("10000000-0000-4000-8000-00000000000a", "Köln"),
      venueIn("10000000-0000-4000-8000-00000000000b", "Köln"),
      venueIn("10000000-0000-4000-8000-00000000000c", "Koeln"),
    ]);
    expect(cities).toHaveLength(1);
    expect(cities[0]).toMatchObject({ slug: "koeln", name: "Köln" });
    expect(cities[0]?.venueIds).toHaveLength(3);
    expect(findCity(demoCatalog.venues, "muenchen")?.name).toBe("München");
    expect(findCity(demoCatalog.venues, "nowhere")).toBeUndefined();
  });
});

describe("upcoming city listings", () => {
  const berlin = venueIn("10000000-0000-4000-8000-00000000000a", "Berlin");
  const hamburg = venueIn("10000000-0000-4000-8000-00000000000b", "Hamburg");
  const night = (
    id: string,
    venueId: string,
    startsAt: string,
    endsAt: string | null,
  ): Event => ({
    ...event,
    id,
    slug: `night-${id.slice(-1)}`,
    venueId,
    startsAt,
    endsAt,
  });
  const now = Date.parse("2026-09-26T02:00:00+02:00");
  const events = [
    // Started last night and still running: stays listed until it ends.
    night(
      "30000000-0000-4000-8000-00000000000a",
      berlin.id,
      "2026-09-25T23:00:00+02:00",
      "2026-09-26T08:00:00+02:00",
    ),
    // Finished before the request.
    night(
      "30000000-0000-4000-8000-00000000000b",
      berlin.id,
      "2026-09-25T20:00:00+02:00",
      "2026-09-26T01:00:00+02:00",
    ),
    // No end time: retained until the next local day at 09:00.
    night(
      "30000000-0000-4000-8000-00000000000c",
      berlin.id,
      "2026-09-27T23:00:00+02:00",
      null,
    ),
    night(
      "30000000-0000-4000-8000-00000000000d",
      hamburg.id,
      "2026-09-26T23:00:00+02:00",
      null,
    ),
  ];

  it("keeps running overnight events and drops finished ones", () => {
    expect(
      events.map((entry) => isUpcoming(entry, now, "Europe/Berlin")),
    ).toEqual([true, false, true, true]);
  });

  it("lists only the city's own upcoming events in start order", () => {
    const [city] = catalogCities([berlin, hamburg]);
    if (!city) throw new Error("Expected Berlin");
    expect(city.name).toBe("Berlin");
    const listed = cityEvents(
      { events: [...events].reverse(), venues: [berlin, hamburg] },
      city,
      now,
    );
    expect(listed.map((entry) => entry.slug)).toEqual(["night-a", "night-c"]);
  });

  it("keeps cancelled listings visible but does not count them as nights", () => {
    const [city] = catalogCities([berlin]);
    if (!city) throw new Error("Expected Berlin");
    const [running, , later] = events;
    if (!running || !later) throw new Error("Expected fixtures");
    const cancelled = { ...later, status: "cancelled" as const };
    const catalog = { events: [running, cancelled], venues: [berlin] };
    expect(cityEvents(catalog, city, now)).toHaveLength(2);
    expect(cityNights(catalog, city, now).map((entry) => entry.slug)).toEqual([
      "night-a",
    ]);
  });
});
