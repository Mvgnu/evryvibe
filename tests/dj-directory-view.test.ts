import { describe, expect, it } from "vitest";
import { demoCatalog } from "../src/db/demo";
import { catalogCities } from "../src/core/cities";
import {
  directoryEntries,
  filterDirectory,
  upcomingGenreEvents,
} from "../src/core/dj-directory";
import {
  canonicalGenre,
  canonicalGenres,
  genreBySlug,
  genreFamilies,
  isGenreFamilySlug,
} from "../src/core/genres";
import { cityGenreTitle } from "../src/app/cities/city-data";
import { compound } from "../src/components/german-compound";
import { genreDescription, genreTitle } from "../src/app/genres/genre-copy";
import {
  directoryDescription,
  directoryHref,
  djRow,
  djsTitle,
  emptyDirectoryQuery,
  genreIndex,
  genrePathOf,
  genreStats,
  isIndexableGenre,
  listedGenreSlugs,
  maxDjLimit,
  parseDirectoryQuery,
  placesOf,
  rowGenres,
} from "../src/components/dj-directory-view";

const now = Date.now();
const cities = catalogCities(demoCatalog.venues);
const entries = directoryEntries(demoCatalog, now);
const places = placesOf(demoCatalog);
const city = (slug: string) => {
  const found = cities.find((item) => item.slug === slug);
  if (!found) throw new Error(`Expected demo city ${slug}`);
  return found;
};
const entry = (slug: string) => {
  const found = entries.find((item) => item.dj.slug === slug);
  if (!found) throw new Error(`Expected demo DJ ${slug}`);
  return found;
};

describe("directory URL parameters", () => {
  it("accepts any spelling and asks for one canonical URL", () => {
    const alias = parseDirectoryQuery(
      { genre: "hardtechno", city: "Hamburg" },
      cities,
    );
    expect(alias.query.genre?.name).toBe("Hard Techno");
    // A genre names its family, so the sound filter follows it.
    expect(alias.query.family).toBe("hard-techno");
    expect(alias.query.city?.slug).toBe("hamburg");
    expect(alias.ignored).toEqual([]);
    expect(alias.redirect).toBe(true);
    expect(directoryHref("/djs", "de", alias.query)).toBe(
      "/djs?sound=hard-techno&genre=Hard+Techno&city=hamburg",
    );

    const canonical = parseDirectoryQuery(
      { sound: "hard-techno", genre: "Hard Techno", city: "hamburg" },
      cities,
    );
    expect(canonical.redirect).toBe(false);
    // Old sound slugs keep working.
    const legacy = parseDirectoryQuery({ sound: "acid" }, cities);
    expect(legacy.query.genre?.name).toBe("Acid Techno");
    expect(legacy.redirect).toBe(true);
  });

  it("drops malformed values with a notice instead of redirecting", () => {
    const parsed = parseDirectoryQuery(
      { city: "Atlantis", genre: "Polka", sound: "house", limit: "many" },
      cities,
    );
    expect(parsed.ignored.sort()).toEqual(["city", "genre", "limit"]);
    expect(parsed.query.family).toBe("house");
    expect(parsed.redirect).toBe(false);
    // A repeated parameter is ambiguous.
    expect(
      parseDirectoryQuery({ city: ["berlin", "hamburg"] }, cities).ignored,
    ).toEqual(["city"]);
  });

  it("caps the list length and leaves foreign parameters alone", () => {
    const parsed = parseDirectoryQuery(
      { limit: "5000", utm_source: "newsletter", q: "x" },
      cities,
    );
    expect(maxDjLimit).toBe(180);
    expect(parsed.query.limit).toBe(maxDjLimit);
    expect(parsed.redirect).toBe(true);
    const genrePage = parseDirectoryQuery(
      { genre: "House", city: "berlin" },
      cities,
      ["city", "limit"],
    );
    expect(genrePage.query.genre).toBeNull();
    expect(genrePage.redirect).toBe(false);
  });

  it("starts the list from the top when a filter changes", () => {
    const query = {
      ...emptyDirectoryQuery,
      city: city("berlin"),
      limit: 120,
    };
    expect(directoryHref("/djs", "en", query, { city: null })).toBe("/en/djs");
    expect(directoryHref("/djs", "en", query, { limit: 180 })).toBe(
      "/en/djs?city=berlin&limit=180",
    );
  });
});

describe("DJ rows", () => {
  it("never calls an announced booking played", () => {
    // Noor Halim's only Hamburg night is in the past.
    const past = djRow(entry("noor-halim"), city("hamburg"), places, "de", now);
    expect(past.where).toBe("1× in Hamburg");
    expect(past.when).toMatch(/^Zuletzt /);
    // Vera Kaltwerk plays Leipzig next; that night has not happened yet.
    const next = djRow(
      entry("vera-kaltwerk"),
      city("leipzig"),
      places,
      "en",
      now,
    );
    expect(next.where).toBe("1× in Leipzig");
    expect(next.when).toMatch(/^Next gig /);
    expect(next.when).not.toMatch(/Last|played/i);
  });

  it("summarises all cities and names the next night's city", () => {
    const row = djRow(entry("vera-kaltwerk"), null, places, "de", now);
    const tally = entry("vera-kaltwerk");
    const total = tally.pastNights + tally.upcomingNights;
    expect(row.where).toMatch(new RegExp(`^${total} Gigs · `));
    expect(row.when).toMatch(/^Nächster Gig .+ · Leipzig$/);
  });
});

const genreNamed = (name: string) => {
  const found = canonicalGenre(name);
  if (!found) throw new Error(`Expected genre ${name}`);
  return found;
};

describe("row genres", () => {
  const techno = genreNamed("Techno");
  const house = genreNamed("House");
  const dnb = genreNamed("Drum & Bass");
  const jungle = genreNamed("Jungle");
  const dj = {
    ...entry("vera-kaltwerk"),
    genres: [techno, house, dnb, jungle],
  };

  it("put the page's genre first and fill up to two", () => {
    expect(rowGenres(dj).map((item) => item.name)).toEqual(["Techno", "House"]);
    expect(
      rowGenres(dj, { genre: dnb, family: null }).map((item) => item.name),
    ).toEqual(["Drum & Bass", "Techno"]);
  });

  it("use the DJ's first genre of the family when only a family is filtered", () => {
    expect(
      rowGenres(dj, { genre: null, family: dnb.family }).map(
        (item) => item.name,
      ),
    ).toEqual(["Drum & Bass", "Techno"]);
    // No genre of the family: the plain first two.
    expect(
      rowGenres(
        { ...dj, genres: [techno, house] },
        { genre: null, family: dnb.family },
      ).map((item) => item.name),
    ).toEqual(["Techno", "House"]);
    expect(
      djRow(dj, null, places, "de", now, { genre: dnb, family: null }).sound,
    ).toBe("Drum & Bass · Techno");
  });
});

describe("German compounds", () => {
  it("hyphenate multi-word names in German only", () => {
    expect(compound("Hard Techno", "DJs", "de")).toBe("Hard-Techno-DJs");
    expect(compound("UK Garage", "DJs", "de")).toBe("UK-Garage-DJs");
    expect(compound("Drum & Bass", "Partys", "de")).toBe("Drum-&-Bass-Partys");
    expect(compound("Disco & Funk", "DJs", "de")).toBe("Disco-&-Funk-DJs");
    expect(compound("Techno", "DJs", "de")).toBe("Techno-DJs");
    expect(compound("Hard Techno", "DJs", "en")).toBe("Hard Techno DJs");
    expect(compound("House", "DJs", "en")).toBe("House DJs");
  });

  it("run through titles and descriptions", () => {
    const hard = genreNamed("Hard Techno");
    expect(djsTitle("Hard Techno", "de")).toBe("Hard-Techno-DJs");
    expect(djsTitle("Techno", "en")).toBe("Techno DJs");
    expect(genreTitle(hard, 3, "de")).toBe("Hard-Techno-DJs und -Partys");
    expect(genreTitle(hard, 0, "de")).toBe("Hard-Techno-DJs");
    expect(genreTitle(hard, 3, "en")).toBe("Hard Techno DJs and parties");
    expect(genreTitle(genreNamed("Drum & Bass"), 1, "de")).toBe(
      "Drum-&-Bass-DJs und -Partys",
    );
    expect(cityGenreTitle(city("berlin"), "Hard Techno", "de")).toBe(
      "Kommende Hard-Techno-Events in Berlin",
    );
    expect(cityGenreTitle(city("berlin"), "Hard Techno", "en")).toBe(
      "Upcoming Hard Techno events in Berlin",
    );
    expect(cityGenreTitle(city("berlin"), "Techno", "de")).toBe(
      "Kommende Techno-Events in Berlin",
    );
  });

  it("do not promise line-ups or tickets", () => {
    const hard = genreNamed("Hard Techno");
    const djs = filterDirectory(entries, { genre: hard });
    for (const locale of ["de", "en"] as const) {
      const text = genreDescription(hard, djs, [], 5, locale);
      expect(text).not.toMatch(/Line-ups|line-ups|Tickets|tickets/);
    }
    expect(genreDescription(hard, djs, [], 5, "de")).toContain(
      "kommende Hard-Techno-Partys",
    );
  });

  it("only say 'weiteren Städten' when there are more than three cities", () => {
    const some = filterDirectory(entries, {});
    const count = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        item: cities[i % cities.length] ?? city("berlin"),
        count: 1,
      }));
    expect(directoryDescription(some, count(3), "de")).not.toContain(
      "weiteren",
    );
    expect(directoryDescription(some, count(3), "en")).not.toContain(
      "more cities",
    );
    expect(directoryDescription(some, count(4), "de")).toContain(
      "weiteren Städten",
    );
    expect(directoryDescription(some, count(4), "en")).toContain("more cities");
  });
});

describe("genre pages", () => {
  const stats = genreStats(entries, demoCatalog, now);

  it("count DJs and upcoming nights exactly like the directory contract", () => {
    for (const genre of canonicalGenres) {
      const tally = stats.get(genre.slug);
      expect(tally?.djs).toBe(filterDirectory(entries, { genre }).length);
      expect(tally?.nights).toBe(
        upcomingGenreEvents(demoCatalog, genre, now).length,
      );
    }
  });

  it("are indexable with five DJs or any upcoming night", () => {
    expect(isIndexableGenre({ djs: 4, nights: 0 })).toBe(false);
    expect(isIndexableGenre({ djs: 5, nights: 0 })).toBe(true);
    expect(isIndexableGenre({ djs: 0, nights: 1 })).toBe(true);
  });

  it("index lists only genres with DJs or nights, in taxonomy order", () => {
    const index = genreIndex(entries, stats);
    const order = genreFamilies.map((family) => family.slug);
    const listed = index.map((group) => order.indexOf(group.family.slug));
    expect(listed).toEqual([...listed].sort((a, b) => a - b));
    for (const group of index)
      for (const item of group.genres) {
        expect(item.djs + item.nights).toBeGreaterThan(0);
        expect(item.genre.family).toBe(group.family.slug);
      }
  });

  it("with no DJs and no night have no page to link to", () => {
    const listed = listedGenreSlugs(entries, demoCatalog, now);
    for (const tally of stats.values())
      expect(listed.has(tally.genre.slug)).toBe(tally.djs + tally.nights > 0);
    expect(listed.has("idm")).toBe(false);
  });

  it("let an alias of a canonical genre win over a family of the same name", () => {
    // "bass" is a family slug and an alias of Bass Music; /genres/bass
    // resolves to the genre and 308s to /genres/bass-music.
    expect(isGenreFamilySlug("bass")).toBe(true);
    expect(canonicalGenre("bass")?.slug).toBe("bass-music");
  });

  it("link only names the taxonomy knows, and family and genre slugs never collide", () => {
    expect(genrePathOf("Hard Techno")).toBe("/genres/hard-techno");
    expect(genrePathOf("Drum & Bass")).toBe("/genres/drum-and-bass");
    expect(genrePathOf("Polka")).toBeNull();
    // `hard-techno` is both a family and a genre slug; the genre owns the URL.
    expect(genreBySlug("hard-techno")?.family).toBe("hard-techno");
  });
});
