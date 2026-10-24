import { describe, expect, it } from "vitest";
import { findCity } from "../src/core/cities";
import type { Catalog, Event, Venue } from "../src/core/model";
import { demoCatalog } from "../src/db/demo";
import {
  cityIntro,
  cityMonths,
  cityMonthEvents,
  cityView,
  latestObservation,
  monthName,
} from "../src/app/cities/city-data";

const venue = demoCatalog.venues[0];
const event = demoCatalog.events[0];
if (!venue || !event) throw new Error("Fixtures require a venue and event");
const east: Venue = { ...venue, city: "Test City", timezone: "Europe/Berlin" };
const west: Venue = {
  ...venue,
  id: "10000000-0000-4000-8000-000000000099",
  city: "Test City",
  timezone: "America/New_York",
};
const night = (
  slug: string,
  startsAt: string,
  overrides: Partial<Event> = {},
): Event => ({
  ...event,
  slug,
  venueId: east.id,
  startsAt,
  endsAt: null,
  status: "scheduled",
  observedAt: "2026-09-28T12:00:00Z",
  ...overrides,
});
const now = Date.parse("2026-09-29T12:00:00Z");
const catalog: Catalog = {
  mode: "database",
  venues: [east, west],
  djs: [],
  events: [
    night("east-boundary", "2026-09-30T22:30:00Z"),
    night("west-boundary", "2026-10-01T01:00:00Z", { venueId: west.id }),
    night("cancelled-november", "2026-11-12T23:00:00Z", {
      status: "cancelled",
    }),
    night("past-night", "2026-09-01T22:00:00Z"),
    night("still-running", "2026-08-31T22:00:00Z", {
      endsAt: "2026-09-30T12:00:00Z",
    }),
  ],
};
const city = findCity(catalog.venues, "test-city");
if (!city) throw new Error("Fixture city missing");

describe("city monthly programmes", () => {
  it("links only months with scheduled future starts, in each venue timezone", () => {
    expect(cityMonths(catalog, city, now)).toEqual(["2026-09", "2026-10"]);
    expect(
      cityMonthEvents(catalog, city, "2026-10", now).map((item) => item.slug),
    ).toEqual(["east-boundary"]);
    expect(
      cityMonthEvents(catalog, city, "2026-09", now).map((item) => item.slug),
    ).toEqual(["still-running", "west-boundary"]);
  });
  it("removes expired month programmes and retains cancellations in an existing month", () => {
    const withCancellation = {
      ...catalog,
      events: [
        ...catalog.events,
        night("cancelled-october", "2026-10-04T20:00:00Z", {
          status: "cancelled",
        }),
      ],
    };
    expect(
      cityMonthEvents(withCancellation, city, "2026-10", now).map(
        (item) => item.slug,
      ),
    ).toEqual(["east-boundary", "cancelled-october"]);
    expect(
      cityMonths(catalog, city, Date.parse("2026-10-02T12:00:00Z")),
    ).toEqual([]);
  });
  it("names months consistently across server timezones and locales", () => {
    expect(monthName("2026-10", "de")).toBe("Oktober 2026");
    expect(monthName("2026-10", "en")).toBe("October 2026");
  });
  it("uses source observation times and factual fallback copy", () => {
    const events = [
      night("older", "2026-10-02T12:00:00Z"),
      night("newer", "2026-10-03T12:00:00Z", {
        observedAt: "2026-09-29T10:00:00Z",
      }),
    ];
    expect(latestObservation(events)).toBe("2026-09-29T10:00:00Z");
    expect(latestObservation([])).toBeNull();
    const intro = cityIntro(cityView(catalog, city, now), "en");
    expect(intro).toContain("techno parties and events in Test City");
    expect(intro).toContain("Other venues and events may be missing.");
  });
});
