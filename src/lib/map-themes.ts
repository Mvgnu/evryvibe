// src/lib/map-themes.ts — the EVRYVIBE night map on top of src/lib/itstiles.ts.
// "Nachtkarte": a near-black city with white, wide-tracked place names and
// nothing in colour but the nights themselves. The light theme is the same
// map printed on the site's cool off-white.
import type { Map as MapLibreMap } from "maplibre-gl";
import type { FlavorOverrides, ItstilesFlavor } from "@/lib/itstiles";

export type NightFlavor = Extract<ItstilesFlavor, "dark" | "light">;

const darkGround = "#070707";
const lightGround = "#f3f4f4";

export const nightColors: Record<NightFlavor, FlavorOverrides> = {
  dark: {
    background: darkGround,
    earth: darkGround,
    water: "#16292f",
    buildings: "#181818",
    park_a: "#0c110c",
    park_b: "#0c110c",
    wood_a: "#0b0f0b",
    wood_b: "#0b0f0b",
    scrub_a: "#0b0e0b",
    scrub_b: "#0b0e0b",
    zoo: "#0c110c",
    hospital: "#0d0d0d",
    industrial: "#0d0d0d",
    school: "#0d0d0d",
    pedestrian: "#0f0f0f",
    aerodrome: "#0e0e0e",
    runway: "#1a1a1a",
    pier: "#121212",
    sand: "#0e0e0c",
    beach: "#0e0e0c",
    glacier: "#151a1c",
    military: "#0d0d0d",
    landcover: {
      barren: "#0a0a0a",
      farmland: "#090a09",
      forest: "#0a0d0a",
      glacier: "#151a1c",
      grassland: "#090b09",
      scrub: "#090b09",
      urban_area: "#0c0c0c",
    },
    other: "#121212",
    minor_service: "#121212",
    minor_a: "#151515",
    minor_b: "#171717",
    link: "#1f1f1f",
    major: "#232323",
    highway: "#30302c",
    railway: "#1f1f1f",
    minor_casing: darkGround,
    minor_service_casing: darkGround,
    link_casing: darkGround,
    major_casing_early: darkGround,
    major_casing_late: darkGround,
    highway_casing_early: darkGround,
    highway_casing_late: darkGround,
    tunnel_other: "#0f0f0f",
    tunnel_minor: "#111111",
    tunnel_link: "#161616",
    tunnel_major: "#181818",
    tunnel_highway: "#1f1f1d",
    bridges_other: "#121212",
    bridges_minor: "#171717",
    bridges_link: "#1f1f1f",
    bridges_major: "#232323",
    bridges_highway: "#30302c",
    boundaries: "#3c3c38",
    city_label: "#f1f1ec",
    city_label_halo: darkGround,
    state_label: "#a2a29c",
    state_label_halo: darkGround,
    country_label: "#d4d4cc",
    subplace_label: "#a2a29c",
    subplace_label_halo: darkGround,
    roads_label_major: "#9a9a93",
    roads_label_major_halo: darkGround,
    roads_label_minor: "#85857f",
    roads_label_minor_halo: darkGround,
    address_label: "#85857f",
    address_label_halo: darkGround,
    ocean_label: "#7f9aa1",
    regular: "Noto Sans Medium",
  },
  light: {
    background: lightGround,
    earth: lightGround,
    water: "#c9d3d6",
    buildings: "#e2e4e4",
    park_a: "#e6ebe4",
    park_b: "#e1e8de",
    wood_a: "#e1e8de",
    wood_b: "#dbe3d8",
    pedestrian: "#eceeee",
    pier: "#eceeee",
    landcover: {
      forest: "#e3e8e1",
      grassland: "#ebeeea",
      farmland: "#eff0ee",
      scrub: "#e8ebe7",
      urban_area: "#eceeee",
    },
    other: "#ffffff",
    minor_service: "#ffffff",
    minor_a: "#ffffff",
    minor_b: "#ffffff",
    link: "#ffffff",
    major: "#ffffff",
    highway: "#d4d8d9",
    highway_casing_early: "#bfc4c5",
    highway_casing_late: "#bfc4c5",
    major_casing_early: "#d4d8d9",
    major_casing_late: "#d4d8d9",
    minor_casing: "#dfe2e2",
    railway: "#b5babb",
    boundaries: "#8d9294",
    city_label: "#0a0a0a",
    city_label_halo: lightGround,
    state_label: "#595d5f",
    state_label_halo: lightGround,
    country_label: "#2a2d2e",
    subplace_label: "#595d5f",
    subplace_label_halo: lightGround,
    roads_label_major: "#3d4143",
    roads_label_major_halo: lightGround,
    roads_label_minor: "#4d5153",
    roads_label_minor_halo: lightGround,
    address_label: "#4d5153",
    address_label_halo: lightGround,
    ocean_label: "#4a6168",
    regular: "Noto Sans Medium",
  },
};

/** Colours of EVRYVIBE's own map layers (nights, rings, glow). */
export type NightPaint = {
  ground: string;
  accent: string;
  onAccent: string;
  /** Outline of a dot against the map. */
  edge: string;
  /** Selection, hover and the playing DJ's night. */
  focus: string;
  /** A night with a DJ the visitor liked. */
  liked: string;
  label: string;
  labelHalo: string;
  glowOpacity: number;
  /** Heatmap colour ramp from transparent to the hottest spot. */
  heat: [string, string, string, string];
  extrusion: string;
};

export const nightPaint: Record<NightFlavor, NightPaint> = {
  dark: {
    ground: darkGround,
    accent: "#d8ff00",
    onAccent: "#0a0a0a",
    edge: darkGround,
    focus: "#ffffff",
    liked: "#ffffff",
    label: "#f1f1ec",
    labelHalo: darkGround,
    glowOpacity: 0.42,
    heat: [
      "rgba(216, 255, 0, 0.07)",
      "rgba(216, 255, 0, 0.28)",
      "rgba(216, 255, 0, 0.62)",
      "rgba(241, 255, 170, 0.9)",
    ],
    extrusion: "#171717",
  },
  light: {
    ground: lightGround,
    accent: "#d8ff00",
    onAccent: "#0a0a0a",
    edge: "#0a0a0a",
    focus: "#0a0a0a",
    liked: "#0a0a0a",
    label: "#0a0a0a",
    labelHalo: lightGround,
    glowOpacity: 0.55,
    heat: [
      "rgba(10, 10, 10, 0.04)",
      "rgba(10, 10, 10, 0.12)",
      "rgba(150, 190, 0, 0.45)",
      "rgba(216, 255, 0, 0.85)",
    ],
    extrusion: "#e0e3e3",
  },
};

// Basemap layers that only add noise under a map of nights.
const hidden = ["pois", "address_label", "roads_shields", "roads_oneway"];

// Place names in wide-tracked capitals, like a flyer's small print.
const tracking: [layer: string, spacing: number][] = [
  ["places_country", 0.3],
  ["places_region", 0.22],
  ["places_locality", 0.12],
  ["places_subplace", 0.16],
];

export const EXTRUSION_LAYER = "night-buildings-3d";

/**
 * Layer edits on top of the itstiles style; runs after every style load.
 * Returns the id own layers should be inserted before (the first label).
 */
export function tuneNightStyle(
  map: MapLibreMap,
  flavor: NightFlavor,
): string | undefined {
  for (const id of hidden)
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  for (const [id, spacing] of tracking) {
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, "text-transform", "uppercase");
    map.setLayoutProperty(id, "text-letter-spacing", spacing);
  }
  // The town dots under city names would read as more nights.
  if (map.getLayer("places_locality"))
    map.setLayoutProperty("places_locality", "icon-image", "");
  const firstLabel = map
    .getStyle()
    .layers.find((layer) => layer.type === "symbol")?.id;
  // Close in, the flat footprints rise into blocks: arriving at the club.
  if (map.getLayer("buildings") && !map.getLayer(EXTRUSION_LAYER)) {
    map.setLayerZoomRange("buildings", 0, 14);
    map.addLayer(
      {
        id: EXTRUSION_LAYER,
        type: "fill-extrusion",
        source: "protomaps",
        "source-layer": "buildings",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": nightPaint[flavor].extrusion,
          "fill-extrusion-height": ["coalesce", ["get", "height"], 6],
          "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
          "fill-extrusion-opacity": 0.92,
        },
      },
      firstLabel,
    );
  }
  return firstLabel;
}

/** WCAG contrast ratio of two #rrggbb colours (≥ 4.5 for label text on land). */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0);
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
