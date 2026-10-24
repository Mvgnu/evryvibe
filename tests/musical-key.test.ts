import { describe, expect, it } from "vitest";
import {
  CAMELOT_KEYS,
  compatibleKeys,
  parseMusicalKey,
} from "../src/core/musical-key";

describe("Camelot reference", () => {
  // Independent expected conversions from Mixed In Key's published key chart.
  it.each([
    ["G# minor", "1A"],
    ["B major", "1B"],
    ["D# minor", "2A"],
    ["F# major", "2B"],
    ["A# minor", "3A"],
    ["Db major", "3B"],
    ["F minor", "4A"],
    ["Ab major", "4B"],
    ["C minor", "5A"],
    ["Eb major", "5B"],
    ["G minor", "6A"],
    ["Bb major", "6B"],
    ["D minor", "7A"],
    ["F major", "7B"],
    ["A minor", "8A"],
    ["C major", "8B"],
    ["E minor", "9A"],
    ["G major", "9B"],
    ["B minor", "10A"],
    ["D major", "10B"],
    ["F# minor", "11A"],
    ["A major", "11B"],
    ["C# minor", "12A"],
    ["E major", "12B"],
  ])("converts %s to %s", (name, key) => {
    expect(parseMusicalKey(name)).toBe(key);
  });

  it("orders all 24 keys by number and mode and uses coherent translated names", () => {
    expect(CAMELOT_KEYS.map(({ key }) => key)).toEqual([
      "1A",
      "1B",
      "2A",
      "2B",
      "3A",
      "3B",
      "4A",
      "4B",
      "5A",
      "5B",
      "6A",
      "6B",
      "7A",
      "7B",
      "8A",
      "8B",
      "9A",
      "9B",
      "10A",
      "10B",
      "11A",
      "11B",
      "12A",
      "12B",
    ]);
    for (const entry of CAMELOT_KEYS) {
      expect(parseMusicalKey(entry.nameDe)).toBe(entry.key);
      expect(parseMusicalKey(entry.nameEn)).toBe(entry.key);
    }
  });

  it.each([
    ["A♭ minor", "1A"],
    ["E♭ minor", "2A"],
    ["G♭ major", "2B"],
    ["B♭ minor", "3A"],
    ["C♯ major", "3B"],
    ["D♭ minor", "12A"],
    ["F-sharp minor", "11A"],
    ["B flat major", "6B"],
    ["Am", "8A"],
    ["F#m", "11A"],
    ["C#M", "3B"],
    ["H-Dur", "1B"],
    ["B-Dur", "6B"],
    ["B-Moll", "3A"],
    ["H-Moll", "10A"],
    ["Bm", "10A"],
    ["BM", "1B"],
    ["Ces-Dur", "1B"],
    ["Cb major", "1B"],
    ["E# minor", "4A"],
    ["  12a  ", "12A"],
    ["8b", "8B"],
  ])("recognizes explicit enharmonic or localized notation %s", (name, key) => {
    expect(parseMusicalKey(name)).toBe(key);
  });

  it.each([
    undefined,
    null,
    8,
    {},
    [],
    "",
    "B",
    "H",
    "C",
    "F#",
    "unknown",
    "0A",
    "13B",
    "8C",
    "A minor / C major",
    "mostly A minor",
    "C dorian",
    "130 bpm",
    "C## major",
  ])(
    "leaves missing, ambiguous or unsupported metadata unknown: %s",
    (value) => {
      expect(parseMusicalKey(value)).toBeNull();
    },
  );

  it("wraps at 1 and 12 and crosses only to the same-number relative mode", () => {
    expect(compatibleKeys("1A")).toEqual(["1A", "12A", "2A", "1B"]);
    expect(compatibleKeys("12B")).toEqual(["12B", "11B", "1B", "12A"]);
    expect(compatibleKeys("8A")).toEqual(["8A", "7A", "9A", "8B"]);
    expect(compatibleKeys("8A")).not.toContain("7B");
    for (const { key } of CAMELOT_KEYS) {
      expect(new Set(compatibleKeys(key)).size).toBe(4);
      for (const neighbour of compatibleKeys(key))
        expect(compatibleKeys(neighbour)).toContain(key);
    }
  });
});
