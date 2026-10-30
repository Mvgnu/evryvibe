"use client";

import Link from "next/link";
import { SOUNDCLOUD_EMBEDS_ENABLED } from "@/core/media-features";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Icon } from "@/components/icon";
import { useProviderConsent } from "@/components/media-consent";
import {
  useSoundcloudPlayer,
  type PlayerStatus,
} from "@/components/soundcloud-player";
import { loadReelState, saveReelVotes } from "@/components/reel-storage";
import type { MapNight } from "@/components/night-map-data";
import type { ListenDj } from "@/core/night-map";
import { addVote, tasteOf, type ReelVote } from "@/core/reels";
import { localizePath, type Locale } from "@/core/i18n";

export type ListenItem = { dj: ListenDj; night: MapNight };
type Listening = { items: ListenItem[]; index: number };
type MapListening = {
  listening: Listening | null;
  setListening: Dispatch<SetStateAction<Listening | null>>;
  current: ListenItem | null;
  votes: ReelVote[];
  setVotes: Dispatch<SetStateAction<ReelVote[]>>;
  requestedPlace: { key: string; seq: number } | null;
  clearRequestedPlace: () => void;
};
const Context = createContext<MapListening | null>(null);
const t = (locale: Locale, de: string, en: string) =>
  locale === "en" ? en : de;
export function useMapListening() {
  const value = useContext(Context);
  if (!value) throw new Error("MapListeningProvider is missing");
  return value;
}

// Root-layout lifetime: navigation must never replace the playing iframe.
export function MapListeningProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const locale: Locale = /^\/en(?:\/|$)/.test(pathname) ? "en" : "de";
  const { consent, accept } = useProviderConsent("soundcloud");
  const [listening, setListening] = useState<Listening | null>(null);
  const [votes, setVotes] = useState<ReelVote[]>([]);
  const [requestedPlace, setRequestedPlace] = useState<{
    key: string;
    seq: number;
  } | null>(null);
  const clearRequestedPlace = useCallback(() => setRequestedPlace(null), []);
  const shell = useRef<HTMLDivElement>(null);
  const current = listening?.items[listening.index] ?? null;
  const player = useSoundcloudPlayer(
    consent === "accepted" && current ? current.dj.soundcloudUrl : null,
    votes,
  );
  useEffect(() => {
    const sync = () => setVotes(loadReelState().votes);
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("evryvibe-reels-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("evryvibe-reels-change", sync);
    };
  }, []);
  const hasCurrent = Boolean(current);
  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    const update = () =>
      document.documentElement.style.setProperty(
        "--map-player-h",
        `${element.getBoundingClientRect().height}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--map-player-h");
    };
  }, [hasCurrent]);
  const next = useCallback(
    () =>
      setListening((value) =>
        value && value.index + 1 < value.items.length
          ? { ...value, index: value.index + 1 }
          : null,
      ),
    [],
  );
  const played = useRef<string | null>(null);
  const currentDj = current?.dj.id ?? null;
  useEffect(() => {
    if (player.status === "playing") played.current = currentDj;
    if (player.status !== "empty" || played.current === currentDj) return;
    const timer = window.setTimeout(next, 3500);
    return () => window.clearTimeout(timer);
  }, [player.status, currentDj, next]);
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
    const updated = addVote(loadReelState().votes, entry);
    setVotes(updated);
    saveReelVotes(updated);
    if (value === -1) next();
  };
  return (
    <Context.Provider
      value={{
        listening,
        setListening,
        current,
        votes,
        setVotes,
        requestedPlace,
        clearRequestedPlace,
      }}
    >
      {children}
      {listening && current && (
        <div className="map-player-shell" ref={shell}>
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
            liked={(tasteOf(votes).djs.get(current.dj.id) ?? 0) > 0}
            onToggle={player.toggle}
            onNext={next}
            onLike={() => vote(1)}
            onDislike={() => vote(-1)}
            onShowNight={() => {
              if (!current.night.place) return;
              setRequestedPlace((value) => ({
                key: current.night.place ?? "",
                seq: (value?.seq ?? 0) + 1,
              }));
              router.push(localizePath("/", locale) + "#karte");
            }}
            onClose={() => setListening(null)}
          />
        </div>
      )}
    </Context.Provider>
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
    return (
      <div
        className="nm-dock nm-dock-consent"
        role="region"
        aria-label={t(locale, "SoundCloud-Player", "SoundCloud player")}
      >
        <p>
          {t(
            locale,
            "SoundCloud-Player derzeit deaktiviert.",
            "SoundCloud player currently disabled.",
          )}
        </p>
        <div className="nm-dock-choices">
          <a
            className="chip-button"
            href={dj.soundcloudUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t(locale, "Auf SoundCloud anhören", "Listen on SoundCloud")}{" "}
            <Icon name="arrow-up-right" />
          </a>
          {closeButton}
        </div>
      </div>
    );
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
