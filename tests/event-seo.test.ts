import { afterEach, describe, expect, it, vi } from "vitest";
import { generateMetadata } from "../src/app/events/[slug]/page";
import { getCatalog } from "../src/db/catalog";
import { requestLocale } from "../src/lib/locale";
import { demoCatalog } from "../src/db/demo";
import { eventSchema, venueSchema } from "../src/core/model";

vi.mock("../src/db/catalog", () => ({ getCatalog: vi.fn() }));
vi.mock("../src/lib/locale", () => ({ requestLocale: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const original = eventSchema.parse(demoCatalog.events[0]);
const venue = venueSchema.parse(
  demoCatalog.venues.find((entry) => entry.id === original.venueId),
);
const event = {
  ...original,
  title: "PLAYGRND 28",
  startsAt: "2026-10-08T23:30:00.000Z",
  translations: {
    en: { title: "PLAYGRND 28", description: "The announced night." },
  },
};

describe("event search metadata", () => {
  it.each([
    ["de", "9. Oktober 2026", ""],
    ["en", "9 October 2026", "/en"],
  ] as const)(
    "includes known venue, city and venue-local date in %s",
    async (locale, date, prefix) => {
      vi.mocked(requestLocale).mockResolvedValue(locale);
      vi.mocked(getCatalog).mockResolvedValue({
        mode: "database",
        events: [event],
        venues: [{ ...venue, timezone: "Europe/Berlin" }],
        djs: [],
      });
      const metadata = await generateMetadata({
        params: Promise.resolve({ slug: event.slug }),
      });
      const title = `PLAYGRND 28 – ${date} · ${venue.name}, ${venue.city} · EVRYVIBE`;
      expect(metadata.title).toEqual({ absolute: title });
      expect(metadata.openGraph).toMatchObject({ title });
      expect(metadata.twitter).toMatchObject({ title });
      expect(metadata.alternates).toMatchObject({
        canonical: `https://evryvibe.com${prefix}/events/${event.slug}`,
        languages: {
          de: `https://evryvibe.com/events/${event.slug}`,
          en: `https://evryvibe.com/en/events/${event.slug}`,
          "x-default": `https://evryvibe.com/events/${event.slug}`,
        },
      });
    },
  );
});
