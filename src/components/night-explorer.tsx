"use client";

// The night map: one surface for exploring, listening and choosing a night.
// On wide screens the programme (heading, filters, list) sits beside a
// sticky map; on phones the map leads the page and opens full screen. Both
// show exactly the nights of the current filters. A strip of night cards
// under the map follows what is on screen, and one SoundCloud player plays
// the DJs of those nights, ordered by the visitor's Reels taste.
import dynamic from "next/dynamic";
import Link from "next/link";
import { MapDjBrowser } from "@/components/map-dj-browser";
import { SOUNDCLOUD_EMBEDS_ENABLED } from "@/core/media-features";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Artwork } from "@/components/artwork";
import { Icon } from "@/components/icon";
import { useProviderConsent } from "@/components/media-consent";
import type { MapNight, NightMapData } from "@/components/night-map-data";
import type {
  MapCommand,
  MapFocus,
  PlacePoint,
} from "@/components/night-map-view";
import { loadReelState, saveReelVotes } from "@/components/reel-storage";
import {
  useSoundcloudPlayer,
  type PlayerStatus,
} from "@/components/soundcloud-player";
import { localizePath, type Locale } from "@/core/i18n";
import { distanceKm, locationById } from "@/core/locations";
import type { ListenDj } from "@/core/night-map";
import {
  addVote,
  rankListening,
  tasteMatch,
  tasteOf,
  type ReelVote,
} from "@/core/reels";
import type { NightFlavor } from "@/lib/map-themes";

const NightMapView = dynamic(() => import("@/components/night-map-view"), {
  ssr: false,
});

const t = (locale: Locale, de: string, en: string) =>
  locale === "en" ? en : de;

const nightsWord = (count: number, locale: Locale) =>
  t(locale, count === 1 ? "Nacht" : "Nächte", count === 1 ? "night" : "nights");

const MAX_CARDS = 30;
/** "In meiner Nähe" frames the nights within this distance. */
const NEAR_KM = 60;

type Position = { latitude: number; longitude: number };
type ListenItem = { dj: ListenDj; night: MapNight };
type Listening = { items: ListenItem[]; index: number };
type Area = { latitude: number; longitude: number; radiusKm: number };

function distanceText(km: number, approximate: boolean, locale: Locale) {
  const value =
    km < 1
      ? "< 1"
      : km < 10
        ? km.toFixed(1).replace(".", t(locale, ",", "."))
        : String(Math.round(km));
  return `${approximate ? "≈ " : ""}${value} km`;
}

export function NightExplorer({
  locale,
  data,
  now,
  demo,
  cityFilter,
  head,
  search,
  filters,
  stageFilters,
  list,
}: {
  locale: Locale;
  data: NightMapData;
  /** The request's clock, for "how soon" in the listening order. */
  now: number;
  demo: boolean;
  cityFilter: string;
  head: ReactNode;
  search: ReactNode;
  filters: ReactNode;
  /** Compact date chips shown on the full-screen map. */
  stageFilters: ReactNode;
  list: ReactNode;
}) {
  const { consent, accept } = useProviderConsent("soundcloud");
  const [votes, setVotes] = useState<ReelVote[]>([]);
  const [area, setArea] = useState<Area | null>(null);
  const [wantMap, setWantMap] = useState(false);
  const [ready, setReady] = useState(false);
  const [flavor, setFlavor] = useState<NightFlavor>("dark");
  const [selected, setSelected] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [inView, setInView] = useState<Set<string> | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  const [command, setCommand] = useState<MapCommand | null>(null);
  const [listening, setListening] = useState<Listening | null>(null);
  const [browsing, setBrowsing] = useState<MapNight | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Stays in the panel until the next search: nothing near, and the closest.
  const [nearNote, setNearNote] = useState<{
    text: string;
    key: string | null;
  } | null>(null);
  const seq = useRef(0);
  const programme = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLUListElement>(null);

  const send = useCallback((next: DistributiveOmit<MapCommand, "seq">) => {
    seq.current += 1;
    setCommand({ ...next, seq: seq.current });
  }, []);

  // Device state is read after hydration: the Reels taste and place, the
  // theme. The map itself starts once the page is idle.
  useEffect(() => {
    const stored = loadReelState();
    const origin = stored.settings?.origin
      ? locationById(stored.settings.origin)
      : undefined;
    /* eslint-disable react-hooks/set-state-in-effect */
    setVotes(stored.votes);
    if (origin && stored.settings?.radiusKm)
      setArea({
        latitude: origin.latitude,
        longitude: origin.longitude,
        radiusKm: stored.settings.radiusKm,
      });
    if (window.location.hash === "#karte") setExpanded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const start = () => setWantMap(true);
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(start, { timeout: 1500 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(start, 300);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const update = () =>
      setFlavor(
        document.documentElement.dataset.theme === "light" ? "light" : "dark",
      );
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    // A like in Reels in another tab lights up the map here too.
    const onStorage = () => setVotes(loadReelState().votes);
    window.addEventListener("storage", onStorage);
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const taste = useMemo(() => tasteOf(votes), [votes]);
  const nightsById = useMemo(
    () => new Map(data.nights.map((night) => [night.id, night])),
    [data.nights],
  );
  const nightsBySlug = useMemo(
    () => new Map(data.nights.map((night) => [night.slug, night])),
    [data.nights],
  );
  const placesByKey = useMemo(
    () => new Map(data.places.map((place) => [place.key, place])),
    [data.places],
  );
  const matches = useMemo(
    () =>
      new Map(data.nights.map((night) => [night.id, tasteMatch(night, taste)])),
    [data.nights, taste],
  );
  const points = useMemo(
    (): PlacePoint[] =>
      data.places.map((place) => {
        const nights = place.eventIds.flatMap((id) => nightsById.get(id) ?? []);
        return {
          key: place.key,
          precision: place.precision,
          latitude: place.latitude,
          longitude: place.longitude,
          // A venue point carries the club's name, a ring its city's.
          label: place.name,
          nights: nights.length,
          tonight: nights.some((night) => night.tonight),
          liked: nights.some((night) => matches.get(night.id) === "liked"),
        };
      }),
    [data.places, nightsById, matches],
  );

  // A new city filter frames its nights; other filter changes keep the
  // visitor's view. A chosen point that no longer has nights is let go.
  const lastCity = useRef(cityFilter);
  useEffect(() => {
    if (lastCity.current !== cityFilter) {
      lastCity.current = cityFilter;
      send({ kind: "fit" });
    }
  }, [cityFilter, send]);
  const shownSelected = selected && placesByKey.has(selected) ? selected : null;

  const onReady = useCallback(() => setReady(true), []);
  const onView = useCallback((keys: string[]) => setInView(new Set(keys)), []);
  const onSelect = useCallback(
    (key: string | null) => {
      setSelected(key);
      if (key) send({ kind: "place", key });
    },
    [send],
  );

  // A Reels place frames the map on first load, unless a city is filtered.
  const framed = useRef(false);
  useEffect(() => {
    if (!ready || framed.current) return;
    framed.current = true;
    if (area && !cityFilter) send({ kind: "area", ...area });
  }, [ready, area, cityFilter, send]);

  const viewNights = useMemo(
    () =>
      inView
        ? data.nights.filter((night) => night.place && inView.has(night.place))
        : data.nights,
    [data.nights, inView],
  );
  const selectedPlace = shownSelected ? placesByKey.get(shownSelected) : null;
  const panelNights = selectedPlace
    ? selectedPlace.eventIds.flatMap((id) => nightsById.get(id) ?? [])
    : viewNights;

  const cards = panelNights.slice(0, MAX_CARDS);
  const hiddenCards = panelNights.length - cards.length;

  // ── Listening ──
  const current = listening?.items[listening.index] ?? null;
  const player = useSoundcloudPlayer(
    consent === "accepted" && current ? current.dj.soundcloudUrl : null,
    votes,
  );

  const queueFor = useCallback(
    (nights: readonly MapNight[], first: ListenItem[] = []) => {
      const seen = new Set(first.map((item) => item.dj.id));
      const candidates: (ListenItem & {
        genres: string[];
        startsAt: string;
      })[] = [];
      for (const night of nights)
        for (const dj of night.listen) {
          if (seen.has(dj.id)) continue;
          seen.add(dj.id);
          candidates.push({
            dj,
            night,
            genres: dj.genres,
            startsAt: night.startsAt,
          });
        }
      return [
        ...first,
        ...rankListening(candidates, votes, now).map(({ dj, night }) => ({
          dj,
          night,
        })),
      ];
    },
    [votes, now],
  );
  const areaDjs = useMemo(
    () =>
      new Set(viewNights.flatMap((night) => night.listen.map((dj) => dj.id))),
    [viewNights],
  );

  const listenArea = () => {
    if (!SOUNDCLOUD_EMBEDS_ENABLED) return;
    const items = queueFor(panelNights);
    if (items.length) setListening({ items, index: 0 });
  };
  // A night's own "Anhören" plays its lineup in billing order, then carries
  // on with the other DJs on the map.
  const listenNight = (night: MapNight) => {
    if (!SOUNDCLOUD_EMBEDS_ENABLED) { setBrowsing(night); return; }
    const items = queueFor(
      viewNights,
      night.listen.map((dj) => ({ dj, night })),
    );
    if (items.length) setListening({ items, index: 0 });
  };
  const listeningRef = useRef(listening);
  useEffect(() => {
    listeningRef.current = listening;
  });
  const next = useCallback(() => {
    const value = listeningRef.current;
    if (!value) return;
    if (value.index + 1 < value.items.length) {
      setListening({ ...value, index: value.index + 1 });
      return;
    }
    setListening(null);
    setToast(
      t(
        locale,
        "Alle DJs hier gehört. Verschieb die Karte für mehr.",
        "That's every DJ here. Move the map for more.",
      ),
    );
  }, [locale]);
  const vote = (value: 1 | -1) => {
    if (!current) return;
    const sound = player.sound;
    const entry: ReelVote = {
      djId: current.dj.id,
      value,
      genres: [
        ...new Set([...current.dj.genres, ...(sound?.genres ?? [])]),
      ].slice(0, 40),
      sound: sound
        ? { url: sound.url, tags: sound.tags, key: sound.key }
        : null,
      at: Date.now(),
    };
    const nextVotes = addVote(votes, entry);
    setVotes(nextVotes);
    saveReelVotes(nextVotes);
    if (value === 1)
      setToast(
        t(
          locale,
          `Gemerkt: ${current.dj.name}. Auch in Reels.`,
          `Saved: ${current.dj.name}. In Reels too.`,
        ),
      );
    else next();
  };

  // A profile without public uploads: move on instead of standing still.
  // A DJ who has played on this visit is never skipped for it.
  const played = useRef<string | null>(null);
  const currentDj = current?.dj.id ?? null;
  useEffect(() => {
    if (player.status === "playing") played.current = currentDj;
    if (player.status !== "empty" || played.current === currentDj) return;
    const timer = window.setTimeout(next, 3500);
    return () => window.clearTimeout(timer);
  }, [player.status, currentDj, next]);

  // The playing DJ's night: ring on the map, card in the strip.
  const playingPlace = current?.night.place ?? null;
  const playingSlug = current?.night.slug ?? null;
  useEffect(() => {
    if (!playingPlace) return;
    send({ kind: "reveal", key: playingPlace });
  }, [playingPlace, send]);
  useEffect(() => {
    const root = strip.current;
    const card = playingSlug
      ? root?.querySelector<HTMLElement>(`[data-slug="${playingSlug}"]`)
      : null;
    if (root && card)
      root.scrollTo({
        left: card.offsetLeft - root.offsetLeft - 12,
        behavior: "smooth",
      });
  }, [playingSlug]);

  // A new choice starts its strip at the first night.
  useEffect(() => {
    strip.current?.scrollTo({ left: 0 });
  }, [shownSelected]);

  // On touch screens the card in front marks its point on the map, so
  // swiping through the nights walks across the map.
  const cardKeys = cards.map((night) => night.id).join("|");
  useEffect(() => {
    const root = strip.current;
    if (!root || window.matchMedia("(hover: hover)").matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !(entry.target instanceof HTMLElement))
            continue;
          const night = nightsBySlug.get(entry.target.dataset.slug ?? "");
          if (night) setActive(night.place);
        }
      },
      { root, threshold: 0.8 },
    );
    for (const card of root.querySelectorAll(".nm-card"))
      observer.observe(card);
    return () => observer.disconnect();
  }, [cardKeys, nightsBySlug]);

  // ── Full screen ──
  // The hash keeps full screen across a reload or a shared link; it replaces
  // the current entry so the back button never undoes a filter.
  const expand = () => {
    setExpanded(true);
    if (window.location.hash !== "#karte")
      window.history.replaceState(null, "", "#karte");
  };
  const collapse = useCallback(() => {
    if (window.location.hash === "#karte")
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    setExpanded(false);
  }, []);
  useEffect(() => {
    const onPop = () => setExpanded(window.location.hash === "#karte");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    // The page under the full-screen map is out of reach for keyboards and
    // screen readers until the map closes.
    const behind = [
      ...document.querySelectorAll<HTMLElement>(".site-header, .site-footer"),
    ];
    for (const element of behind) element.inert = true;
    return () => {
      root.style.overflow = previous;
      for (const element of behind) element.inert = false;
    };
  }, [expanded]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selected) setSelected(null);
      else if (expanded) collapse();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, expanded, collapse]);

  // ── Near me ──
  const locate = () => {
    if (!("geolocation" in navigator)) {
      setToast(t(locale, "Standort nicht verfügbar.", "Location unavailable."));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        const here = { latitude: coords.latitude, longitude: coords.longitude };
        setPosition(here);
        setSelected(null);
        // Frame the closest nights around the visitor, not an empty street:
        // the visitor stays in the middle, the nights around them.
        const near = data.places
          .map((place) => ({ place, km: distanceKm(here, place) }))
          .sort((a, b) => a.km - b.km);
        const close = near.filter((entry) => entry.km <= NEAR_KM).slice(0, 6);
        if (close.length) {
          setNearNote(null);
          const reach = close.reduce(
            (most, { place }) => ({
              latitude: Math.max(
                most.latitude,
                Math.abs(place.latitude - here.latitude),
              ),
              longitude: Math.max(
                most.longitude,
                Math.abs(place.longitude - here.longitude),
              ),
            }),
            { latitude: 0.01, longitude: 0.015 },
          );
          send({
            kind: "frame",
            points: [
              {
                latitude: here.latitude - reach.latitude,
                longitude: here.longitude - reach.longitude,
              },
              {
                latitude: here.latitude + reach.latitude,
                longitude: here.longitude + reach.longitude,
              },
            ],
          });
          return;
        }
        send({ kind: "position", ...here });
        const nearest = near[0];
        setNearNote(
          nearest
            ? {
                text: t(
                  locale,
                  `Im Umkreis von ${NEAR_KM} km ist für diese Filter nichts eingetragen. Am nächsten: ${nearest.place.name}, ${Math.round(nearest.km)} km.`,
                  `Nothing listed within ${NEAR_KM} km for these filters. Closest: ${nearest.place.name}, ${Math.round(nearest.km)} km.`,
                ),
                key: nearest.place.key,
              }
            : {
                text: t(
                  locale,
                  "Für diese Filter ist nichts auf der Karte.",
                  "Nothing on the map for these filters.",
                ),
                key: null,
              },
        );
      },
      () => {
        setLocating(false);
        setToast(
          t(
            locale,
            "Standort nicht verfügbar. Zieh die Karte einfach hin.",
            "Location unavailable. Just move the map there.",
          ),
        );
      },
      { maximumAge: 600_000, timeout: 10_000 },
    );
  };

  // ── List rows and cards point at their place on the map ──
  useEffect(() => {
    const root = programme.current;
    if (!root || !window.matchMedia("(hover: hover)").matches) return;
    const bySlug = new Map(
      data.nights.map((night) => [night.slug, night.place]),
    );
    const onOver = (event: PointerEvent) => {
      const row =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(".ev-row")
          : null;
      setActive(row ? (bySlug.get(row.id.replace(/^e-/, "")) ?? null) : null);
    };
    const onLeave = () => setActive(null);
    root.addEventListener("pointerover", onOver);
    root.addEventListener("pointerleave", onLeave);
    return () => {
      root.removeEventListener("pointerover", onOver);
      root.removeEventListener("pointerleave", onLeave);
    };
  }, [data.nights]);

  const focus: MapFocus = useMemo(
    () => ({ selected: shownSelected, active, playing: playingPlace }),
    [shownSelected, active, playingPlace],
  );

  const panelTitle = selectedPlace
    ? selectedPlace.precision === "venue"
      ? selectedPlace.name
      : selectedPlace.venues.length === 1
        ? `${selectedPlace.venues[0]} · ${selectedPlace.name}`
        : selectedPlace.name
    : inView
      ? t(locale, "Im Kartenausschnitt", "On the map")
      : t(locale, "Als Nächstes", "Coming up");
  const listenCount = selectedPlace
    ? new Set(panelNights.flatMap((night) => night.listen.map((dj) => dj.id)))
        .size
    : areaDjs.size;
  const hasLiked = points.some((point) => point.liked);
  const hasCity = points.some((point) => point.precision === "city");
  const hasVenue = points.some((point) => point.precision === "venue");

  const legend = (className: string) => (
    <ul className={className} aria-label={t(locale, "Legende", "Legend")}>
      {demo && (
        <li className="nm-demo">
          {t(locale, "Demo · fiktive Orte", "Demo · fictional venues")}
        </li>
      )}
      {hasVenue && (
        <li>
          <span className="nm-key nm-key-venue" aria-hidden="true" />
          {t(locale, "Club-Adresse", "Venue address")}
        </li>
      )}
      {hasCity && (
        <li>
          <span className="nm-key nm-key-city" aria-hidden="true" />
          {t(locale, "Ungefähr: Stadtmitte", "Approximate: city centre")}
        </li>
      )}
      {points.some((point) => point.tonight) && (
        <li>
          <span className="nm-key nm-key-tonight" aria-hidden="true" />
          {t(locale, "Heute", "Tonight")}
        </li>
      )}
      {hasLiked && (
        <li>
          <span className="nm-key nm-key-liked" aria-hidden="true" />
          {t(locale, "Deine Likes", "Your likes")}
        </li>
      )}
    </ul>
  );

  return (
    <div
      className={`night-explorer${expanded ? " is-expanded" : ""}${listening ? " is-listening" : ""}`}
    >
      <div className="ne-head" inert={expanded}>
        {head}
      </div>
      <div
        id="karte"
        className="ne-stage"
        role="region"
        aria-label={t(locale, "Karte der Nächte", "Map of nights")}
      >
        <div className="nm-topbar">
          <button
            type="button"
            className="nm-back"
            onClick={collapse}
            aria-label={t(
              locale,
              "Karte schließen, zur Liste",
              "Close map, back to the list",
            )}
          >
            <Icon name="arrow-left" />
            {t(locale, "Liste", "List")}
          </button>
          <div className="nm-topbar-filters">{stageFilters}</div>
        </div>
        <div className="nm-canvas">
          {wantMap ? (
            <NightMapView
              locale={locale}
              flavor={flavor}
              places={points}
              focus={focus}
              expanded={expanded}
              command={command}
              position={position}
              onSelect={onSelect}
              onView={onView}
              onReady={onReady}
            />
          ) : null}
          {!ready && (
            <p className="nm-loading" aria-hidden="true">
              {t(locale, "Karte lädt …", "Loading map …")}
            </p>
          )}
          <div className="nm-hud">
            <div className="nm-tools">
              {!expanded && (
                <button
                  type="button"
                  className="nm-tool"
                  onClick={expand}
                  title={t(locale, "Vollbild", "Full screen")}
                >
                  <Icon name="expand" />
                  <span className="nm-tool-label">
                    {t(locale, "Vollbild", "Full screen")}
                  </span>
                </button>
              )}
              <button
                type="button"
                className="nm-tool"
                title={t(locale, "In meiner Nähe", "Near me")}
                onClick={locate}
                disabled={locating}
              >
                <Icon name="locate" />
                <span className="nm-tool-label nm-tool-label-keep">
                  {locating
                    ? t(locale, "Suche …", "Locating …")
                    : t(locale, "In meiner Nähe", "Near me")}
                </span>
              </button>
              <button
                type="button"
                className="nm-tool"
                title={t(locale, "Alle zeigen", "Show all")}
                onClick={() => {
                  setSelected(null);
                  setNearNote(null);
                  send({ kind: "fit" });
                }}
              >
                <Icon name="globe" />
                <span className="nm-tool-label">
                  {t(locale, "Alle zeigen", "Show all")}
                </span>
              </button>
            </div>
            {legend("nm-legend nm-legend-map")}
          </div>
          <p className="nm-toast" role="status">
            {toast}
          </p>
        </div>

        <section className="nm-panel" aria-labelledby="nm-panel-title">
          <header className="nm-panel-head">
            <div className="nm-panel-title">
              <h2 id="nm-panel-title">{panelTitle}</h2>
              <p>
                {panelNights.length} {nightsWord(panelNights.length, locale)}
                {selectedPlace ? (
                  selectedPlace.precision === "venue" ? (
                    t(locale, " · genaue Adresse", " · exact address")
                  ) : (
                    t(
                      locale,
                      " · Lage ungefähr (Stadtmitte)",
                      " · approximate (city centre)",
                    )
                  )
                ) : (
                  // Phones: the map stays clear, the key fits this line.
                  <span className="nm-key-short">
                    {demo && (
                      <span className="nm-demo">
                        {t(
                          locale,
                          " · Demo · fiktive Orte",
                          " · Demo · fictional venues",
                        )}
                      </span>
                    )}
                    {hasCity && (
                      <>
                        {" · "}
                        <span
                          className="nm-key nm-key-city"
                          aria-hidden="true"
                        />{" "}
                        {t(locale, "= Lage ungefähr", "= approximate")}
                      </>
                    )}
                  </span>
                )}
              </p>
            </div>
            <div className="nm-panel-actions">
              <button
                type="button"
                className={`nm-listen-all${listening ? " is-on" : ""}`}
                onClick={listenArea}
                disabled={!listenCount}
                title={
                  listenCount
                    ? undefined
                    : t(
                        locale,
                        "Hier spielt niemand mit SoundCloud-Profil",
                        "Nobody here has a SoundCloud profile",
                      )
                }
              >
                <Icon name="play" />
                {listenCount
                  ? t(
                      locale,
                      `Anhören · ${listenCount} DJs`,
                      `Listen · ${listenCount} DJs`,
                    )
                  : t(locale, "Anhören", "Listen")}
              </button>
              {selectedPlace && (
                <button
                  type="button"
                  className="nm-icon-button"
                  onClick={() => setSelected(null)}
                  aria-label={t(locale, "Auswahl aufheben", "Clear selection")}
                >
                  <Icon name="close" />
                </button>
              )}
            </div>
          </header>
          {cards.length ? (
            <ul
              ref={strip}
              className="nm-strip"
              aria-label={t(locale, "Nächte", "Nights")}
            >
              {cards.map((night) => (
                <NightCard
                  key={night.id}
                  night={night}
                  locale={locale}
                  match={matches.get(night.id) ?? null}
                  likedNames={night.listen
                    .filter((dj) => (taste.djs.get(dj.id) ?? 0) > 0)
                    .map((dj) => dj.name)}
                  distance={
                    position && night.place
                      ? (() => {
                          const place = placesByKey.get(night.place);
                          return place
                            ? distanceText(
                                distanceKm(position, place),
                                place.precision === "city",
                                locale,
                              )
                            : null;
                        })()
                      : null
                  }
                  playing={
                    current?.night.id === night.id ? current.dj.name : null
                  }
                  onListen={() => listenNight(night)}
                  onHover={(on) => setActive(on ? night.place : null)}
                />
              ))}
              {hiddenCards > 0 && (
                <li className="nm-more">
                  <a href="#nights">
                    {t(
                      locale,
                      `${hiddenCards} weitere in der Liste`,
                      `${hiddenCards} more in the list`,
                    )}
                    <Icon name="arrow-down" />
                  </a>
                </li>
              )}
            </ul>
          ) : (
            <div className="nm-empty">
              <p>
                {nearNote
                  ? nearNote.text
                  : data.nights.length
                    ? t(
                        locale,
                        "Hier auf der Karte ist für diese Filter nichts eingetragen.",
                        "Nothing is listed on this part of the map for these filters.",
                      )
                    : t(
                        locale,
                        "Für diese Filter gibt es keine kommenden Nächte.",
                        "No upcoming nights match these filters.",
                      )}
              </p>
              {nearNote?.key && (
                <button
                  type="button"
                  className="chip-button"
                  onClick={() => {
                    const key = nearNote.key;
                    setNearNote(null);
                    if (key) onSelect(key);
                  }}
                >
                  {t(locale, "Zur nächsten", "Go to the closest")}
                </button>
              )}
              {data.nights.length > 0 && (
                <button
                  type="button"
                  className="chip-button"
                  onClick={() => {
                    setNearNote(null);
                    send({ kind: "fit" });
                  }}
                >
                  {t(locale, "Alle zeigen", "Show all")}
                </button>
              )}
            </div>
          )}
          {data.unmappedNights > 0 && (
            <p className="nm-unmapped">
              {t(
                locale,
                `${data.unmappedNights} ${nightsWord(data.unmappedNights, locale)} ohne Kartenposition (${data.unmapped.join(", ")}) – in der Liste.`,
                `${data.unmappedNights} ${nightsWord(data.unmappedNights, locale)} without a map position (${data.unmapped.join(", ")}) – see the list.`,
              )}
            </p>
          )}
        </section>
        {browsing && <MapDjBrowser key={browsing.id} night={browsing} locale={locale} onClose={() => setBrowsing(null)} />}


        {listening && current && (
          <ListenDock
            locale={locale}
            current={current}
            position={`${listening.index + 1} / ${listening.items.length}`}
            consent={consent}
            accept={accept}
            status={player.status}
            soundTitle={player.sound?.title ?? null}
            soundUrl={player.sound?.url ?? null}
            frame={player.frame}
            liked={(taste.djs.get(current.dj.id) ?? 0) > 0}
            onToggle={player.toggle}
            onNext={next}
            onLike={() => vote(1)}
            onDislike={() => vote(-1)}
            onShowNight={() => {
              if (!current.night.place) return;
              setSelected(current.night.place);
              send({ kind: "place", key: current.night.place });
            }}
            onClose={() => setListening(null)}
          />
        )}
      </div>
      <div className="ne-search" inert={expanded}>
        {search}
      </div>
      <div className="ne-filters" inert={expanded}>
        {filters}
      </div>
      <div className="ne-list" ref={programme} inert={expanded}>
        {list}
      </div>
    </div>
  );
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

function NightCard({
  night,
  locale,
  match,
  likedNames,
  distance,
  playing,
  onListen,
  onHover,
}: {
  night: MapNight;
  locale: Locale;
  match: "liked" | "close" | null;
  likedNames: string[];
  distance: string | null;
  playing: string | null;
  onListen: () => void;
  onHover: (on: boolean) => void;
}) {
  const shown = night.lineup.slice(0, 3);
  return (
    <li
      className={`nm-card${night.tonight ? " is-tonight" : ""}${playing ? " is-playing" : ""}`}
      data-slug={night.slug}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <div className="nm-card-art" aria-hidden="true">
        <Artwork
          event={night.artwork.event}
          poster={night.artwork.poster}
          locale={locale}
        />
      </div>
      <div className="nm-card-body">
        <p className="nm-card-when">
          <time dateTime={night.startsAt}>{night.when}</time>
          {distance && <span className="nm-card-distance">{distance}</span>}
        </p>
        <p className="nm-card-title">
          <Link href={localizePath(`/events/${night.slug}`, locale)}>
            {night.title}
          </Link>
        </p>
        {shown.length > 0 && (
          <p className="nm-card-lineup">
            {shown.join(", ")}
            {night.lineup.length > shown.length &&
              ` +${night.lineup.length - shown.length}`}
          </p>
        )}
        {night.genres.length > 0 && (
          <p className="nm-card-genres">
            {night.genres.slice(0, 3).join(" · ")}
          </p>
        )}
        <p className="nm-card-place">
          {night.venue} · {night.city}
          {night.precision === "city" && (
            <span
              className="nm-card-approx"
              title={t(
                locale,
                "Auf der Karte ungefähr: Stadtmitte",
                "Approximate on the map: city centre",
              )}
            >
              {t(locale, " · Lage ≈", " · location ≈")}
            </span>
          )}
        </p>
        {(playing || likedNames.length > 0 || match === "close") && (
          <p className="nm-card-taste">
            {playing ? (
              <>
                <Icon name="wave" />
                {t(locale, `Läuft: ${playing}`, `Playing: ${playing}`)}
              </>
            ) : likedNames.length ? (
              <>
                <Icon name="heart" className="filled" />
                {likedNames.slice(0, 2).join(", ")}
              </>
            ) : (
              t(locale, "Passt zu deinen Likes", "Close to your likes")
            )}
          </p>
        )}
      </div>
      {(night.artists.length > 0 || night.ticketUrl) && (
        <div className="nm-card-actions">
          {(SOUNDCLOUD_EMBEDS_ENABLED ? night.listen.length > 0 : night.artists.length > 0) && (
            <button type="button" className="nm-card-listen" onClick={onListen} aria-label={SOUNDCLOUD_EMBEDS_ENABLED ? t(locale, `${night.title} anhören: ${night.listen.map(dj=>dj.name).join(", ")}`, `Listen to ${night.title}: ${night.listen.map(dj=>dj.name).join(", ")}`) : t(locale, `Line-up von ${night.title} ansehen`, `View ${night.title} lineup`)}>
              <Icon name={SOUNDCLOUD_EMBEDS_ENABLED ? "play" : "wave"} /><span>{SOUNDCLOUD_EMBEDS_ENABLED ? t(locale,"Anhören","Listen") : "DJs"}</span>
            </button>
          )}
          {night.ticketUrl ? (
            <a
              className="nm-card-tickets"
              href={night.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Tickets
              <Icon name="arrow-up-right" />
            </a>
          ) : null}
        </div>
      )}
    </li>
  );
}

function ListenDock({
  locale,
  current,
  position,
  consent,
  accept,
  status,
  soundTitle,
  soundUrl,
  frame,
  liked,
  onToggle,
  onNext,
  onLike,
  onDislike,
  onShowNight,
  onClose,
}: {
  locale: Locale;
  current: ListenItem;
  position: string;
  consent: "unset" | "accepted" | "rejected";
  accept: () => void;
  status: PlayerStatus;
  soundTitle: string | null;
  soundUrl: string | null;
  frame: ReactNode;
  liked: boolean;
  onToggle: () => void;
  onNext: () => void;
  onLike: () => void;
  onDislike: () => void;
  onShowNight: () => void;
  onClose: () => void;
}) {
  const { dj, night } = current;
  const statusText =
    status === "playing"
      ? t(locale, "Läuft", "Playing")
      : status === "paused"
        ? t(locale, "Pausiert", "Paused")
        : status === "blocked"
          ? t(locale, "Tippen zum Abspielen", "Tap to play")
          : status === "empty"
            ? t(
                locale,
                "Keine öffentlichen Tracks – weiter",
                "No public tracks – skipping",
              )
            : status === "error"
              ? t(locale, "Player antwortet nicht", "Player not responding")
              : t(locale, "Lädt …", "Loading …");
  const closeButton = (
    <button
      type="button"
      className="nm-icon-button"
      onClick={onClose}
      aria-label={t(locale, "Player schließen", "Close player")}
    >
      <Icon name="close" />
    </button>
  );
  if (!SOUNDCLOUD_EMBEDS_ENABLED)
    return <div className="nm-dock nm-dock-consent" role="region" aria-label={t(locale, "SoundCloud-Player", "SoundCloud player")}>
      <p>{t(locale, "SoundCloud-Player derzeit deaktiviert.", "SoundCloud player currently disabled.")}</p>
      <div className="nm-dock-choices"><a className="chip-button" href={dj.soundcloudUrl} target="_blank" rel="noopener noreferrer">{t(locale, "Auf SoundCloud anhören", "Listen on SoundCloud")} <Icon name="arrow-up-right" /></a>{closeButton}</div>
    </div>;
  if (consent !== "accepted")
    return (
      <div
        className="nm-dock nm-dock-consent"
        role="region"
        aria-label={t(locale, "SoundCloud-Player", "SoundCloud player")}
      >
        <div className="nm-dock-copy">
          <p className="nm-dock-kicker">
            {t(locale, "Anhören", "Listen")} · {dj.name}
          </p>
          <p>
            {t(
              locale,
              "Dafür lädt EVRYVIBE den Player von SoundCloud. SoundCloud erhält dabei deine Verbindungsdaten und kann Cookies setzen. ",
              "This loads SoundCloud's player. SoundCloud receives your connection details and may set cookies. ",
            )}
            <Link href={localizePath("/datenschutz", locale)}>
              {t(locale, "Datenschutz", "Privacy")}
            </Link>
          </p>
        </div>
        <div className="nm-dock-choices">
          <button
            type="button"
            className="button button-primary"
            onClick={accept}
          >
            <Icon name="play" />
            {t(
              locale,
              "SoundCloud laden und abspielen",
              "Load SoundCloud and play",
            )}
          </button>
          <a
            className="chip-button"
            href={dj.soundcloudUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t(locale, "Auf SoundCloud anhören", "Listen on SoundCloud")}
            <Icon name="arrow-up-right" />
          </a>
          {closeButton}
        </div>
      </div>
    );
  return (
    <div
      className="nm-dock"
      role="region"
      aria-label={t(locale, "SoundCloud-Player", "SoundCloud player")}
    >
      <div className="nm-dock-bar">
        <button
          type="button"
          className="nm-dock-play"
          onClick={onToggle}
          aria-label={
            status === "playing"
              ? t(locale, "Pause", "Pause")
              : t(locale, "Abspielen", "Play")
          }
        >
          <Icon name={status === "playing" ? "pause" : "play"} />
        </button>
        <p className="nm-dock-kicker" aria-live="polite">
          {statusText} · {position}
        </p>
        {/* The whole block is one target: it shows the DJ's night on the map. */}
        <button
          type="button"
          className="nm-dock-now"
          onClick={onShowNight}
          aria-label={t(
            locale,
            `${dj.name}: ${night.when}, ${night.venue}, ${night.city} – auf der Karte zeigen`,
            `${dj.name}: ${night.when}, ${night.venue}, ${night.city} – show on the map`,
          )}
        >
          <span className="nm-dock-dj">
            <span className="nm-dock-name">{dj.name}</span>
            {soundTitle && <span className="nm-dock-track">{soundTitle}</span>}
          </span>
          <span className="nm-dock-night">
            {night.when} · {night.venue} · {night.city}
          </span>
        </button>
        <div className="nm-dock-buttons">
          <button
            type="button"
            className="nm-icon-button"
            onClick={onLike}
            aria-pressed={liked}
            aria-label={
              liked
                ? t(locale, "Gemerkt", "Saved")
                : t(locale, `${dj.name} liken`, `Like ${dj.name}`)
            }
          >
            <Icon name="heart" className={liked ? "filled" : ""} />
          </button>
          <button
            type="button"
            className="nm-icon-button"
            onClick={onDislike}
            aria-label={t(locale, "Nicht meins", "Not mine")}
          >
            <Icon name="thumb-down" />
          </button>
          <button
            type="button"
            className="nm-icon-button"
            onClick={onNext}
            aria-label={t(locale, "Nächster DJ", "Next DJ")}
          >
            <Icon name="skip" />
          </button>
          <a
            className="nm-icon-button nm-dock-profile"
            href={soundUrl ?? dj.soundcloudUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t(
              locale,
              `${dj.name} auf SoundCloud`,
              `${dj.name} on SoundCloud`,
            )}
          >
            <Icon name="arrow-up-right" />
          </a>
          {closeButton}
        </div>
      </div>
      <div className="nm-dock-frame">{frame}</div>
    </div>
  );
}
