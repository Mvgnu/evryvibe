import { afterEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "../src/core/model";
import { demoCatalog } from "../src/db/demo";
import { pageMetadata } from "../src/core/site";
import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";
import { GET } from "../src/app/api/health/route";
import { getCatalog } from "../src/db/catalog";
import { databaseReady } from "../src/db/readiness";
import { catalogCities, isUpcoming } from "../src/core/cities";
import { cityMonths } from "../src/app/cities/city-data";
import { directoryEntries } from "../src/core/dj-directory";
import {
  genreStats,
  isIndexableGenre,
} from "../src/components/dj-directory-view";

vi.mock("../src/db/catalog", () => ({ getCatalog: vi.fn() }));
vi.mock("../src/db/readiness", () => ({ databaseReady: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it("lists only qualifying venue-local months without claiming unsupported page modification dates", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("EVRYVIBE_DEMO", "0");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"));
  const venue = demoCatalog.venues[0];
  const original = demoCatalog.events.find(
    (entry) => entry.venueId === venue?.id,
  );
  if (!venue || !original) throw new Error("Expected fixture venue and event");
  const city = catalogCities([venue])[0];
  if (!city) throw new Error("Expected fixture city");
  const observedAt = "2026-10-03T09:00:00.000Z";
  const event = {
    ...original,
    startsAt: "2026-10-31T23:30:00.000Z",
    endsAt: null,
    observedAt,
    status: "scheduled" as const,
  };
  vi.mocked(getCatalog).mockResolvedValue({
    mode: "database",
    venues: [{ ...venue, timezone: "Europe/Berlin" }],
    djs: [],
    events: [
      event,
      {
        ...event,
        id: "cancelled",
        slug: "cancelled-night",
        startsAt: "2026-10-09T21:00:00.000Z",
        status: "cancelled",
      },
    ],
  });
  const entries = await sitemap();
  const monthPath = `https://evryvibe.com/cities/${city.slug}/2026-11`;
  expect(entries.some(({ url }) => url === monthPath)).toBe(true);
  for (const entry of entries) expect(entry).not.toHaveProperty("lastModified");
  expect(
    entries.some(({ url }) => url.endsWith(`/cities/${city.slug}/2026-10`)),
  ).toBe(false);
  vi.setSystemTime(new Date("2026-10-06T12:00:00.000Z"));
  expect(await sitemap()).toEqual(entries);
});

const emptyCatalog: Catalog = {
  mode: "database",
  venues: [],
  events: [],
  djs: [],
};

describe("production discovery metadata", () => {
  it("uses the canonical detail URL for search and sharing", () => {
    const metadata = pageMetadata("A night", "Description", "/events/a-night");
    expect(metadata.alternates?.canonical).toBe(
      "https://evryvibe.com/events/a-night",
    );
    expect(metadata.openGraph).toMatchObject({
      url: "https://evryvibe.com/events/a-night",
    });
  });

  it("uses the same branded title and clean description for search and sharing", () => {
    const metadata = pageMetadata(
      "A night",
      "  Line one.\n  Line two.  ",
      "/events/a-night",
    );
    expect(metadata.title).toEqual({ absolute: "A night · EVRYVIBE" });
    expect(metadata.description).toBe("Line one. Line two.");
    expect(metadata.openGraph).toMatchObject({
      title: "A night · EVRYVIBE",
      description: metadata.description,
    });
    expect(metadata.twitter).toMatchObject({
      title: "A night · EVRYVIBE",
      description: metadata.description,
    });
  });

  it("does not repeat the brand in externally supplied editorial titles", () => {
    const metadata = pageMetadata(
      "Techno Partys Stuttgart: Clubs & Events | EVRYVIBE",
      "Description",
      "/cities/stuttgart",
    );
    expect(metadata.title).toEqual({
      absolute: "Techno Partys Stuttgart: Clubs & Events · EVRYVIBE",
    });
    expect(metadata.openGraph).toMatchObject({
      title: "Techno Partys Stuttgart: Clubs & Events · EVRYVIBE",
    });
  });

  it("includes supplied entity artwork in sharing metadata without fabricating an image", () => {
    const image = "https://example.com/poster.jpg";
    const metadata = pageMetadata(
      "A night",
      "Description",
      "/events/a-night",
      "en",
      image,
    );
    expect(metadata.openGraph).toMatchObject({
      images: [{ url: image, alt: "A night" }],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: [{ url: image, alt: "A night" }],
    });
    expect(
      pageMetadata("A night", "Description", "/events/a-night").openGraph,
    ).not.toHaveProperty("images");
  });

  it("keeps preview content out of crawlers and never reads demo inventory for the sitemap", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EVRYVIBE_DEMO", "1");
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    expect(await sitemap()).toEqual([]);
    expect(getCatalog).not.toHaveBeenCalled();
  });

  it("allows an honest empty production catalogue without invented detail URLs", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EVRYVIBE_DEMO", "0");
    vi.mocked(getCatalog).mockResolvedValue(emptyCatalog);
    expect((await sitemap()).map(({ url }) => url)).toEqual([
      "https://evryvibe.com/",
      "https://evryvibe.com/en",
      "https://evryvibe.com/impressum",
      "https://evryvibe.com/en/impressum",
      "https://evryvibe.com/datenschutz",
      "https://evryvibe.com/en/datenschutz",
      "https://evryvibe.com/kontakt",
      "https://evryvibe.com/en/kontakt",
      "https://evryvibe.com/takedown",
      "https://evryvibe.com/en/takedown",
    ]);
    expect(robots()).toMatchObject({
      rules: { disallow: ["/ops", "/api/"] },
      sitemap: "https://evryvibe.com/sitemap.xml",
    });
  });
});

it("publishes only catalogue detail routes in both languages with matching hreflang", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("EVRYVIBE_DEMO", "0");
  vi.mocked(getCatalog).mockResolvedValue({ ...demoCatalog, mode: "database" });
  const entries = await sitemap();
  const monthCount = catalogCities(demoCatalog.venues).reduce(
    (total, city) => total + cityMonths(demoCatalog, city, Date.now()).length,
    0,
  );
  const genres = [
    ...genreStats(
      directoryEntries(demoCatalog, Date.now()),
      demoCatalog,
      Date.now(),
    ).values(),
  ];
  const indexableGenres = genres.filter(isIndexableGenre);
  // Home, four legal pages, city index, four fixture cities, qualifying
  // months, the DJ directory, the genre index and indexable genre pages.
  expect(indexableGenres.length).toBeGreaterThan(0);
  expect(entries).toHaveLength(
    2 *
      (10 +
        monthCount +
        2 +
        indexableGenres.length +
        demoCatalog.events.filter((event) =>
          demoCatalog.venues.some(
            (venue) =>
              venue.id === event.venueId &&
              isUpcoming(event, Date.now(), venue.timezone),
          ),
        ).length +
        demoCatalog.venues.length +
        demoCatalog.djs.length),
  );
  const urls = entries.map((entry) => entry.url);
  expect(urls).toContain("https://evryvibe.com/en/cities/muenchen");
  expect(urls).toContain("https://evryvibe.com/djs");
  expect(urls).toContain("https://evryvibe.com/en/genres");
  // A thin genre page (under five DJs, no upcoming night) stays out.
  const thin = genres.find((item) => !isIndexableGenre(item));
  if (thin)
    expect(urls).not.toContain(
      `https://evryvibe.com/genres/${thin.genre.slug}`,
    );
  for (const { genre } of indexableGenres)
    expect(urls).toContain(`https://evryvibe.com/genres/${genre.slug}`);
  for (const entry of entries) {
    expect(entry.url).not.toContain("/ops");
    expect(entry.alternates?.languages).toHaveProperty("de");
    expect(entry.alternates?.languages).toHaveProperty("en");
    expect(entry.alternates?.languages).toHaveProperty("x-default");
  }
});

it("does not replace a database outage with fictional sitemap records", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("EVRYVIBE_DEMO", "0");
  vi.mocked(getCatalog).mockRejectedValue(new Error("database unavailable"));
  await expect(sitemap()).rejects.toThrow("database unavailable");
});

describe("readiness HTTP contract", () => {
  it.each([true, false])(
    "returns noncached readiness for ready=%s",
    async (ready) => {
      vi.mocked(databaseReady).mockResolvedValue(ready);
      const response = await GET();
      expect(response.status).toBe(ready ? 200 : 503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        status: ready ? "ok" : "unavailable",
      });
    },
  );

  it("does not expose connection errors or credentials", async () => {
    vi.mocked(databaseReady).mockRejectedValue(
      new Error("postgres://user:secret@private"),
    );
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"unavailable"}');
  });
});
