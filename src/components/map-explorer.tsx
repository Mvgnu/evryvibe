"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { firstLabelLayerId } from "@/lib/itstiles";
import { mapColors } from "@/lib/map-themes";
import { localizePath, type Locale } from "@/core/i18n";

const ItstilesMap = dynamic(() => import("@/components/ItstilesMap"), {
  ssr: false,
});
type MapEvent = {
  slug: string;
  title: string;
  venueName: string;
  startsAt: string;
  timezone: string;
};
type MapLocation = {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  events: MapEvent[];
};

export function MapExplorer({
  locations,
  locale,
  missingCities,
}: {
  locations: MapLocation[];
  locale: Locale;
  missingCities: string[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [light, setLight] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const de = locale === "de";
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const update = () =>
      setLight(document.documentElement.dataset.theme === "light");
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    update();
    return () => observer.disconnect();
  }, []);
  const click = useCallback((event: MapLayerMouseEvent) => {
    const slug: unknown = event.features?.[0]?.properties?.slug;
    if (typeof slug === "string") setSelected(slug);
  }, []);
  const onStyleLoad = useCallback(
    (map: MapLibreMap) => {
      const data: FeatureCollection<Point, { slug: string; count: number }> = {
        type: "FeatureCollection",
        features: locations.map((city) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [city.longitude, city.latitude],
          },
          properties: { slug: city.slug, count: city.events.length },
        })),
      };
      map.addSource("event-cities", { type: "geojson", data });
      map.addLayer(
        {
          id: "event-cities-halo",
          type: "circle",
          source: "event-cities",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              3,
              13,
              8,
              20,
            ],
            "circle-color": "#d8ff00",
            "circle-stroke-color": "#101210",
            "circle-stroke-width": 2,
          },
        },
        firstLabelLayerId(map),
      );
      map.addLayer(
        {
          id: "event-cities-count",
          type: "symbol",
          source: "event-cities",
          layout: {
            "text-field": ["to-string", ["get", "count"]],
            "text-font": ["Noto Sans Medium"],
            "text-size": 12,
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#101210" },
        },
        firstLabelLayerId(map),
      );
      map.off("click", "event-cities-halo", click);
      map.on("click", "event-cities-halo", click);
    },
    [locations, click],
  );
  const city = locations.find((item) => item.slug === selected);
  return (
    <div className="map-explorer">
      <div className="map-canvas" ref={container}>
        {visible && (
          <ItstilesMap
            center={[10.4, 51.1]}
            zoom={4.6}
            flavor={light ? "light" : "dark"}
            lang={locale}
            colors={mapColors}
            onStyleLoad={onStyleLoad}
            height="100%"
          />
        )}
        {!visible && (
          <p className="map-loading">
            {de ? "Karte wird geladen …" : "Loading map …"}
          </p>
        )}
      </div>
      <div className="map-sidebar">
        <div className="map-side-heading">
          <span>{de ? "STÄDTE" : "CITIES"}</span>
          <span>{locations.length}</span>
        </div>
        <div className="map-city-list">
          {locations.map((item) => (
            <button
              key={item.slug}
              className={selected === item.slug ? "is-selected" : ""}
              onClick={() => setSelected(item.slug)}
              aria-pressed={selected === item.slug}
            >
              <span>{item.name}</span>
              <span>{item.events.length}</span>
            </button>
          ))}
        </div>
        {city ? (
          <section className="map-results">
            <div className="map-side-heading">
              <h2>{city.name}</h2>
              <Link href={localizePath(`/cities/${city.slug}`, locale)}>
                {de ? "Stadt ansehen ↗" : "View city ↗"}
              </Link>
            </div>
            {city.events.map((event) => (
              <Link
                key={event.slug}
                className="map-event"
                href={localizePath(`/events/${event.slug}`, locale)}
              >
                <time>
                  {new Intl.DateTimeFormat(de ? "de-DE" : "en-GB", {
                    timeZone: event.timezone,
                    day: "2-digit",
                    month: "short",
                    weekday: "short",
                  }).format(new Date(event.startsAt))}
                </time>
                <span>
                  <strong>{event.title}</strong>
                  <small>{event.venueName}</small>
                </span>
                <span aria-hidden="true">↗</span>
              </Link>
            ))}
          </section>
        ) : (
          <p className="map-prompt">
            {de
              ? "Wähle eine Stadt auf der Karte oder in der Liste, um ihre kommenden Nächte zu sehen."
              : "Choose a city on the map or in the list to see its upcoming nights."}
          </p>
        )}
        {missingCities.length > 0 && (
          <p className="map-missing">
            {de ? "Noch ohne Kartenposition" : "Not yet mapped"}:{" "}
            {missingCities.join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}
