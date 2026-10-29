import { describe, expect, it } from "vitest";
import {
  geocodeQuerySchema,
  parseNominatimResponse,
} from "../src/core/geocoding";

describe("Nominatim boundaries", () => {
  it("converts validated OSM matches and preserves provenance", () => {
    expect(
      parseNominatimResponse([
        {
          osm_type: "way",
          osm_id: 123,
          display_name: "Club, Berlin",
          lat: "52.5",
          lon: "13.4",
        },
      ]),
    ).toEqual([
      {
        id: "way/123",
        name: "Club, Berlin",
        latitude: 52.5,
        longitude: 13.4,
        sourceUrl: "https://www.openstreetmap.org/way/123",
      },
    ]);
  });
  it("rejects malformed coordinates, invalid OSM ids and oversized or empty queries", () => {
    expect(() =>
      parseNominatimResponse([
        {
          osm_type: "node",
          osm_id: 1,
          display_name: "Bad",
          lat: "91",
          lon: "13",
        },
      ]),
    ).toThrow();
    expect(() =>
      parseNominatimResponse([
        {
          osm_type: "node",
          osm_id: "../hack",
          display_name: "Bad",
          lat: "52",
          lon: "13",
        },
      ]),
    ).toThrow();
    expect(geocodeQuerySchema.safeParse({ query: " " }).success).toBe(false);
    expect(
      geocodeQuerySchema.safeParse({ query: "x".repeat(201) }).success,
    ).toBe(false);
  });
});
