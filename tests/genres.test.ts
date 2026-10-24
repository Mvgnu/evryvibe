import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalGenre,
  canonicalGenres,
  droppedGenreWarnings,
  familyOfGenre,
  genreFamilies,
  genreKey,
  normalizeGenres,
} from "../src/core/genres";
import { soundFamilies, soundFamily } from "../src/core/sound";

// Every distinct genre string in production (genre, events, DJs, total) and
// the decision for it: a canonical name, or null when it is dropped. Nothing
// maps silently: a new string in the fixture fails until it is decided here.
const decisions: [string, string | null][] = [
  ["Techno", "Techno"],
  ["House", "House"],
  ["Hard Techno", "Hard Techno"],
  ["Trance", "Trance"],
  ["Electronic", null],
  ["Electro", "Electro"],
  ["Melodic Techno", "Melodic Techno"],
  ["Drum & Bass", "Drum & Bass"],
  ["Schranz", "Schranz"],
  ["Tech House", "Tech House"],
  ["Hardgroove", "Hardgroove"],
  ["Bounce", "Hard Bounce"],
  ["Disco", "Disco"],
  ["Hard Bounce", "Hard Bounce"],
  ["Hypnotic Techno", "Hypnotic Techno"],
  ["Psytrance", "Psytrance"],
  ["Bass", "Bass Music"],
  ["Breaks", "Breakbeat"],
  ["Progressive House", "Progressive House"],
  ["Acid", "Acid Techno"],
  ["Dubstep", "Dubstep"],
  ["Melodic House", "Melodic House"],
  ["Industrial Techno", "Industrial Techno"],
  ["Hard Trance", "Hard Trance"],
  ["Groove Techno", "Groove Techno"],
  ["Hard House", "Hard House"],
  ["Tekk", "Tekk"],
  ["Minimal Techno", "Minimal Techno"],
  ["Deep House", "Deep House"],
  ["Italo Disco", "Italo Disco"],
  ["Hardcore", "Hardcore"],
  ["Acid Techno", "Acid Techno"],
  ["Raw Techno", "Raw Techno"],
  ["Hard Dance", "Hard Dance"],
  ["Indie Dance", "Indie Dance"],
  ["Dub Techno", "Dub Techno"],
  ["Minimal", "Minimal Techno"],
  ["Uptempo", "Uptempo"],
  ["Breakbeat", "Breakbeat"],
  ["Psytechno", "Psytechno"],
  ["Afro House", "Afro House"],
  ["EBM", "EBM"],
  ["Darkprog", "Darkprog"],
  ["Experimental", "Experimental"],
  ["Tekno", "Tekno"],
  ["UK Garage", "UK Garage"],
  ["Industrial", "Industrial Techno"],
  ["Deep Techno", "Deep Techno"],
  ["Driving Techno", "Peak Time Techno"],
  ["Psy Techno", "Psytechno"],
  ["Ambient", "Ambient"],
  ["Hardstyle", "Hardstyle"],
  ["Gabber", "Gabber"],
  ["Peak Time Techno", "Peak Time Techno"],
  ["Downtempo", "Downtempo"],
  ["Groove", null],
  ["Rave", null],
  ["Electronica", "Electronica"],
  ["Speed House", "Speed House"],
  ["Minimal House", "Minimal House"],
  ["Progressive Techno", "Progressive Techno"],
  ["Garage", "UK Garage"],
  ["Speedhouse", "Speed House"],
  ["Afro Tech", "Afro Tech"],
  ["Dark Disco", "Dark Disco"],
  ["Deep Tech", "Deep Tech"],
  ["Full-On", "Full-On"],
  ["Happy Hardcore", "Happy Hardcore"],
  ["Hardbounce", "Hard Bounce"],
  ["Industrial Hardstyle", "Industrial Hardstyle"],
  ["Mental", null],
  ["Minimal Deep Tech", "Minimal House"],
  ["Peak-Time Techno", "Peak Time Techno"],
  ["Progressive Psytrance", "Progressive Psytrance"],
  ["Psy Tech", "Psytechno"],
  ["Tribe", "Tribe"],
  ["Micro House", "Minimal House"],
  ["Hyperpop", "Hyperpop"],
  ["Wave", "Wave"],
  ["Hip-Hop", "Hip-Hop"],
  ["Hardtek", "Hardtek"],
  ["Neurofunk", "Neurofunk"],
  ["New Beat", "New Beat"],
  ["Nu Disco", "Nu Disco"],
  ["Grime", "Grime"],
  ["UK Club", "UK Bass"],
  ["Performance", null],
  ["Post Punk", "Post Punk"],
  ["Progressive", null],
  ["Goa", "Goa Trance"],
  ["Baile Funk", "Baile Funk"],
  ["Ghettotech", "Ghettotech"],
  ["Progressive Trance", "Progressive Trance"],
  ["Psychedelic Tech", "Psytechno"],
  ["Psytech", "Psytechno"],
  ["Acid Trance", "Acid Trance"],
  ["Funky Groove", null],
  ["Forest", "Forest Psytrance"],
  ["Experimental Techno", "Experimental Techno"],
  ["Electro Tech", null],
  ["Rawstyle", "Rawstyle"],
  ["Electro House", "Electro House"],
  ["Reverse Bass", "Hardstyle"],
  ["Riddim", "Riddim"],
  ["Disco House", "Disco House"],
  ["Soul", "Funk & Soul"],
  ["Deathstep", "Deathstep"],
  ["Chicago House", "Chicago House"],
  ["Synthpop", "Synthpop"],
  ["Synthwave", "Synthwave"],
  ["Bouyon", "Bouyon"],
  ["Bouncy Techno", "Hard Bounce"],
  ["Boogie", "Boogie"],
  ["Big Beat", "Big Beat"],
  ["Batida", "Batida"],
  ["Trap", "Trap"],
  ["Liquid Drum & Bass", "Liquid Drum & Bass"],
  ["Live Electronic", null],
  ["Indiedance", "Indie Dance"],
  ["Hypnotic", "Hypnotic Techno"],
  ["Tribal Techno", "Tribal Techno"],
  ["Microhouse", "Minimal House"],
];

describe("production genre strings", () => {
  const fixture = readFileSync("tests/fixtures/prod-genres.tsv", "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t")[0] ?? "");

  it("has an explicit decision for every string, and only for those", () => {
    expect(decisions.map(([raw]) => raw).sort()).toEqual([...fixture].sort());
  });

  it.each(decisions)("%s -> %s", (raw, expected) => {
    expect(canonicalGenre(raw)?.name ?? null).toBe(expected);
  });
});

describe("taxonomy shape", () => {
  it("has ordered families, unique slugs and names, and valid motifs", () => {
    expect(genreFamilies.map((family) => family.order)).toEqual(
      genreFamilies.map((_, index) => index),
    );
    expect(new Set(canonicalGenres.map((genre) => genre.slug)).size).toBe(
      canonicalGenres.length,
    );
    for (const family of genreFamilies) {
      expect(family.genres.length).toBeGreaterThan(0);
      expect(soundFamilies).toContain(family.motif);
      for (const genre of family.genres) {
        expect(genre.family).toBe(family.slug);
        expect(soundFamilies).toContain(genre.motif);
        expect(canonicalGenre(genre.name)).toBe(genre);
        expect(canonicalGenre(genre.slug)).toBe(genre);
        for (const alias of genre.aliases)
          expect(canonicalGenre(alias)).toBe(genre);
      }
    }
  });

  it("covers the breadth of techno", () => {
    const techno = genreFamilies.find((family) => family.slug === "techno");
    expect(techno?.genres.map((genre) => genre.name)).toEqual(
      expect.arrayContaining([
        "Peak Time Techno",
        "Hypnotic Techno",
        "Dub Techno",
        "Minimal Techno",
        "Melodic Techno",
        "Hardgroove",
        "Acid Techno",
        "Detroit Techno",
        "Psytechno",
      ]),
    );
  });
});

describe("canonicalGenre", () => {
  it.each([
    ["peak-time techno", "Peak Time Techno"],
    ["PEAKTIME TECHNO", "Peak Time Techno"],
    ["Speedhouse", "Speed House"],
    ["speed-house", "Speed House"],
    ["Indiedance", "Indie Dance"],
    ["Hardbounce", "Hard Bounce"],
    ["DnB", "Drum & Bass"],
    ["D&B", "Drum & Bass"],
    ["drum'n'bass", "Drum & Bass"],
    ["Drum and Bass", "Drum & Bass"],
    ["drum n bass", "Drum & Bass"],
    ["Liquid DnB", "Liquid Drum & Bass"],
    ["Hip Hop", "Hip-Hop"],
    ["  hard-techno ", "Hard Techno"],
    ["Ámbient", "Ambient"],
    ["Funk/Soul", "Funk & Soul"],
  ])("%s -> %s", (raw, expected) => {
    expect(canonicalGenre(raw)?.name).toBe(expected);
  });

  it("keeps distinct subgenres distinct", () => {
    const names = ["Tekk", "Tekno", "Hardtek", "Tribe", "Hard Bounce"].map(
      (raw) => canonicalGenre(raw)?.name,
    );
    expect(new Set(names).size).toBe(5);
    expect(canonicalGenre("Deep House")).not.toBe(canonicalGenre("Deep Tech"));
    expect(canonicalGenre("Hardstyle")).not.toBe(canonicalGenre("Rawstyle"));
  });

  it("finds the family of a genre", () => {
    expect(familyOfGenre("Schranz")?.slug).toBe("hard-techno");
    expect(familyOfGenre("Hard House")?.slug).toBe("house");
    expect(familyOfGenre("Electronic")).toBeNull();
  });

  it("produces collision-free keys", () => {
    expect(genreKey("Drum & Bass")).toBe(genreKey("drum'n'bass"));
    expect(genreKey("Techno")).not.toBe(genreKey("Tekno"));
  });
});

describe("normalizeGenres", () => {
  it("returns canonical names, deduplicated in order, with the dropped rest", () => {
    expect(
      normalizeGenres([
        "Driving Techno",
        "Electronic",
        "Peak-Time Techno",
        "Hypnotic",
        "Rave",
        "Electronic",
        "  ",
      ]),
    ).toEqual({
      genres: ["Peak Time Techno", "Hypnotic Techno"],
      dropped: ["Electronic", "Rave"],
    });
    expect(normalizeGenres([])).toEqual({ genres: [], dropped: [] });
  });

  it("is idempotent", () => {
    const once = normalizeGenres(["Bounce", "Acid", "Garage"]).genres;
    expect(normalizeGenres(once)).toEqual({ genres: once, dropped: [] });
  });

  it("words the non-blocking warning", () => {
    expect(droppedGenreWarnings(["Rave"], "dj kaltstart")).toEqual([
      "dj kaltstart: Dropped unknown genre 'Rave'; see list_genres",
    ]);
  });
});

describe("poster motif follows the taxonomy", () => {
  it("draws every genre with the motif the taxonomy declares", () => {
    for (const genre of canonicalGenres) {
      expect(soundFamily([genre.name])).toBe(genre.motif);
      for (const alias of genre.aliases)
        expect(soundFamily([alias])).toBe(genre.motif);
    }
  });
});
