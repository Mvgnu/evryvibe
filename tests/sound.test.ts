import { describe, expect, it } from "vitest";
import { posterSeed, soundFamily } from "../src/core/sound";

// Which genre draws which motif is declared by the taxonomy (genres.test.ts).
describe("poster motif resolution", () => {
  it("falls back to techno for empty or unknown genres", () => {
    expect(soundFamily([])).toBe("techno");
    expect(soundFamily(["Jazz", "Schlager"])).toBe("techno");
    expect(soundFamily(["Techno"])).toBe("techno");
  });

  it("lets the first matching genre decide", () => {
    expect(soundFamily(["Acid", "Techno"])).toBe("acid");
    expect(soundFamily(["Techno", "Acid"])).toBe("techno");
    expect(soundFamily(["Jazz", "House", "Techno"])).toBe("house");
    expect(soundFamily(["Trance", "Progressive"])).toBe("trance");
  });

  it("prefers a specific keyword over a generic one inside a genre", () => {
    expect(soundFamily(["Dub Techno"])).toBe("dub");
    expect(soundFamily(["Hard Techno"])).toBe("hard");
    expect(soundFamily(["Acid Techno"])).toBe("acid");
    expect(soundFamily(["Acid House"])).toBe("acid");
    expect(soundFamily(["Tech House"])).toBe("house");
    expect(soundFamily(["Progressive House"])).toBe("house");
    expect(soundFamily(["Minimal Techno"])).toBe("dub");
  });

  it("matches whole words, not fragments", () => {
    expect(soundFamily(["Dubstep"])).toBe("breaks");
    expect(soundFamily(["Electronic"])).toBe("techno");
    expect(soundFamily(["Electro"])).toBe("electro");
  });

  it("maps the documented families", () => {
    expect(soundFamily(["Industrial"])).toBe("hard");
    expect(soundFamily(["Schranz"])).toBe("hard");
    expect(soundFamily(["EBM"])).toBe("hard");
    expect(soundFamily(["Disco"])).toBe("house");
    expect(soundFamily(["UK Garage"])).toBe("breaks");
    expect(soundFamily(["Jungle"])).toBe("breaks");
    expect(soundFamily(["Experimental"])).toBe("ambient");
    expect(soundFamily(["Psytrance"])).toBe("trance");
  });

  it("ignores case, diacritics and punctuation", () => {
    expect(soundFamily(["DRUM & BASS"])).toBe("breaks");
    expect(soundFamily(["drum'n'bass"])).toBe("breaks");
    expect(soundFamily(["D&B"])).toBe("breaks");
    expect(soundFamily(["  hard-techno "])).toBe("hard");
    expect(soundFamily(["Ámbient"])).toBe("ambient");
  });
});

describe("poster seed", () => {
  it("is stable, unsigned and varies by slug", () => {
    expect(posterSeed("kaltstart")).toBe(posterSeed("kaltstart"));
    expect(posterSeed("kaltstart")).not.toBe(posterSeed("drift"));
    for (const slug of ["", "a", "303-ritual", "offene-tueren"]) {
      const seed = posterSeed(slug);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    }
  });
});
