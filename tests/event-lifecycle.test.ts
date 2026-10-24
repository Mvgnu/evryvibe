import { afterEach, describe, expect, it, vi } from "vitest";
import { isUpcoming } from "../src/core/cities";
import { demoCatalog } from "../src/db/demo";
import { eventSchema, venueSchema } from "../src/core/model";
import {
  upcomingListings,
  matchesWhen,
} from "../src/components/discovery-filters";
import { eventStructuredData } from "../src/core/structured-data";
import { generateMetadata } from "../src/app/events/[slug]/page";
import sitemap from "../src/app/sitemap";
import { getCatalog } from "../src/db/catalog";
import { requestLocale } from "../src/lib/locale";
vi.mock("../src/db/catalog", () => ({ getCatalog: vi.fn() }));
vi.mock("../src/lib/locale", () => ({ requestLocale: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
const original = eventSchema.parse(demoCatalog.events[0]);
const venue = {
  ...venueSchema.parse(
    demoCatalog.venues.find((v) => v.id === original.venueId),
  ),
  timezone: "Europe/Berlin",
};
const event = {
  ...original,
  startsAt: "2026-10-21T23:00:00+02:00",
  endsAt: null,
};
const catalog = {
  mode: "database" as const,
  events: [event],
  venues: [venue],
  djs: [],
};

describe("null-end discovery cutoff", () => {
  it.each([
    [
      "2026-10-21T23:00:00+02:00",
      "Europe/Berlin",
      "2026-10-22T00:00:00+02:00",
      true,
    ],
    [
      "2026-10-21T23:00:00+02:00",
      "Europe/Berlin",
      "2026-10-22T08:59:59.999+02:00",
      true,
    ],
    [
      "2026-10-21T23:00:00+02:00",
      "Europe/Berlin",
      "2026-10-22T09:00:00+02:00",
      false,
    ],
    [
      "2026-03-28T23:00:00+01:00",
      "Europe/Berlin",
      "2026-03-29T08:59:59.999+02:00",
      true,
    ],
    [
      "2026-03-28T23:00:00+01:00",
      "Europe/Berlin",
      "2026-03-29T09:00:00+02:00",
      false,
    ],
    [
      "2026-10-24T23:00:00+02:00",
      "Europe/Berlin",
      "2026-10-25T08:59:59.999+01:00",
      true,
    ],
    [
      "2026-10-24T23:00:00+02:00",
      "Europe/Berlin",
      "2026-10-25T09:00:00+01:00",
      false,
    ],
    [
      "2026-10-21T23:30:00-04:00",
      "America/New_York",
      "2026-10-22T08:59:59.999-04:00",
      true,
    ],
    [
      "2026-10-21T23:30:00-04:00",
      "America/New_York",
      "2026-10-22T09:00:00-04:00",
      false,
    ],
    [
      "2026-12-31T12:00:00+14:00",
      "Pacific/Kiritimati",
      "2027-01-01T09:00:00+14:00",
      false,
    ],
  ])("%s in %s at %s -> %s", (startsAt, timezone, now, expected) => {
    expect(isUpcoming({ ...event, startsAt }, Date.parse(now), timezone)).toBe(
      expected,
    );
  });
  it("keeps explicit ends authoritative and exclusive", () => {
    const known = { ...event, endsAt: "2026-10-23T12:00:00+02:00" };
    expect(
      isUpcoming(
        known,
        Date.parse("2026-10-22T10:00:00+02:00"),
        venue.timezone,
      ),
    ).toBe(true);
    expect(isUpcoming(known, Date.parse(known.endsAt), venue.timezone)).toBe(
      false,
    );
    expect(
      isUpcoming(
        { ...event, endsAt: "2026-10-22T02:00:00+02:00" },
        Date.parse("2026-10-22T03:00:00+02:00"),
        venue.timezone,
      ),
    ).toBe(false);
  });
  it("matches Today before cutoff without asserting running or inventing endDate", () => {
    const listings = upcomingListings(
      catalog,
      Date.parse("2026-10-22T08:00:00+02:00"),
    );
    expect(listings).toHaveLength(1);
    const listing = listings[0];
    if (!listing) throw new Error("Expected retained event");
    expect(listing.running).toBe(false);
    expect(matchesWhen(listing, "today", "")).toBe(true);
    expect(
      upcomingListings(catalog, Date.parse("2026-10-22T09:00:00+02:00")),
    ).toEqual([]);
    expect(JSON.stringify(eventStructuredData(event, venue, []))).not.toContain(
      '"endDate"',
    );
  });
});

it("changes metadata and sitemap at cutoff while retaining canonical detail identity", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("EVRYVIBE_DEMO", "0");
  vi.useFakeTimers();
  vi.mocked(getCatalog).mockResolvedValue(catalog);
  vi.mocked(requestLocale).mockResolvedValue("en");
  const props = { params: Promise.resolve({ slug: event.slug }) };
  vi.setSystemTime(new Date("2026-10-22T08:59:59.999+02:00"));
  expect((await generateMetadata(props)).robots).toBeUndefined();
  expect(
    (await sitemap()).some((row) => row.url.endsWith(`/events/${event.slug}`)),
  ).toBe(true);
  vi.setSystemTime(new Date("2026-10-22T09:00:00+02:00"));
  const archived = await generateMetadata(props);
  expect(archived.robots).toEqual({ index: false, follow: true });
  expect(archived.alternates?.canonical).toBe(
    `https://evryvibe.com/en/events/${event.slug}`,
  );
  expect(
    (await sitemap()).some((row) => row.url.endsWith(`/events/${event.slug}`)),
  ).toBe(false);
});

it("does not reorder a caller's catalogue during discovery", () => {
  const earlier = {
    ...event,
    slug: "earlier",
    startsAt: "2026-10-21T22:00:00+02:00",
  };
  const events = [event, earlier];
  expect(
    upcomingListings(
      { ...catalog, events },
      Date.parse("2026-10-21T20:00:00+02:00"),
    ).map((row) => row.event.slug),
  ).toEqual(["earlier", event.slug]);
  expect(events).toEqual([event, earlier]);
});
