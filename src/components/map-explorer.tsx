"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Artwork } from "@/components/artwork";
import type { PosterFacts } from "@/components/poster-facts";
import type { Event } from "@/core/model";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { firstLabelLayerId } from "@/lib/itstiles";
import { mapColors } from "@/lib/map-themes";
import { localizePath, type Locale } from "@/core/i18n";

const ItstilesMap = dynamic(() => import("@/components/ItstilesMap"), {
  ssr: false,
});
type MapEvent = {
  event: Event;
  poster: PosterFacts;
  venueName: string;
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
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
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
      setMap((current) => (current === map ? current : map));
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
  useLayoutEffect(() => {
    const element = popupRef.current;
    const canvas = container.current;
    if (!city || !map || !element || !canvas) return;
    const update = () => {
      const point = map.project([city.longitude, city.latitude]);
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const left = Math.max(
        8,
        Math.min(point.x + 18, canvas.clientWidth - width - 8),
      );
      const top = Math.max(
        8,
        Math.min(point.y - height - 18, canvas.clientHeight - height - 34),
      );
      setPopupPosition((previous) =>
        previous?.left === left && previous.top === top
          ? previous
          : { left, top },
      );
    };
    update();
    map.on("move", update);
    map.on("resize", update);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(canvas);
    return () => {
      map.off("move", update);
      map.off("resize", update);
      observer.disconnect();
    };
  }, [city, map]);
  useEffect(() => {
    if (!city) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    const handleOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popupRef.current?.contains(event.target)
      )
        setSelected(null);
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("pointerdown", handleOutside);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("pointerdown", handleOutside);
    };
  }, [city]);
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
        {city && (
          <div
            className="map-dialog-inner"
            ref={popupRef}
            style={{
              left: popupPosition?.left ?? 8,
              top: popupPosition?.top ?? 8,
              visibility: popupPosition ? "visible" : "hidden",
            }}
            role="dialog"
            aria-labelledby="map-dialog-title"
          >
            <header className="map-dialog-header">
              <div>
                <p>
                  {de ? "KOMMENDE NÄCHTE" : "UPCOMING NIGHTS"} ·{" "}
                  {city.events.length}
                </p>
                <h2 id="map-dialog-title">{city.name}</h2>
                <span>
                  {de
                    ? "Ungefährer Stadtmittelpunkt"
                    : "Approximate city centre"}
                </span>
              </div>
              <button
                type="button"
                className="map-dialog-close"
                onClick={() => setSelected(null)}
                aria-label={de ? "Schließen" : "Close"}
              >
                ×
              </button>
            </header>
            <div className="map-dialog-events">
              {city.events.map(({ event, poster, venueName, timezone }) => (
                <Link
                  key={event.slug}
                  className="map-event-card"
                  href={localizePath(`/events/${event.slug}`, locale)}
                >
                  <Artwork
                    event={event}
                    poster={poster}
                    locale={locale}
                    className="map-event-art"
                  />
                  <div className="map-event-info">
                    <time dateTime={event.startsAt}>
                      {new Intl.DateTimeFormat(de ? "de-DE" : "en-GB", {
                        timeZone: timezone,
                        day: "2-digit",
                        month: "short",
                        weekday: "short",
                      }).format(new Date(event.startsAt))}
                    </time>
                    <strong>{event.title}</strong>
                    <span>{venueName}</span>
                  </div>
                  <span className="map-event-arrow" aria-hidden="true">
                    ↗
                  </span>
                </Link>
              ))}
            </div>
            <Link
              className="map-dialog-city"
              href={localizePath(`/cities/${city.slug}`, locale)}
            >
              {de ? "Alle Nächte in" : "All nights in"} {city.name} ↗
            </Link>
          </div>
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
              onClick={() => {
                map?.easeTo({ center: [item.longitude, item.latitude] });
                setSelected(item.slug);
                container.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "nearest",
                });
              }}
              aria-pressed={selected === item.slug}
            >
              <span>{item.name}</span>
              <span>{item.events.length}</span>
            </button>
          ))}
        </div>
        <p className="map-prompt">
          {de
            ? "Wähle eine Stadt auf der Karte oder in der Liste, um ihre kommenden Nächte zu sehen."
            : "Choose a city on the map or in the list to see its upcoming nights."}
        </p>
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
