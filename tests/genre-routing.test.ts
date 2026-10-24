import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGenreRoute } from "../src/app/genres/genre-routing";
import GenrePage, { generateMetadata } from "../src/app/genres/[slug]/page";
import { catalogCities } from "../src/core/cities";
import { demoCatalog } from "../src/db/demo";
import { venueSchema, type Catalog } from "../src/core/model";
import { getCatalog } from "../src/db/catalog";
import { requestLocale } from "../src/lib/locale";
import sitemap from "../src/app/sitemap";
vi.mock("../src/db/catalog", () => ({ getCatalog: vi.fn() }));
vi.mock("../src/lib/locale", () => ({ requestLocale: vi.fn() }));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
const sourceVenue = venueSchema.parse(demoCatalog.venues[0]);
const pairs = [
  ["electronica", "Bad Klosterlausnitz", "bad-klosterlausnitz"],
  ["industrial-techno", "Freiburg im Breisgau", "freiburg-im-breisgau"],
  ["psytechno", "Essen", "essen"],
  ["hypnotic-techno", "München", "muenchen"],
] as const;
const venues = pairs.map(([, name], index) => ({
  ...sourceVenue,
  id: `10000000-0000-4000-8000-00000000000${index}`,
  slug: `fictional-test-${index}`,
  city: name,
}));
const catalog: Catalog = { mode: "database", venues, events: [], djs: [] };
const cities = catalogCities(venues);
const props = (slug: string, query: Record<string, string> = {}) => ({
  params: Promise.resolve({ slug }),
  searchParams: Promise.resolve(query),
});

describe("historical genre-city routes", () => {
  it.each(pairs)(
    "preserves %s city meaning in DE/EN, literal/encoded",
    (genre, _name, city) => {
      for (const locale of ["de", "en"] as const)
        for (const delimiter of ["|", "%7C", "%7c"]) {
          expect(
            resolveGenreRoute(genre + delimiter + city, cities, locale),
          ).toEqual({
            kind: "redirect",
            href: `${locale === "en" ? "/en" : ""}/genres/${genre}?city=${city}`,
          });
        }
    },
  );
  it("normalizes recognized genre and city spellings in one redirect", () => {
    expect(
      resolveGenreRoute("Industrial|Freiburg im Breisgau", cities, "en"),
    ).toEqual({
      kind: "redirect",
      href: "/en/genres/industrial-techno?city=freiburg-im-breisgau",
    });
    expect(resolveGenreRoute("Hypnotic%7CM%C3%BCnchen", cities, "de")).toEqual({
      kind: "redirect",
      href: "/genres/hypnotic-techno?city=muenchen",
    });
  });
  it.each(["electronica|", "electronica%7C"])(
    "retains a known trailing empty pipe %s",
    (slug) => {
      expect(resolveGenreRoute(slug, cities, "de")).toEqual({
        kind: "redirect",
        href: "/genres/electronica",
      });
    },
  );
  it.each([
    "polka|essen",
    "electronica|nowhere",
    "electronica||essen",
    "electronica|essen|",
    "|essen",
    "||",
    "electronica%7Cessen%7Cnowhere",
    "unknown-topic",
  ])("leaves arbitrary unknown or malformed %s missing", (slug) => {
    expect(resolveGenreRoute(slug, cities, "de")).toEqual({ kind: "missing" });
  });
  it("preserves the existing genre-before-family resolution", () => {
    expect(resolveGenreRoute("bass", cities, "de")).toMatchObject({
      kind: "genre",
      genre: { slug: "bass-music" },
    });
    expect(resolveGenreRoute("electro-wave", cities, "en")).toEqual({
      kind: "redirect",
      href: "/en/djs?sound=electro-wave",
    });
  });
  it("metadata and page both issue the same permanent redirect before empty-state decisions", async () => {
    vi.mocked(getCatalog).mockResolvedValue(catalog);
    vi.mocked(requestLocale).mockResolvedValue("en");
    const expected = {
      digest:
        "NEXT_REDIRECT;replace;/en/genres/electronica?city=bad-klosterlausnitz;308;",
    };
    await expect(
      generateMetadata(props("electronica|bad-klosterlausnitz")),
    ).rejects.toMatchObject(expected);
    await expect(
      GenrePage(props("electronica|bad-klosterlausnitz")),
    ).rejects.toMatchObject(expected);
  });
});

it("retains a finite known empty genre200/noindex semantics while unknown topics remain missing", async () => {
  vi.mocked(getCatalog).mockResolvedValue(catalog);
  vi.mocked(requestLocale).mockResolvedValue("de");
  const metadata = await generateMetadata(props("electronica"));
  expect(metadata.robots).toEqual({ index: false, follow: true });
  expect(metadata.alternates?.canonical).toBe(
    "https://evryvibe.com/genres/electronica",
  );
  await expect(GenrePage(props("electronica"))).resolves.toBeTruthy();
  await expect(GenrePage(props("polka"))).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });
});

it("keeps city variants noindex with base genre canonical and locale alternates", async () => {
  vi.mocked(getCatalog).mockResolvedValue(catalog);
  vi.mocked(requestLocale).mockResolvedValue("en");
  const metadata = await generateMetadata(
    props("hypnotic-techno", { city: "muenchen" }),
  );
  expect(metadata.robots).toEqual({ index: false, follow: true });
  expect(metadata.alternates).toMatchObject({
    canonical: "https://evryvibe.com/en/genres/hypnotic-techno",
    languages: {
      de: "https://evryvibe.com/genres/hypnotic-techno",
      en: "https://evryvibe.com/en/genres/hypnotic-techno",
    },
  });
});

it("does not advertise empty known genres or legacy pipe variants in the sitemap", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("EVRYVIBE_DEMO", "0");
  vi.mocked(getCatalog).mockResolvedValue(catalog);
  const urls = (await sitemap()).map((row) => row.url);
  expect(urls.some((url) => url.includes("/genres/"))).toBe(false);
  expect(
    urls.some((url) => url.includes("|") || url.toLowerCase().includes("%7c")),
  ).toBe(false);
});
