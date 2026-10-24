"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { Icon } from "@/components/icon";
import { ListenPlayer } from "@/components/listen-player";
import { localizePath, type Locale } from "@/core/i18n";
import {
  DEFAULT_LISTEN_SETTINGS,
  LISTEN_STORAGE_KEY,
  rankListenCards,
  readListenState,
  upsertFeedback,
  type ListenCard,
  type ListenFeedback,
  type ListenSettings,
  type RankedListenCard,
  type SoundMetadata,
} from "@/core/listen";
import { LISTEN_LOCATIONS } from "@/core/listen-locations";
import { CAMELOT_KEYS, compatibleKeys } from "@/core/musical-key";

type ListenState = ReturnType<typeof readListenState>;
type LocalSnapshot = {
  state: ListenState;
  storage: "checking" | "device" | "session";
};

// A cached external-store snapshot keeps SSR and the first hydration render
// identical. Browser storage is read only when React subscribes after hydration.
const serverSnapshot: LocalSnapshot = {
  state: readListenState(null),
  storage: "checking",
};
let localSnapshot = serverSnapshot;
// Keep session-only feedback across soft navigation if writes fail (for example
// a full storage quota), without resurrecting another tab's newer saved state.
let lastStoredValue: string | null | undefined;
const subscribers = new Set<() => void>();

function notifySubscribers() {
  for (const notify of subscribers) notify();
}

function loadStoredState() {
  try {
    const raw = window.localStorage.getItem(LISTEN_STORAGE_KEY);
    if (localSnapshot.storage === "session" && raw === lastStoredValue) {
      notifySubscribers();
      return;
    }
    lastStoredValue = raw;
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Corrupt JSON has the same safe defaults as an invalid Zod payload.
      }
    }
    localSnapshot = { state: readListenState(parsed), storage: "device" };
  } catch {
    localSnapshot = { state: localSnapshot.state, storage: "session" };
  }
  notifySubscribers();
}

function onStorage(event: StorageEvent) {
  if (event.key === LISTEN_STORAGE_KEY || event.key === null) loadStoredState();
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  if (subscribers.size === 1) {
    window.addEventListener("storage", onStorage);
    // Reconcile changes made in another tab while this feed was unmounted.
    // If access is unavailable, loadStoredState preserves the session state.
    loadStoredState();
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0)
      window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot() {
  return localSnapshot;
}

function getServerSnapshot() {
  return serverSnapshot;
}

function saveState(next: ListenState) {
  const state = readListenState({ version: 1, ...next });
  let storage: LocalSnapshot["storage"] = "device";
  const serialized = JSON.stringify({ version: 1, ...state });
  try {
    window.localStorage.setItem(LISTEN_STORAGE_KEY, serialized);
    lastStoredValue = serialized;
  } catch {
    storage = "session";
  }
  localSnapshot = { state, storage };
  notifySubscribers();
}

type Journey = { trail: string[]; index: number; ended: boolean };
const freshJourney: Journey = { trail: [], index: 0, ended: false };
type Night = RankedListenCard["events"][number];
type Artist = ListenCard["artist"];
type SavedNight = { event: Night; artists: Artist[] };

function savedNights(cards: RankedListenCard[], feedback: ListenFeedback[]) {
  const liked = new Set(
    feedback
      .filter((entry) => entry.value === 1)
      .map((entry) => entry.artistId),
  );
  const nights = new Map<string, SavedNight>();
  for (const card of cards) {
    if (!liked.has(card.artist.id)) continue;
    for (const event of card.events) {
      const existing = nights.get(event.id);
      if (existing) existing.artists.push(card.artist);
      else nights.set(event.id, { event, artists: [card.artist] });
    }
  }
  return [...nights.values()].sort(
    (a, b) => Date.parse(a.event.startsAt) - Date.parse(b.event.startsAt),
  );
}

function focusCard() {
  window.requestAnimationFrame(() => {
    document
      .getElementById("listen-current-card")
      ?.focus({ preventScroll: true });
  });
}

function NightRow({
  event,
  artists,
  locale,
}: {
  event: Night;
  artists: Artist[];
  locale: Locale;
}) {
  const language = locale === "de" ? "de-DE" : "en-GB";
  const date = new Date(event.startsAt);
  const dateLabel = new Intl.DateTimeFormat(language, {
    timeZone: event.timezone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat(language, {
    timeZone: event.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
  return (
    <article className="listen-night">
      <time className="listen-night-date" dateTime={event.startsAt}>
        <strong>{dateLabel}</strong>
        <span title={event.timezone}>{timeLabel}</span>
      </time>
      <h3>
        <Link href={localizePath(`/events/${event.slug}`, locale)}>
          {event.title}
          <Icon name="arrow-up-right" />
        </Link>
      </h3>
      {artists.length > 0 && (
        <p className="listen-night-artists">
          {artists.map((artist, index) => (
            <span key={artist.id}>
              {index > 0 && ", "}
              <Link href={localizePath(`/djs/${artist.slug}`, locale)}>
                {artist.name}
              </Link>
            </span>
          ))}
        </p>
      )}
      <p className="listen-night-place">
        {event.venueName} · {event.city}, {event.country}
        {event.distanceKm !== null && (
          <span> · ≈ {Math.round(event.distanceKm)} km</span>
        )}
      </p>
      {event.ticketUrl && (
        <a
          className="listen-ticket"
          href={event.ticketUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Tickets <Icon name="arrow-up-right" />
        </a>
      )}
    </article>
  );
}

function ActiveCard({
  card,
  locale,
  feedback,
  position,
  total,
  onVote,
  onNext,
  onPrevious,
}: {
  card: RankedListenCard;
  locale: Locale;
  feedback: ListenFeedback[];
  position: number;
  total: number;
  onVote: (value: 1 | -1, sound: SoundMetadata | null) => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const [sound, setSound] = useState<SoundMetadata | null>(null);
  // This callback must not change when feedback, filters or metadata render.
  const onSound = useCallback(
    (value: SoundMetadata | null) => setSound(value),
    [],
  );
  const de = locale === "de";
  const currentFeedback = feedback.find((entry) =>
    sound
      ? entry.sound?.id.replace(/^soundcloud:tracks:/, "") ===
        sound.id.replace(/^soundcloud:tracks:/, "")
      : entry.artistId === card.artist.id && entry.sound === null,
  );
  const keyDetail = sound?.key
    ? CAMELOT_KEYS.find((key) => key.key === sound.key)
    : null;

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      event.target !== event.currentTarget ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.repeat
    )
      return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      onNext();
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      onPrevious();
    } else if (event.key.toLowerCase() === "l") {
      event.preventDefault();
      onVote(1, sound);
    } else if (event.key.toLowerCase() === "d") {
      event.preventDefault();
      onVote(-1, sound);
    }
  }

  return (
    <article
      id="listen-current-card"
      className="listen-card"
      tabIndex={0}
      aria-labelledby="listen-artist-name"
      aria-describedby="listen-keyboard-help"
      onKeyDown={onKeyDown}
    >
      <header className="listen-card-heading">
        <div className="listen-card-kicker">
          <p className="eyebrow">
            <Icon name="wave" />
            {de ? "Jetzt hören" : "Listen now"}
          </p>
          <span className="listen-position">
            {String(position).padStart(2, "0")} /{" "}
            {String(total).padStart(2, "0")}
          </span>
        </div>
        <h2 id="listen-artist-name">
          <Link href={localizePath(`/djs/${card.artist.slug}`, locale)}>
            {card.artist.name}
          </Link>
        </h2>
        <p className="listen-genres">
          {card.genres.length
            ? card.genres.join(" · ")
            : de
              ? "Genre noch offen"
              : "Genre not listed"}
          {card.reason !== "discover" && (
            <span className="listen-reason">
              {card.reason === "artist"
                ? de
                  ? "Aus deinen Likes"
                  : "From your likes"
                : de
                  ? "Genres aus deinen Likes"
                  : "Genres from your likes"}
            </span>
          )}
        </p>
      </header>

      <ListenPlayer
        url={card.artist.soundcloudUrl}
        name={card.artist.name}
        locale={locale}
        onSound={onSound}
      />

      <div className="listen-sound-info">
        {sound ? (
          <>
            <p className="listen-sound-title">
              <a
                href={sound.permalinkUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {sound.title}
              </a>
            </p>
            <p className="listen-sound-values">
              {sound.bpm !== null && <strong>{sound.bpm} BPM</strong>}
              {keyDetail && (
                <strong>
                  {keyDetail.key} · {de ? keyDetail.nameDe : keyDetail.nameEn}
                </strong>
              )}
              {sound.bpm === null && !keyDetail && (
                <span>
                  {de
                    ? "BPM / Tonart nicht angegeben"
                    : "BPM / key not provided"}
                </span>
              )}
              <a
                href={sound.permalinkUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {de ? "Angaben: SoundCloud" : "Source: SoundCloud"}
              </a>
            </p>
            {sound.key && (
              <p className="listen-key-neighbours">
                {de ? "Harmonische Nachbarn" : "Harmonic neighbours"}:{" "}
                {compatibleKeys(sound.key).join(" · ")}
                <span>
                  {de
                    ? " · Bei Mixes kann die Tonart wechseln."
                    : " · Keys may change within a mix."}
                </span>
              </p>
            )}
          </>
        ) : (
          <p className="listen-sound-pending">
            {de
              ? "Sound-Details erscheinen, wenn der Player sie liefert."
              : "Sound details appear when the player provides them."}
          </p>
        )}
      </div>

      <div
        className="listen-vote-actions"
        aria-describedby="listen-vote-target"
      >
        <button
          className={`listen-vote${currentFeedback?.value === -1 ? " is-selected" : ""}`}
          type="button"
          aria-pressed={currentFeedback?.value === -1}
          onClick={() => onVote(-1, sound)}
        >
          <span aria-hidden="true">×</span> Dislike
        </button>
        <button
          className={`listen-vote listen-like${currentFeedback?.value === 1 ? " is-selected" : ""}`}
          type="button"
          aria-pressed={currentFeedback?.value === 1}
          onClick={() => onVote(1, sound)}
        >
          <span aria-hidden="true">♡</span> Like
        </button>
      </div>
      <p id="listen-vote-target" className="listen-vote-target">
        {sound
          ? de
            ? "Feedback zu diesem Sound. Danach geht’s weiter."
            : "Feedback on this sound. Then on to the next DJ."
          : de
            ? "Feedback zu diesem DJ. Danach geht’s weiter."
            : "Feedback on this DJ. Then on to the next DJ."}
      </p>
    </article>
  );
}

function NavigationControls({
  locale,
  canPrevious,
  canNext,
  onNext,
  onPrevious,
}: {
  locale: Locale;
  canPrevious: boolean;
  canNext: boolean;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const de = locale === "de";
  const zone = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const wheel = useRef({ amount: 0, last: 0, lockedUntil: 0 });

  useEffect(() => {
    const element = zone.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || event.ctrlKey)
        return;
      event.preventDefault();
      const now = Date.now();
      const movement = wheel.current;
      if (now < movement.lockedUntil) return;
      if (
        now - movement.last > 200 ||
        Math.sign(movement.amount) !== Math.sign(event.deltaY)
      )
        movement.amount = 0;
      movement.last = now;
      movement.amount +=
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
      if (Math.abs(movement.amount) < 65) return;
      movement.lockedUntil = now + 900;
      const next = movement.amount > 0;
      movement.amount = 0;
      if (next && canNext) onNext();
      else if (!next && canPrevious) onPrevious();
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [canNext, canPrevious, onNext, onPrevious]);

  return (
    <div className="listen-navigation">
      <div className="listen-navigation-buttons">
        <button
          className="listen-previous"
          type="button"
          disabled={!canPrevious}
          onClick={onPrevious}
        >
          <Icon name="arrow-left" />
          {de ? "Zurück" : "Previous"}
        </button>
        <button
          className="listen-next"
          type="button"
          disabled={!canNext}
          onClick={onNext}
        >
          {de ? "Weiter" : "Next"}
          <Icon name="arrow-down" />
        </button>
      </div>
      <div
        ref={zone}
        className="listen-swipe-zone"
        tabIndex={0}
        role="group"
        aria-label={
          de
            ? "Weiterwischen: nach oben für den nächsten DJ, nach unten zurück"
            : "Swipe up for the next DJ, down for the previous DJ"
        }
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          gesture.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
        onPointerUp={(event) => {
          const start = gesture.current;
          gesture.current = null;
          if (!start) return;
          const x = event.clientX - start.x;
          const y = event.clientY - start.y;
          if (Math.abs(y) < 40 || Math.abs(y) < Math.abs(x) * 1.2) return;
          if (y < 0 && canNext) onNext();
          else if (y > 0 && canPrevious) onPrevious();
        }}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey ||
            event.repeat
          )
            return;
          if (event.key === "ArrowDown" && canNext) {
            event.preventDefault();
            onNext();
          } else if (event.key === "ArrowUp" && canPrevious) {
            event.preventDefault();
            onPrevious();
          }
        }}
      >
        <Icon name="arrow-down" />
        <p>
          {de
            ? "Hier hochwischen oder weiterscrollen"
            : "Swipe up or scroll here to move on"}
          <span>
            {de
              ? "Weiter ist neutral. Nur Like / Dislike zählt."
              : "Next is neutral. Only Like / Dislike gives feedback."}
          </span>
        </p>
      </div>
      <p id="listen-keyboard-help" className="listen-keyboard-help">
        {de ? "Auf der DJ-Karte" : "On the DJ card"}: <kbd>↓</kbd>{" "}
        {de ? "Weiter" : "Next"} · <kbd>↑</kbd> {de ? "Zurück" : "Previous"} ·{" "}
        <kbd>L</kbd> Like · <kbd>D</kbd> Dislike
      </p>
    </div>
  );
}

export function ListenFeed({
  cards,
  locale,
  now,
}: {
  cards: ListenCard[];
  locale: Locale;
  now: number;
}) {
  const { state, storage } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const { settings, feedback } = state;
  const [journey, setJourney] = useState<Journey>(freshJourney);
  const [undo, setUndo] = useState<{
    state: ListenState;
    journey: Journey;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [showAllNights, setShowAllNights] = useState(false);
  const de = locale === "de";
  const ranked = useMemo(
    () => rankListenCards(cards, settings, feedback, now),
    [cards, settings, feedback, now],
  );
  const recommendations = useMemo(
    () => savedNights(ranked.cards, feedback),
    [ranked.cards, feedback],
  );
  const selectedId = journey.trail[journey.index];
  const active = journey.ended
    ? undefined
    : (ranked.cards.find((card) => card.artist.id === selectedId) ??
      ranked.cards[0]);
  const activeJourney =
    active && selectedId !== active.artist.id
      ? { trail: [active.artist.id], index: 0, ended: false }
      : journey;
  const canPrevious = journey.ended
    ? journey.trail.length > 0
    : activeJourney.index > 0;
  const hasLikes = feedback.some((entry) => entry.value === 1);
  const firstEvent = active?.events[0];
  const knownOrigin =
    settings.origin === DEFAULT_LISTEN_SETTINGS.origin ||
    LISTEN_LOCATIONS.some((location) => location.id === settings.origin);

  function next(nextFeedback = feedback) {
    if (!active) return;
    const currentTrail = activeJourney.trail.length
      ? activeJourney.trail
      : [active.artist.id];
    const pool = rankListenCards(cards, settings, nextFeedback, now).cards;
    const futureId = currentTrail
      .slice(activeJourney.index + 1)
      .find((id) => pool.some((card) => card.artist.id === id));
    const nextId =
      futureId ??
      pool.find((card) => !currentTrail.includes(card.artist.id))?.artist.id;
    if (nextId) {
      const trail = [...currentTrail.slice(0, activeJourney.index + 1), nextId];
      setJourney({ trail, index: trail.length - 1, ended: false });
    } else
      setJourney({
        trail: currentTrail,
        index: activeJourney.index,
        ended: true,
      });
    focusCard();
  }

  function previous() {
    if (!canPrevious) return;
    if (journey.ended) setJourney({ ...journey, ended: false });
    else setJourney({ ...activeJourney, index: activeJourney.index - 1 });
    focusCard();
  }

  function vote(value: 1 | -1, sound: SoundMetadata | null) {
    if (!active) return;
    const nextFeedback = upsertFeedback(feedback, {
      artistId: active.artist.id,
      genres: active.genres,
      sound,
      value,
      updatedAt: Date.now(),
    });
    setUndo({ state, journey: activeJourney });
    saveState({ settings, feedback: nextFeedback });
    const target = sound?.title ?? active.artist.name;
    setAnnouncement(
      de
        ? `${value === 1 ? "Like" : "Dislike"} für ${target}${getSnapshot().storage === "session" ? " für diese Sitzung" : ""} gespeichert.`
        : `${value === 1 ? "Like" : "Dislike"} saved for ${target}${getSnapshot().storage === "session" ? " for this session" : ""}.`,
    );
    next(nextFeedback);
  }

  function changeSettings(nextSettings: ListenSettings) {
    saveState({ settings: nextSettings, feedback });
    setJourney(freshJourney);
    setUndo(null);
    setAnnouncement("");
  }

  function reset() {
    setUndo({ state, journey: activeJourney });
    saveState({ settings: DEFAULT_LISTEN_SETTINGS, feedback: [] });
    setJourney(freshJourney);
    setAnnouncement(
      de
        ? "Hörauswahl und Feedback zurückgesetzt."
        : "Listening filters and feedback reset.",
    );
  }

  return (
    <>
      <div className="listen-feed needs-js">
        <div
          className="listen-filters"
          aria-label={de ? "Nächte eingrenzen" : "Filter nights"}
        >
          <label>
            <span>{de ? "Startpunkt" : "Starting city"}</span>
            <select
              name="origin"
              value={settings.origin}
              disabled={storage === "checking"}
              onChange={(event) =>
                changeSettings({ ...settings, origin: event.target.value })
              }
            >
              <option value={DEFAULT_LISTEN_SETTINGS.origin}>
                {de ? "Überall" : "Everywhere"}
              </option>
              {!knownOrigin && (
                <option value={settings.origin}>
                  {de
                    ? "Startpunkt nicht verfügbar"
                    : "Starting city unavailable"}
                </option>
              )}
              {LISTEN_LOCATIONS.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name} ({location.country})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Radius</span>
            <select
              name="radius"
              value={settings.radiusKm}
              disabled={
                storage === "checking" ||
                settings.origin === DEFAULT_LISTEN_SETTINGS.origin
              }
              onChange={(event) =>
                changeSettings({
                  ...settings,
                  radiusKm: Number(event.target.value),
                })
              }
            >
              {![25, 50, 100, 250, 500].includes(settings.radiusKm) && (
                <option value={settings.radiusKm}>
                  {settings.radiusKm} km
                </option>
              )}
              {[25, 50, 100, 250, 500].map((radius) => (
                <option key={radius} value={radius}>
                  {radius} km
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{de ? "Zeitraum" : "Date range"}</span>
            <select
              name="days"
              value={settings.days}
              disabled={storage === "checking"}
              onChange={(event) => {
                const days = Number(event.target.value);
                if (days === 7 || days === 30 || days === 90)
                  changeSettings({ ...settings, days });
              }}
            >
              {[7, 30, 90].map((days) => (
                <option key={days} value={days}>
                  {days} {de ? "Tage" : "days"}
                </option>
              ))}
            </select>
          </label>
        </div>
        {settings.origin !== DEFAULT_LISTEN_SETTINGS.origin &&
          ranked.unlocatedEventCount > 0 && (
            <p className="listen-location-notice" role="status">
              {de
                ? `${ranked.unlocatedEventCount} Nächte ohne bekannte Stadtkoordinaten sind im Radius nicht enthalten.`
                : `${ranked.unlocatedEventCount} nights without known city coordinates are excluded from this radius.`}
            </p>
          )}

        <div className="listen-layout">
          <div className="listen-main">
            {active ? (
              <ActiveCard
                key={`${active.artist.id}:${active.artist.soundcloudUrl}`}
                card={active}
                locale={locale}
                feedback={feedback}
                position={activeJourney.index + 1}
                total={ranked.cards.length}
                onVote={vote}
                onNext={() => next()}
                onPrevious={previous}
              />
            ) : (
              <section
                id="listen-current-card"
                tabIndex={-1}
                className="listen-empty"
                aria-labelledby="listen-empty-heading"
              >
                <Icon
                  name={
                    journey.ended && ranked.cards.length ? "wave" : "search"
                  }
                />
                <h2 id="listen-empty-heading">
                  {journey.ended && ranked.cards.length
                    ? de
                      ? "Du bist durch"
                      : "You’ve reached the end"
                    : de
                      ? "Hier ist es gerade still"
                      : "It’s quiet here right now"}
                </h2>
                <p>
                  {journey.ended && ranked.cards.length
                    ? de
                      ? "Deine Likes und Nächte bleiben hier. Hör noch einmal rein oder erweitere deine Auswahl."
                      : "Your likes and nights stay here. Listen again or widen your filters."
                    : cards.length
                      ? de
                        ? "Für diese Auswahl gibt es gerade keine DJs mit SoundCloud und einer angekündigten Nacht. Wähle mehr Tage oder einen größeren Radius."
                        : "No DJs with SoundCloud and an announced night match these filters. Try more days or a wider radius."
                      : de
                        ? "Sobald ein DJ mit verifiziertem SoundCloud-Profil eine kommende Nacht spielt, kannst du hier reinhören."
                        : "When a DJ with a verified SoundCloud profile has an upcoming night, you can listen here."}
                </p>
                {journey.ended && ranked.cards.length > 0 ? (
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setJourney(freshJourney);
                      focusCard();
                    }}
                  >
                    {de ? "Noch einmal hören" : "Listen again"}
                  </button>
                ) : cards.length > 0 ? (
                  <button
                    className="button"
                    type="button"
                    onClick={() =>
                      changeSettings({ ...DEFAULT_LISTEN_SETTINGS, days: 90 })
                    }
                  >
                    {de ? "Überall · 90 Tage" : "Everywhere · 90 days"}
                  </button>
                ) : null}
                <Link
                  className="listen-empty-link"
                  href={localizePath("/", locale)}
                >
                  {de ? "Alle Nächte ansehen" : "Browse all nights"}
                  <Icon name="arrow-up-right" />
                </Link>
              </section>
            )}

            <NavigationControls
              locale={locale}
              canPrevious={canPrevious}
              canNext={Boolean(active)}
              onNext={() => next()}
              onPrevious={previous}
            />
            <div className="listen-feedback-status">
              <p role="status" aria-live="polite">
                {announcement ||
                  (feedback.length
                    ? de
                      ? `${feedback.length} Bewertungen ${storage === "session" ? "in dieser Sitzung" : "auf diesem Gerät"}.`
                      : `${feedback.length} ratings ${storage === "session" ? "in this session" : "on this device"}.`
                    : de
                      ? "Deine Likes bestimmen, was als Nächstes kommt."
                      : "Your likes shape what comes next.")}
              </p>
              {undo && (
                <button
                  type="button"
                  onClick={() => {
                    saveState(undo.state);
                    setJourney(undo.journey);
                    setUndo(null);
                    setAnnouncement(
                      de
                        ? "Letzte Änderung rückgängig gemacht."
                        : "Last change undone.",
                    );
                    focusCard();
                  }}
                >
                  {de ? "Rückgängig" : "Undo"}
                </button>
              )}
            </div>
            {recommendations.length > 0 && (
              <a className="listen-saved-jump" href="#listen-nights-heading">
                {de ? "Deine Nächte" : "Your nights"} ({recommendations.length})
                <Icon name="arrow-down" />
              </a>
            )}
            {storage === "session" && (
              <p className="listen-storage-notice" role="status">
                {de
                  ? "Speichern ist nicht möglich. Dein Feedback gilt nur für diese Sitzung."
                  : "Saving is unavailable. Your feedback lasts for this session only."}
              </p>
            )}
            {active && firstEvent && (
              <section
                className="listen-card-events"
                aria-label={de ? "Diesen DJ live hören" : "Hear this DJ live"}
              >
                <p className="eyebrow">
                  {de
                    ? `${active.artist.name} live erleben`
                    : `Hear ${active.artist.name} live`}
                </p>
                <NightRow event={firstEvent} artists={[]} locale={locale} />
                {active.events.length > 1 && (
                  <details
                    className="listen-more-nights"
                    key={active.artist.id}
                  >
                    <summary>
                      {de
                        ? `${active.events.length - 1} weitere Nächte`
                        : `${active.events.length - 1} more nights`}
                    </summary>
                    {active.events.slice(1).map((event) => (
                      <NightRow
                        key={event.id}
                        event={event}
                        artists={[]}
                        locale={locale}
                      />
                    ))}
                  </details>
                )}
              </section>
            )}
          </div>

          <aside
            className="listen-recommendations"
            aria-labelledby="listen-nights-heading"
          >
            <header>
              <h2 id="listen-nights-heading">
                {de ? "Deine Nächte" : "Your nights"}
              </h2>
              <span>{recommendations.length}</span>
            </header>
            <p className="listen-recommendations-intro">
              {de
                ? "Nächte mit DJs aus deinen Likes. Sie bleiben beim Weiterhören hier."
                : "Nights with DJs from your likes. They stay here as you listen."}
            </p>
            {recommendations.length ? (
              <>
                {(showAllNights
                  ? recommendations
                  : recommendations.slice(0, 6)
                ).map(({ event, artists }) => (
                  <NightRow
                    key={event.id}
                    event={event}
                    artists={artists}
                    locale={locale}
                  />
                ))}
                {recommendations.length > 6 && (
                  <button
                    className="listen-show-nights"
                    type="button"
                    onClick={() => setShowAllNights((shown) => !shown)}
                  >
                    {showAllNights
                      ? de
                        ? "Weniger anzeigen"
                        : "Show fewer"
                      : de
                        ? `Alle ${recommendations.length} Nächte anzeigen`
                        : `Show all ${recommendations.length} nights`}
                  </button>
                )}
              </>
            ) : (
              <div className="listen-saved-empty">
                <span aria-hidden="true">♡</span>
                <p>
                  {hasLikes
                    ? de
                      ? "Zu deinen Likes gibt es gerade keine Nächte in dieser Auswahl. Ändere Stadt, Radius oder Zeitraum."
                      : "No nights from your likes match these filters right now. Change the city, radius or date range."
                    : de
                      ? "Ein Sound gefällt dir? Gib ihm ein Like – die Nächte mit diesem DJ landen hier."
                      : "Like a sound? Give it a Like — nights with that DJ appear here."}
                </p>
              </div>
            )}
            <a
              className="listen-catalogue-link"
              href={localizePath("/", locale)}
            >
              {de ? "Zum Nachtprogramm" : "Browse the programme"}
              <Icon name="arrow-up-right" />
            </a>
          </aside>
        </div>

        <div className="listen-footnotes">
          <p>
            {storage === "session"
              ? de
                ? "Speichern ist in diesem Browser nicht möglich. Deine Auswahl gilt nur für diese Sitzung."
                : "This browser cannot save your choices. They last for this session only."
              : de
                ? "Nur auf diesem Gerät gespeichert. Kein Konto, keine SoundCloud-Likes."
                : "Saved only on this device. No account or SoundCloud likes."}
          </p>
          <button type="button" onClick={reset}>
            {de ? "Alles zurücksetzen" : "Reset everything"}
          </button>
          <p className="listen-distance-note">
            {de
              ? "Entfernung: ungefähre Luftlinie zwischen Stadtzentren."
              : "Distance: approximate straight line between city centres."}{" "}
            <a
              href="https://www.geonames.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              GeoNames
            </a>{" "}
            ·{" "}
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank"
              rel="noopener noreferrer"
            >
              CC BY 4.0
            </a>
          </p>
        </div>
      </div>

      <noscript>
        <div className="listen-no-script">
          <h2>
            {de
              ? "Direkt zur nächsten Nacht"
              : "Go straight to your next night"}
          </h2>
          <p>
            {de
              ? "Der Hör-Feed benötigt JavaScript. DJs und Nächte kannst du auch ohne JavaScript entdecken."
              : "The listening feed needs JavaScript. You can still browse DJs and nights without it."}
          </p>
          <Link className="button" href={localizePath("/djs", locale)}>
            {de ? "DJs entdecken" : "Discover DJs"}
          </Link>
          <Link
            className="button button-outline"
            href={localizePath("/", locale)}
          >
            {de ? "Nächte ansehen" : "Browse nights"}
          </Link>
        </div>
      </noscript>

      <details className="listen-key-reference">
        <summary>
          {de ? "Tonarten & Camelot-Schlüssel" : "Keys & Camelot reference"}
        </summary>
        <p>
          {de
            ? "Die gleiche Nummer in A/B, dieselbe Tonart und die Nachbarn im Ring sind grundlegende harmonische Optionen. Das sagt nichts über deinen Geschmack aus und garantiert keinen Übergang. Bei einem Mix können mehrere Tonarten vorkommen."
            : "The same number in A/B, the same key and adjacent numbers on the ring are basic harmonic options. They do not predict your taste or guarantee a transition. A mix may contain several keys."}
        </p>
        <ol>
          {CAMELOT_KEYS.map((entry) => (
            <li key={entry.key}>
              <strong>{entry.key}</strong>
              <span>{de ? entry.nameDe : entry.nameEn}</span>
              <small>{compatibleKeys(entry.key).join(" · ")}</small>
            </li>
          ))}
        </ol>
        <a
          href="https://mixedinkey.com/camelot-wheel/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {de ? "Referenz: Camelot Wheel" : "Reference: Camelot Wheel"}
          <Icon name="arrow-up-right" />
        </a>
      </details>
    </>
  );
}
