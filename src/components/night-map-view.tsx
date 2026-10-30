"use client";

// The MapLibre side of the night map. Loaded lazily by NightExplorer: this is
// the only module of the page that pulls MapLibre itself. It draws the nights
// as glowing points (exact venues), rings (approximate city centres) and
// clusters, and reports which points are in view and which one was chosen.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  GeoJSONSource,
  Marker,
  type GeoJSONSourceSpecification,
  type LngLatBoundsLike,
  type Map as MapLibreMap,
  type MapMouseEvent,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Point } from "geojson";
import ItstilesMap from "@/components/ItstilesMap";
import type { Locale } from "@/core/i18n";
import type { MapPrecision } from "@/core/night-map";
import {
  nightColors,
  nightPaint,
  tuneNightStyle,
  type NightFlavor,
} from "@/lib/map-themes";

export type PlacePoint = {
  key: string;
  precision: MapPrecision;
  latitude: number;
  longitude: number;
  label: string;
  nights: number;
  tonight: boolean;
  liked: boolean;
};

export type MapFocus = {
  selected: string | null;
  active: string | null;
  playing: string | null;
};

export type MapCommand =
  | { seq: number; kind: "fit" }
  | { seq: number; kind: "place"; key: string }
  | { seq: number; kind: "reveal"; key: string }
  | { seq: number; kind: "position"; latitude: number; longitude: number }
  | {
      seq: number;
      kind: "frame";
      points: { latitude: number; longitude: number }[];
    }
  | {
      seq: number;
      kind: "area";
      latitude: number;
      longitude: number;
      radiusKm: number;
    };

export type NightMapViewProps = {
  locale: Locale;
  flavor: NightFlavor;
  places: PlacePoint[];
  focus: MapFocus;
  /** Full screen: plain one-finger gestures instead of cooperative ones. */
  expanded: boolean;
  command: MapCommand | null;
  /** The visitor's position from "In meiner Nähe"; never stored. */
  position: { latitude: number; longitude: number } | null;
  onSelect: (key: string | null) => void;
  /** Keys of the points inside the visible area, after every move. */
  onView: (keys: string[]) => void;
  onReady: () => void;
};

const GERMANY: [number, number] = [10.4, 51.1];
const SOURCE = "nm-nights";
const HEAT_SOURCE = "nm-heat";
const FOCUS_SOURCE = "nm-focus";
const CLICKABLE = ["nm-cluster", "nm-city", "nm-venue"];

// GeoNames supplies the approximate city centres (CC BY 4.0).
const GEONAMES =
  '<a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0)';

type Props = {
  key: string;
  precision: MapPrecision;
  label: string;
  nights: number;
  tonight: number;
  liked: number;
};

function collection(
  places: readonly PlacePoint[],
): FeatureCollection<Point, Props> {
  return {
    type: "FeatureCollection",
    features: places.map((place): Feature<Point, Props> => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [place.longitude, place.latitude],
      },
      properties: {
        key: place.key,
        precision: place.precision,
        label: place.label,
        nights: place.nights,
        tonight: place.tonight ? 1 : 0,
        liked: place.liked ? 1 : 0,
      },
    })),
  };
}

function focusCollection(
  places: readonly PlacePoint[],
  focus: MapFocus,
): FeatureCollection<Point, { role: string; precision: MapPrecision }> {
  const roles: [string, string | null][] = [
    ["active", focus.active],
    ["selected", focus.selected],
    ["playing", focus.playing],
  ];
  return {
    type: "FeatureCollection",
    features: roles.flatMap(([role, key]) => {
      const place = key ? places.find((entry) => entry.key === key) : null;
      return place
        ? [
            {
              type: "Feature" as const,
              geometry: {
                type: "Point" as const,
                coordinates: [place.longitude, place.latitude],
              },
              properties: { role, precision: place.precision },
            },
          ]
        : [];
    }),
  };
}

/**
 * Room for the tools and legend in the top-left corner and the zoom buttons
 * on the right, so a framed point never hides under them.
 */
function framePadding(map: MapLibreMap) {
  const container = map.getContainer();
  const hud = container
    .closest(".nm-canvas")
    ?.querySelector(".nm-hud")
    ?.getBoundingClientRect().height;
  const top = Math.min((hud ?? 0) + 28, container.clientHeight / 2.5);
  return { top, right: 60, bottom: 52, left: 30 };
}

/** Inside the visible map, clear of the tools on top and the credit below. */
function comfortablyVisible(map: MapLibreMap, center: [number, number]) {
  const padding = framePadding(map);
  const container = map.getContainer();
  const point = map.project(center);
  return (
    point.x >= padding.left &&
    point.x <= container.clientWidth - padding.left &&
    point.y >= padding.top &&
    point.y <= container.clientHeight - padding.bottom
  );
}

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function boundsOf(
  points: readonly { latitude: number; longitude: number }[],
): LngLatBoundsLike | null {
  const first = points[0];
  if (!first) return null;
  let [west, south, east, north] = [
    first.longitude,
    first.latitude,
    first.longitude,
    first.latitude,
  ];
  for (const point of points) {
    west = Math.min(west, point.longitude);
    east = Math.max(east, point.longitude);
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
  }
  return [
    [west, south],
    [east, north],
  ];
}

function addNightLayers(
  map: MapLibreMap,
  flavor: NightFlavor,
  beforeLabels: string | undefined,
  places: readonly PlacePoint[],
  focus: MapFocus,
) {
  const paint = nightPaint[flavor];
  const data = collection(places);
  const clustered: GeoJSONSourceSpecification = {
    type: "geojson",
    data,
    cluster: true,
    clusterRadius: 36,
    clusterMaxZoom: 10,
    clusterProperties: {
      nights: ["+", ["get", "nights"]],
      tonight: ["max", ["get", "tonight"]],
      liked: ["max", ["get", "liked"]],
    },
    attribution: GEONAMES,
  };
  map.addSource(SOURCE, clustered);
  map.addSource(HEAT_SOURCE, { type: "geojson", data });
  map.addSource(FOCUS_SOURCE, {
    type: "geojson",
    data: focusCollection(places, focus),
  });

  // Under the place names: the heat of a busy region and the glow of a point.
  map.addLayer(
    {
      id: "nm-heat",
      type: "heatmap",
      source: HEAT_SOURCE,
      maxzoom: 11,
      paint: {
        "heatmap-weight": [
          "interpolate",
          ["linear"],
          ["get", "nights"],
          1,
          0.5,
          12,
          1,
        ],
        "heatmap-intensity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          3,
          1.4,
          10,
          2.4,
        ],
        "heatmap-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          3,
          30,
          6,
          58,
          10,
          96,
        ],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(0, 0, 0, 0)",
          0.12,
          paint.heat[0],
          0.4,
          paint.heat[1],
          0.72,
          paint.heat[2],
          1,
          paint.heat[3],
        ],
        "heatmap-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          3,
          0.95,
          8,
          0.7,
          11,
          0,
        ],
      },
    },
    beforeLabels,
  );
  map.addLayer(
    {
      id: "nm-glow",
      type: "circle",
      source: SOURCE,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["get", "nights"],
          1,
          46,
          10,
          70,
          40,
          96,
        ],
        "circle-color": paint.accent,
        "circle-blur": 1,
        "circle-opacity": paint.glowOpacity,
      },
    },
    beforeLabels,
  );

  // Above the basemap labels: the points themselves.
  map.addLayer({
    id: "nm-cluster",
    type: "circle",
    source: SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["get", "nights"],
        2,
        15,
        10,
        20,
        60,
        30,
      ],
      "circle-color": paint.accent,
      "circle-stroke-color": paint.edge,
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "nm-city",
    type: "circle",
    source: SOURCE,
    filter: [
      "all",
      ["!", ["has", "point_count"]],
      ["==", ["get", "precision"], "city"],
    ],
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["get", "nights"],
        1,
        14,
        10,
        21,
        40,
        28,
      ],
      "circle-color": paint.ground,
      "circle-opacity": 0.86,
      "circle-stroke-color": flavor === "dark" ? paint.accent : paint.edge,
      "circle-stroke-width": 3,
    },
  });
  map.addLayer({
    id: "nm-venue",
    type: "circle",
    source: SOURCE,
    filter: [
      "all",
      ["!", ["has", "point_count"]],
      ["==", ["get", "precision"], "venue"],
    ],
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        8,
        ["interpolate", ["linear"], ["get", "nights"], 1, 6, 10, 10],
        15,
        ["interpolate", ["linear"], ["get", "nights"], 1, 10, 10, 15],
      ],
      "circle-color": paint.accent,
      "circle-stroke-color": paint.edge,
      "circle-stroke-width": 2,
      "circle-pitch-alignment": "map",
    },
  });
  // A thin outer ring: a DJ the visitor liked plays here.
  map.addLayer({
    id: "nm-liked",
    type: "circle",
    source: SOURCE,
    filter: ["==", ["get", "liked"], 1],
    paint: {
      "circle-radius": [
        "case",
        ["has", "point_count"],
        ["interpolate", ["linear"], ["get", "nights"], 2, 21, 10, 26, 60, 36],
        ["==", ["get", "precision"], "city"],
        ["interpolate", ["linear"], ["get", "nights"], 1, 19, 10, 25, 40, 32],
        ["interpolate", ["linear"], ["get", "nights"], 1, 12, 10, 17],
      ],
      "circle-pitch-alignment": "map",
      "circle-color": "rgba(0, 0, 0, 0)",
      "circle-stroke-color": paint.liked,
      "circle-stroke-width": 1.5,
      "circle-stroke-opacity": 0.9,
    },
  });
  map.addLayer({
    id: "nm-focus",
    type: "circle",
    source: FOCUS_SOURCE,
    paint: {
      "circle-radius": [
        "match",
        ["get", "role"],
        "playing",
        30,
        "selected",
        26,
        22,
      ],
      "circle-pitch-alignment": "map",
      "circle-color": "rgba(0, 0, 0, 0)",
      "circle-stroke-color": [
        "match",
        ["get", "role"],
        "playing",
        paint.accent,
        paint.focus,
      ],
      "circle-stroke-width": ["match", ["get", "role"], "active", 1.5, 3],
    },
  });
  map.addLayer({
    id: "nm-count",
    type: "symbol",
    source: SOURCE,
    filter: [
      "any",
      ["has", "point_count"],
      [">", ["get", "nights"], 1],
      ["==", ["get", "precision"], "city"],
    ],
    layout: {
      "text-field": ["to-string", ["get", "nights"]],
      "text-font": ["Noto Sans Medium"],
      "text-size": 12,
      "text-allow-overlap": true,
      // Claims the point's space: basemap names step aside instead of
      // running through the ring.
      "text-padding": 16,
    },
    paint: {
      "text-color": [
        "case",
        [
          "all",
          ["!", ["has", "point_count"]],
          ["==", ["get", "precision"], "city"],
        ],
        flavor === "dark" ? paint.accent : paint.label,
        paint.onAccent,
      ],
    },
  });
  const label = (id: string, precision: MapPrecision, minzoom: number) =>
    map.addLayer({
      id,
      type: "symbol",
      source: SOURCE,
      minzoom,
      filter: [
        "all",
        ["!", ["has", "point_count"]],
        ["==", ["get", "precision"], precision],
      ],
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Medium"],
        "text-size": 12,
        "text-transform": "uppercase",
        "text-letter-spacing": 0.1,
        "text-anchor": "top",
        "text-offset": [0, precision === "city" ? 2.1 : 1.3],
        "text-optional": true,
        "text-max-width": 9,
      },
      paint: {
        "text-color": paint.label,
        "text-halo-color": paint.labelHalo,
        "text-halo-width": 1.6,
      },
    });
  label("nm-label-venue", "venue", 12);
  label("nm-label-city", "city", 5);
}

export default function NightMapView({
  locale,
  flavor,
  places,
  focus,
  expanded,
  command,
  position,
  onSelect,
  onView,
  onReady,
}: NightMapViewProps) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  // Latest props for MapLibre callbacks, updated after render.
  const latest = useRef({ places, focus, onSelect, onView, onReady, flavor });
  useEffect(() => {
    latest.current = { places, focus, onSelect, onView, onReady, flavor };
  });
  const wired = useRef(new WeakSet<MapLibreMap>());

  const reportView = useCallback((target: MapLibreMap) => {
    const bounds = target.getBounds();
    latest.current.onView(
      latest.current.places
        .filter((place) => bounds.contains([place.longitude, place.latitude]))
        .map((place) => place.key),
    );
  }, []);

  const onStyleLoad = useCallback(
    (target: MapLibreMap) => {
      const current = latest.current;
      const beforeLabels = tuneNightStyle(target, current.flavor);
      addNightLayers(
        target,
        current.flavor,
        beforeLabels,
        current.places,
        current.focus,
      );
      target.setMaxPitch(60);
      if (!wired.current.has(target)) {
        wired.current.add(target);
        const hits = (event: MapMouseEvent) => {
          const layers = CLICKABLE.filter((id) => target.getLayer(id));
          return layers.length
            ? target.queryRenderedFeatures(event.point, { layers })
            : [];
        };
        target.on("click", (event) => {
          const [hit] = hits(event);
          if (!hit) return latest.current.onSelect(null);
          const clusterId: unknown = hit.properties.cluster_id;
          const source = target.getSource(SOURCE);
          if (
            typeof clusterId === "number" &&
            source instanceof GeoJSONSource
          ) {
            if (hit.geometry.type !== "Point") return;
            const [lng, lat] = hit.geometry.coordinates;
            if (typeof lng !== "number" || typeof lat !== "number") return;
            source
              .getClusterExpansionZoom(clusterId)
              .then((zoom) =>
                target.easeTo({
                  center: [lng, lat],
                  zoom: Math.min(zoom + 0.5, 15),
                  duration: reducedMotion() ? 0 : 600,
                }),
              )
              .catch(() => undefined);
            return;
          }
          const key: unknown = hit.properties.key;
          if (typeof key === "string") latest.current.onSelect(key);
        });
        target.on("mousemove", (event) => {
          target.getCanvas().style.cursor = hits(event).length ? "pointer" : "";
        });
        target.on("moveend", () => reportView(target));
        // The player docking or full screen changes the map's size; keep the
        // night that is playing (or chosen) on screen.
        target.on("resize", () => {
          const { focus, places: current } = latest.current;
          const key = focus.playing ?? focus.selected;
          const place = key
            ? current.find((entry) => entry.key === key)
            : undefined;
          if (!place) return;
          const center: [number, number] = [place.longitude, place.latitude];
          if (!comfortablyVisible(target, center))
            target.easeTo({ center, duration: reducedMotion() ? 0 : 500 });
        });
        // First view: every night of the current filter in the frame.
        const frame = boundsOf(current.places);
        if (frame)
          target.fitBounds(frame, {
            padding: framePadding(target),
            maxZoom: 11.5,
            animate: false,
          });
        else target.jumpTo({ center: GERMANY, zoom: 4.6 });
        reportView(target);
        current.onReady();
      }
      setMap(target);
    },
    [reportView],
  );

  // New filter results or taste: redraw the points, report the view again.
  useEffect(() => {
    if (!map) return;
    const data = collection(places);
    for (const id of [SOURCE, HEAT_SOURCE]) {
      const source = map.getSource(id);
      if (source instanceof GeoJSONSource) source.setData(data);
    }
    reportView(map);
  }, [map, places, reportView]);

  useEffect(() => {
    if (!map) return;
    const source = map.getSource(FOCUS_SOURCE);
    if (source instanceof GeoJSONSource)
      source.setData(focusCollection(places, focus));
  }, [map, places, focus]);

  // Inside the scrolling page two fingers move the map; full screen, one.
  useEffect(() => {
    if (!map) return;
    if (expanded) map.cooperativeGestures.disable();
    else map.cooperativeGestures.enable();
  }, [map, expanded]);

  // Tonight's points pulse. DOM rings animate on the compositor, so the map
  // itself does not redraw for them; reduced motion keeps them still.
  useEffect(() => {
    if (!map) return;
    const markers = places
      .filter((place) => place.tonight)
      .map((place) => {
        const element = document.createElement("span");
        element.className = `nm-pulse nm-pulse-${place.precision}`;
        element.setAttribute("aria-hidden", "true");
        return new Marker({ element, anchor: "center" })
          .setLngLat([place.longitude, place.latitude])
          .addTo(map);
      });
    return () => markers.forEach((marker) => marker.remove());
  }, [map, places]);

  useEffect(() => {
    if (!map || !position) return;
    const element = document.createElement("span");
    element.className = "nm-you";
    element.setAttribute("aria-hidden", "true");
    const marker = new Marker({ element, anchor: "center" })
      .setLngLat([position.longitude, position.latitude])
      .addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, position]);

  const handled = useRef(0);
  useEffect(() => {
    if (!map || !command || command.seq === handled.current) return;
    handled.current = command.seq;
    const duration = reducedMotion() ? 0 : 900;
    const wide = map.getContainer().clientWidth >= 700;
    switch (command.kind) {
      case "fit": {
        const frame = boundsOf(latest.current.places);
        const camera = frame
          ? map.cameraForBounds(frame, {
              padding: framePadding(map),
              maxZoom: 11.5,
            })
          : undefined;
        map.easeTo({
          center: camera?.center ?? GERMANY,
          zoom: camera?.zoom ?? 4.6,
          bearing: 0,
          pitch: 0,
          duration,
        });
        return;
      }
      case "place":
      case "reveal": {
        const place = latest.current.places.find(
          (entry) => entry.key === command.key,
        );
        if (!place) return;
        const center: [number, number] = [place.longitude, place.latitude];
        if (command.kind === "reveal") {
          if (!comfortablyVisible(map, center))
            map.easeTo({ center, duration });
          return;
        }
        // An exact venue: fly in and tilt the city up. A city centre: show
        // the city, never a made-up street corner.
        if (place.precision === "venue")
          map.flyTo({
            center,
            zoom: Math.max(map.getZoom(), 15.2),
            pitch: wide ? 52 : 42,
            duration: duration * 1.6,
          });
        else
          map.easeTo({
            center,
            zoom: Math.min(Math.max(map.getZoom(), 10.5), 12),
            pitch: 0,
            duration,
          });
        return;
      }
      case "frame": {
        const frame = boundsOf(command.points);
        if (frame)
          map.fitBounds(frame, {
            padding: framePadding(map),
            maxZoom: 13,
            pitch: 0,
            duration: duration * 1.4,
          });
        return;
      }
      case "position":
        map.flyTo({
          center: [command.longitude, command.latitude],
          zoom: 11.5,
          pitch: 0,
          duration: duration * 1.4,
        });
        return;
      case "area": {
        const dLat = command.radiusKm / 111.32;
        const dLng =
          command.radiusKm /
          (111.32 * Math.cos((command.latitude * Math.PI) / 180));
        map.fitBounds(
          [
            [command.longitude - dLng, command.latitude - dLat],
            [command.longitude + dLng, command.latitude + dLat],
          ],
          { padding: framePadding(map), animate: duration > 0, duration },
        );
        return;
      }
    }
  }, [map, command]);

  return (
    <ItstilesMap
      center={GERMANY}
      zoom={4.6}
      flavor={flavor}
      lang={locale}
      colors={nightColors}
      onStyleLoad={onStyleLoad}
      maxZoom={18}
      height="100%"
      className="nm-map"
    />
  );
}
