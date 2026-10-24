import { createElement, type ReactNode } from "react";
import { InstagramConsentProvider } from "../src/components/instagram-consent";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCatalog } from "../src/db/demo";
import type { Catalog } from "../src/core/model";
import type { CityEditorial } from "../src/core/city-editorial";

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  editorial: vi.fn(),
  locale: vi.fn(),
}));
vi.mock("../src/db/catalog", () => ({ getCatalog: mocks.catalog }));
vi.mock("../src/db/city-editorial", () => ({
  getCityContent: mocks.editorial,
}));
vi.mock("../src/lib/locale", () => ({ requestLocale: mocks.locale }));
import CityPage, { generateMetadata } from "../src/app/cities/[slug]/page";
import CityMonthPage, {
  generateMetadata as monthMetadata,
} from "../src/app/cities/[slug]/[month]/page";

const venue = demoCatalog.venues[0];
const event = demoCatalog.events[0];
if (!venue || !event) throw new Error("Fixtures require event and venue");
const catalog: Catalog = {
  mode: "database",
  venues: [{ ...venue, city: "Test City", timezone: "Europe/Berlin" }],
  djs: [],
  events: [
    {
      ...event,
      startsAt: "2026-10-09T21:00:00Z",
      endsAt: null,
      status: "scheduled",
      venueId: venue.id,
      genres: ["Techno"],
    },
  ],
};
const content: CityEditorial = {
  citySlug: "test-city",
  de: {
    heading: "Partys in Test City",
    intro: "Veröffentlichte Ankündigungen für Test City.",
    seoTitle: "Das Clubprogramm in Test City",
    metaDescription: "Veröffentlichte Club Events und Partys in Test City.",
  },
  en: {
    heading: "Parties in Test City",
    intro: "Published announcements in Test City.",
    seoTitle: "Test City club programme",
    metaDescription: "Published club events and parties in Test City.",
  },
  updatedAt: "2026-10-01T12:00:00Z",
};
const renderPage = (children: ReactNode) =>
  renderToStaticMarkup(
    // The provider requires children in its typed props for this SSR fixture.
    // eslint-disable-next-line react/no-children-prop
    createElement(InstagramConsentProvider, {
      locale: "de",
      initialConsent: "rejected",
      children,
    }),
  );
const props = (query: Record<string, string | string[] | undefined> = {}) => ({
  params: Promise.resolve({ slug: "test-city" }),
  searchParams: Promise.resolve(query),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
  mocks.catalog.mockResolvedValue(catalog);
  mocks.editorial.mockResolvedValue(content);
  mocks.locale.mockResolvedValue("de");
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("city SEO metadata", () => {
  it("uses persisted localized editorial metadata and self language alternates", async () => {
    const german = await generateMetadata(props());
    expect(german.title).toEqual({
      absolute: "Das Clubprogramm in Test City · EVRYVIBE",
    });
    expect(german.description).toBe(content.de.metaDescription);
    expect(german.alternates?.canonical).toBe(
      "https://evryvibe.com/cities/test-city",
    );
    mocks.locale.mockResolvedValue("en");
    const english = await generateMetadata(props());
    expect(english.title).toEqual({
      absolute: "Test City club programme · EVRYVIBE",
    });
    expect(english.alternates?.canonical).toBe(
      "https://evryvibe.com/en/cities/test-city",
    );
    expect(english.alternates?.languages).toMatchObject({
      de: "https://evryvibe.com/cities/test-city",
      en: "https://evryvibe.com/en/cities/test-city",
    });
  });
  it("keeps the live programme before saved editorial copy in both locales", async () => {
    for (const locale of ["de", "en"] as const) {
      mocks.locale.mockResolvedValue(locale);
      const html = renderPage(await CityPage(props()));
      const heading =
        locale === "de"
          ? "Techno-Partys in Test City"
          : "Techno parties in Test City";
      expect(html).toContain(`${heading}</h1>`);
      const editorialPosition = html.indexOf('id="city-editorial-title"');
      expect(html).toContain(`${content[locale].heading}</h2>`);
      expect(editorialPosition).toBeGreaterThan(html.indexOf(event.title));
      expect(editorialPosition).toBeGreaterThan(html.indexOf('id="city-djs"'));
      expect(html.indexOf(content[locale].intro)).toBeGreaterThan(
        editorialPosition,
      );
      expect(
        html.indexOf(
          locale === "de" ? "Stadttext aktualisiert:" : "City text updated:",
        ),
      ).toBeGreaterThan(editorialPosition);
      const filtered = renderPage(await CityPage(props({ genre: "Techno" })));
      expect(filtered).not.toContain(content[locale].intro);
      expect(filtered).not.toContain('id="city-editorial-title"');
      const metadata = await generateMetadata(props());
      expect(metadata.description).toBe(content[locale].metaDescription);
    }
  });

  it("does not repeat an editorial heading that matches the H1", async () => {
    mocks.locale.mockResolvedValue("de");
    mocks.editorial.mockResolvedValueOnce({
      ...content,
      de: { ...content.de, heading: "Techno-Partys in Test City" },
    });
    const html = renderPage(await CityPage(props()));
    expect(html).toContain("Techno-Partys in Test City</h1>");
    expect(html).toContain("Mehr über Techno in Test City</h2>");
    expect(html).not.toContain("Techno-Partys in Test City</h2>");
  });
  it("gives known genres distinct indexable titles and limits unknown or malformed variants", async () => {
    const techno = await generateMetadata(props({ genre: "Techno" }));
    expect(techno.title).toEqual({
      absolute: "Kommende Techno-Events in Test City · EVRYVIBE",
    });
    expect(techno.alternates?.canonical).toBe(
      "https://evryvibe.com/cities/test-city?genre=Techno",
    );
    expect(techno.robots).toBeUndefined();
    for (const query of [
      { genre: "Imaginary" },
      { genre: ["Techno", "House"] },
      { genre: "Techno", extra: "unbounded" },
    ]) {
      expect((await generateMetadata(props(query))).robots).toEqual({
        index: false,
        follow: true,
      });
    }
  });
  it("noindexes demo inventory and cities with only cancellations", async () => {
    mocks.catalog.mockResolvedValue({ ...catalog, mode: "demo" });
    expect((await generateMetadata(props())).robots).toEqual({
      index: false,
      follow: true,
    });
    expect(mocks.editorial).not.toHaveBeenCalled();
    mocks.catalog.mockResolvedValue({
      ...catalog,
      events: catalog.events.map((item) => ({ ...item, status: "cancelled" })),
    });
    expect((await generateMetadata(props())).robots).toEqual({
      index: false,
      follow: true,
    });
  });
  it("composes month and genre metadata, visible events and city links", async () => {
    const techno = {
      ...catalog.events[0],
      ...event,
      slug: "october-techno",
      title: "October Techno",
      venueId: venue.id,
      startsAt: "2026-10-09T21:00:00Z",
      endsAt: null,
      status: "scheduled" as const,
      genres: ["Techno"],
    };
    const houseVenue = {
      ...catalog.venues[0],
      ...venue,
      id: "10000000-0000-4000-8000-000000000099",
      name: "House Venue",
      slug: "house-venue",
      city: "Test City",
    };
    const house = {
      ...techno,
      venueId: houseVenue.id,
      slug: "october-house",
      title: "October House",
      startsAt: "2026-10-10T21:00:00Z",
      genres: ["House"],
    };
    const november = {
      ...house,
      slug: "november-house",
      title: "November House",
      startsAt: "2026-11-10T21:00:00Z",
    };
    mocks.catalog.mockResolvedValue({
      ...catalog,
      venues: [...catalog.venues, houseVenue],
      events: [techno, house, november],
    });
    const monthProps = (month = "2026-10", genre = "Techno") => ({
      params: Promise.resolve({ slug: "test-city", month }),
      searchParams: Promise.resolve({ genre }),
    });
    const german = await monthMetadata(monthProps());
    expect(german.title).toEqual({
      absolute:
        "Kommende Techno-Events in Test City im Oktober 2026 · EVRYVIBE",
    });
    expect(german.description).toContain("1 kommendes Techno-Event");
    expect(german.robots).toBeUndefined();
    expect(german.alternates?.canonical).toBe(
      "https://evryvibe.com/cities/test-city/2026-10?genre=Techno",
    );
    const html = renderPage(await CityMonthPage(monthProps()));
    expect(html).toContain(
      "Kommende Techno-Events in Test City im Oktober 2026</h1>",
    );
    expect(html).toContain("October Techno");
    expect(html).not.toContain("October House");
    expect(html).not.toContain("october-house");
    expect(html).not.toContain("House Venue");
    expect(html).not.toContain("november-house");
    expect(html).toContain("/cities/test-city/2026-10?genre=Techno");
    const cityHtml = renderPage(await CityPage(props({ genre: "Techno" })));
    expect(cityHtml).toContain("/cities/test-city/2026-10?genre=Techno");
    expect(cityHtml).not.toContain("/cities/test-city/2026-11");
    expect(cityHtml).toContain("Kommende Techno-Events in Test City</h1>");
    expect(cityHtml).toContain("Entdecke kommende Techno-Events in Test City.");
    expect(cityHtml).not.toContain("Entdecke kommende Techno-Partys");
    expect(cityHtml).toContain("<dd>01</dd>");
    expect(cityHtml).not.toContain("House Venue");
    const emptyMetadata = await monthMetadata(monthProps("2026-11"));
    expect(emptyMetadata.robots).toEqual({ index: false, follow: true });
    const emptyHtml = renderPage(await CityMonthPage(monthProps("2026-11")));
    expect(emptyHtml).toContain("Keine passenden kommenden Events");
    expect(emptyHtml).not.toContain("November House");
    expect(
      (await monthMetadata(monthProps("2026-10", "Unknown"))).robots,
    ).toEqual({ index: false, follow: true });
    mocks.locale.mockResolvedValue("en");
    const english = await monthMetadata(monthProps());
    expect(english.title).toEqual({
      absolute:
        "Upcoming Techno events in Test City in October 2026 · EVRYVIBE",
    });
    const englishHtml = renderPage(await CityMonthPage(monthProps()));
    expect(englishHtml).toContain(
      "Upcoming Techno events in Test City in October 2026</h1>",
    );
    expect(english.alternates?.canonical).toBe(
      "https://evryvibe.com/en/cities/test-city/2026-10?genre=Techno",
    );
    expect(english.alternates?.languages).toMatchObject({
      de: "https://evryvibe.com/cities/test-city/2026-10?genre=Techno",
      en: "https://evryvibe.com/en/cities/test-city/2026-10?genre=Techno",
    });
  });
  it("keeps the real monthly programme when tracking parameters are present", async () => {
    const params = Promise.resolve({ slug: "test-city", month: "2026-10" });
    for (const query of [
      { utm_source: "club" },
      { genre: "Techno", utm_source: "club" },
    ]) {
      const request = { params, searchParams: Promise.resolve(query) };
      const metadata = await monthMetadata(request);
      expect(metadata.robots).toEqual({ index: false, follow: true });
      expect(metadata.alternates?.canonical).toBe(
        `https://evryvibe.com/cities/test-city/2026-10${"genre" in query ? "?genre=Techno" : ""}`,
      );
      const html = renderPage(await CityMonthPage(request));
      expect(html).toContain(event.title);
      expect(html).not.toContain("Keine passenden kommenden Events");
    }
  });
  it("scopes empty-city descriptions to published EVRYVIBE inventory in both locales", async () => {
    mocks.catalog.mockResolvedValue({ ...catalog, events: [] });
    mocks.editorial.mockResolvedValue(null);
    const german = await generateMetadata(props());
    expect(german.description).toContain(
      "Auf EVRYVIBE sind gerade keine kommenden Nächte in Test City veröffentlicht.",
    );
    mocks.locale.mockResolvedValue("en");
    const english = await generateMetadata(props());
    expect(english.description).toContain(
      "No upcoming nights in Test City are published on EVRYVIBE right now.",
    );
  });
  it("names and canonicalizes factual monthly programmes and rejects empty months", async () => {
    const params = Promise.resolve({ slug: "test-city", month: "2026-10" });
    const metadata = await monthMetadata({
      params,
      searchParams: Promise.resolve({}),
    });
    expect(metadata.title).toEqual({
      absolute: "Techno-Partys in Test City im Oktober 2026 · EVRYVIBE",
    });
    expect(metadata.alternates?.canonical).toBe(
      "https://evryvibe.com/cities/test-city/2026-10",
    );
    await expect(
      monthMetadata({
        params: Promise.resolve({ slug: "test-city", month: "2026-11" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow();
    await expect(
      monthMetadata({
        params: Promise.resolve({ slug: "test-city", month: "2026-13" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow();
  });
});
