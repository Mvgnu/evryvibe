import { describe, expect, it } from "vitest";
import {
  homeView,
  parseHomeFilters,
  upcomingListings,
} from "../src/components/discovery-filters";
import { demoCatalog } from "../src/db/demo";

describe("home sound and genre parameters", () => {
  it("accepts family slugs and canonical or alias genres", () => {
    expect(parseHomeFilters({ sound: "hard-techno" }).filters.sound).toBe(
      "hard-techno",
    );
    const { filters, ignored } = parseHomeFilters({
      genre: "peak-time techno",
    });
    expect(filters.genre).toBe("Peak Time Techno");
    // The genre names its own family.
    expect(filters.sound).toBe("techno");
    expect(ignored).toEqual([]);
  });

  it("maps the old nine-sound links to the closest family or genre", () => {
    const old = (sound: string) => parseHomeFilters({ sound }).filters;
    expect(old("hard")).toMatchObject({ sound: "hard-techno", genre: "" });
    expect(old("acid")).toMatchObject({
      sound: "techno",
      genre: "Acid Techno",
    });
    expect(old("dub")).toMatchObject({ sound: "techno", genre: "Dub Techno" });
    expect(old("electro").sound).toBe("electro-wave");
    expect(old("breaks").sound).toBe("bass");
    for (const same of ["techno", "house", "trance", "ambient"])
      expect(old(same).sound).toBe(same);
  });

  it("lets an explicit genre refine a legacy sound", () => {
    expect(
      parseHomeFilters({ sound: "hard", genre: "Schranz" }).filters,
    ).toMatchObject({ sound: "hard-techno", genre: "Schranz" });
  });

  it("drops unknown values with a notice", () => {
    const { filters, ignored } = parseHomeFilters({
      sound: "polka",
      genre: "Electronic",
    });
    expect(filters.sound).toBeNull();
    expect(filters.genre).toBe("");
    expect(ignored).toEqual(["sound", "genre"]);
  });
});

describe("home facets", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const listings = upcomingListings(demoCatalog, now);

  it("counts families and offers the genres of the chosen one", () => {
    const empty = parseHomeFilters({}).filters;
    const all = homeView(listings, demoCatalog, empty, "en");
    expect(all.sounds.length).toBeGreaterThan(1);
    expect(all.sounds.every((sound) => sound.count > 0)).toBe(true);
    expect(all.genres).toEqual([]);
    const chosen = parseHomeFilters({ sound: "techno" }).filters;
    const view = homeView(listings, demoCatalog, chosen, "en");
    expect(view.genres.map((genre) => genre.label)).toContain("Techno");
    expect(view.results.length).toBeLessThanOrEqual(all.results.length);
  });
});
