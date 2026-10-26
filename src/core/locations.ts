import { citySlug } from "./cities";

export type Location = {
  id: string;
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  sourceUrl: string;
};

// Approximate populated-place centres, never venue coordinates or route lengths.
// Source: GeoNames cities1000 extract, retrieved 2026-10-24:
// https://download.geonames.org/export/dump/cities1000.zip
// WGS84 decimal degrees; each sourceUrl identifies the original GeoNames record.
// https://download.geonames.org/export/dump/readme.txt
// © GeoNames contributors, CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
// Names are localized to the catalogue; coordinates are unchanged from the source.
// Essen is the Ruhr city (05113000); Münster is the NRW city (05515000).
// This is deliberately a curated subset. Unknown locations stay unknown.
export const LOCATIONS: readonly Location[] = [
  {
    id: "nl:amsterdam",
    name: "Amsterdam",
    country: "NL",
    latitude: 52.37403,
    longitude: 4.88969,
    sourceUrl: "https://www.geonames.org/2759794/",
  },
  {
    id: "de:augsburg",
    name: "Augsburg",
    country: "DE",
    latitude: 48.37154,
    longitude: 10.89851,
    sourceUrl: "https://www.geonames.org/2954172/",
  },
  {
    id: "de:bad-klosterlausnitz",
    name: "Bad Klosterlausnitz",
    country: "DE",
    latitude: 50.91667,
    longitude: 11.86667,
    sourceUrl: "https://www.geonames.org/2953421/",
  },
  {
    id: "de:berlin",
    name: "Berlin",
    country: "DE",
    latitude: 52.52437,
    longitude: 13.41053,
    sourceUrl: "https://www.geonames.org/2950159/",
  },
  {
    id: "de:bonn",
    name: "Bonn",
    country: "DE",
    latitude: 50.73438,
    longitude: 7.09549,
    sourceUrl: "https://www.geonames.org/2946447/",
  },
  {
    id: "de:bremen",
    name: "Bremen",
    country: "DE",
    latitude: 53.07582,
    longitude: 8.80717,
    sourceUrl: "https://www.geonames.org/2944388/",
  },
  {
    id: "de:darmstadt",
    name: "Darmstadt",
    country: "DE",
    latitude: 49.87167,
    longitude: 8.65027,
    sourceUrl: "https://www.geonames.org/2938913/",
  },
  {
    id: "nl:den-haag",
    name: "Den Haag",
    country: "NL",
    latitude: 52.07667,
    longitude: 4.29861,
    sourceUrl: "https://www.geonames.org/2747373/",
  },
  {
    id: "de:dortmund",
    name: "Dortmund",
    country: "DE",
    latitude: 51.51494,
    longitude: 7.466,
    sourceUrl: "https://www.geonames.org/2935517/",
  },
  {
    id: "de:dresden",
    name: "Dresden",
    country: "DE",
    latitude: 51.05089,
    longitude: 13.73832,
    sourceUrl: "https://www.geonames.org/2935022/",
  },
  {
    id: "ie:dublin",
    name: "Dublin",
    country: "IE",
    latitude: 53.33306,
    longitude: -6.24889,
    sourceUrl: "https://www.geonames.org/2964574/",
  },
  {
    id: "de:duesseldorf",
    name: "Düsseldorf",
    country: "DE",
    latitude: 51.22319,
    longitude: 6.77927,
    sourceUrl: "https://www.geonames.org/2934246/",
  },
  {
    id: "de:essen",
    name: "Essen",
    country: "DE",
    latitude: 51.45657,
    longitude: 7.01228,
    sourceUrl: "https://www.geonames.org/2928810/",
  },
  {
    id: "de:frankfurt-am-main",
    name: "Frankfurt am Main",
    country: "DE",
    latitude: 50.11552,
    longitude: 8.68417,
    sourceUrl: "https://www.geonames.org/2925533/",
  },
  {
    id: "de:freiburg-im-breisgau",
    name: "Freiburg im Breisgau",
    country: "DE",
    latitude: 47.9959,
    longitude: 7.85222,
    sourceUrl: "https://www.geonames.org/2925177/",
  },
  {
    id: "de:hamburg",
    name: "Hamburg",
    country: "DE",
    latitude: 53.55073,
    longitude: 9.99302,
    sourceUrl: "https://www.geonames.org/2911298/",
  },
  {
    id: "de:hannover",
    name: "Hannover",
    country: "DE",
    latitude: 52.37052,
    longitude: 9.73322,
    sourceUrl: "https://www.geonames.org/2910831/",
  },
  {
    id: "de:heidelberg",
    name: "Heidelberg",
    country: "DE",
    latitude: 49.40768,
    longitude: 8.69079,
    sourceUrl: "https://www.geonames.org/2907911/",
  },
  {
    id: "de:heilbronn",
    name: "Heilbronn",
    country: "DE",
    latitude: 49.13995,
    longitude: 9.22054,
    sourceUrl: "https://www.geonames.org/2907669/",
  },
  {
    id: "de:jena",
    name: "Jena",
    country: "DE",
    latitude: 50.92878,
    longitude: 11.5899,
    sourceUrl: "https://www.geonames.org/2895044/",
  },
  {
    id: "de:karlsruhe",
    name: "Karlsruhe",
    country: "DE",
    latitude: 49.00937,
    longitude: 8.40444,
    sourceUrl: "https://www.geonames.org/2892794/",
  },
  {
    id: "de:konstanz",
    name: "Konstanz",
    country: "DE",
    latitude: 47.66033,
    longitude: 9.17582,
    sourceUrl: "https://www.geonames.org/2885679/",
  },
  {
    id: "de:koeln",
    name: "Köln",
    country: "DE",
    latitude: 50.93333,
    longitude: 6.95,
    sourceUrl: "https://www.geonames.org/2886242/",
  },
  {
    id: "de:leipzig",
    name: "Leipzig",
    country: "DE",
    latitude: 51.33962,
    longitude: 12.37129,
    sourceUrl: "https://www.geonames.org/2879139/",
  },
  {
    id: "de:mainz",
    name: "Mainz",
    country: "DE",
    latitude: 49.98185,
    longitude: 8.28008,
    sourceUrl: "https://www.geonames.org/2874225/",
  },
  {
    id: "de:mannheim",
    name: "Mannheim",
    country: "DE",
    latitude: 49.4891,
    longitude: 8.46694,
    sourceUrl: "https://www.geonames.org/2873891/",
  },
  {
    id: "de:muenchen",
    name: "München",
    country: "DE",
    latitude: 48.13743,
    longitude: 11.57549,
    sourceUrl: "https://www.geonames.org/2867714/",
  },
  {
    id: "de:muenster",
    name: "Münster",
    country: "DE",
    latitude: 51.96236,
    longitude: 7.62571,
    sourceUrl: "https://www.geonames.org/2867543/",
  },
  {
    id: "de:nuernberg",
    name: "Nürnberg",
    country: "DE",
    latitude: 49.45421,
    longitude: 11.07752,
    sourceUrl: "https://www.geonames.org/2861650/",
  },
  {
    id: "de:offenbach-am-main",
    name: "Offenbach am Main",
    country: "DE",
    latitude: 50.10061,
    longitude: 8.76647,
    sourceUrl: "https://www.geonames.org/2857807/",
  },
  {
    id: "de:rheinstetten",
    name: "Rheinstetten",
    country: "DE",
    latitude: 48.9685,
    longitude: 8.30704,
    sourceUrl: "https://www.geonames.org/6558039/",
  },
  {
    id: "de:sindelfingen",
    name: "Sindelfingen",
    country: "DE",
    latitude: 48.7,
    longitude: 9.01667,
    sourceUrl: "https://www.geonames.org/2831948/",
  },
  {
    id: "de:stuttgart",
    name: "Stuttgart",
    country: "DE",
    latitude: 48.78232,
    longitude: 9.17702,
    sourceUrl: "https://www.geonames.org/2825297/",
  },
  {
    id: "de:tuebingen",
    name: "Tübingen",
    country: "DE",
    latitude: 48.52266,
    longitude: 9.05222,
    sourceUrl: "https://www.geonames.org/2820860/",
  },
  {
    id: "de:ulm",
    name: "Ulm",
    country: "DE",
    latitude: 48.39841,
    longitude: 9.99155,
    sourceUrl: "https://www.geonames.org/2820256/",
  },
  {
    id: "de:wiesbaden",
    name: "Wiesbaden",
    country: "DE",
    latitude: 50.08601,
    longitude: 8.24435,
    sourceUrl: "https://www.geonames.org/2809346/",
  },
  {
    id: "de:wuerzburg",
    name: "Würzburg",
    country: "DE",
    latitude: 49.79391,
    longitude: 9.95121,
    sourceUrl: "https://www.geonames.org/2805615/",
  },
];

const countryCodes = new Map([
  ["de", "DE"],
  ["deutschland", "DE"],
  ["germany", "DE"],
  ["nl", "NL"],
  ["niederlande", "NL"],
  ["netherlands", "NL"],
  ["ie", "IE"],
  ["irland", "IE"],
  ["ireland", "IE"],
]);

const locationsById = new Map(
  LOCATIONS.map((location) => [location.id, location]),
);

export function locationFor(
  city: string,
  country: string,
): Location | undefined {
  const code = countryCodes.get(country.trim().toLowerCase());
  const slug = citySlug(city);
  if (!code || !slug) return undefined;
  return locationsById.get(`${code.toLowerCase()}:${slug}`);
}

/** Great-circle distance between two city centres, in kilometres. */
export function distanceKm(
  from: Pick<Location, "latitude" | "longitude">,
  to: Pick<Location, "latitude" | "longitude">,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitude = radians(to.latitude - from.latitude);
  const longitude = radians(to.longitude - from.longitude);
  const chord =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(longitude / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, chord))));
}

export function locationById(id: string): Location | undefined {
  return locationsById.get(id);
}

/** The listed city centre closest to a device position (used on the device only). */
export function nearestLocation(position: {
  latitude: number;
  longitude: number;
}): Location | undefined {
  let best: Location | undefined;
  let bestDistance = Infinity;
  for (const location of LOCATIONS) {
    const distance = distanceKm(position, location);
    if (distance < bestDistance) {
      best = location;
      bestDistance = distance;
    }
  }
  return best;
}
