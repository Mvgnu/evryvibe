"use client";

import Link from "next/link";
import { SOUNDCLOUD_EMBEDS_ENABLED } from "@/core/media-features";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "@/components/icon";
import { useProviderConsent } from "@/components/media-consent";
import { SoundTile } from "@/components/poster";
import { loadReelState, saveReelState } from "@/components/reel-storage";
import {
  useSoundcloudPlayer,
  type PlayerStatus,
} from "@/components/soundcloud-player";
import { localizePath, type Locale } from "@/core/i18n";
import {
  distanceKm,
  LOCATIONS,
  locationById,
  nearestLocation,
} from "@/core/locations";
import {
  addVote,
  likedNights,
  RADIUS_CHOICES,
  rankReels,
  tasteOf,
  type RankedReel,
  type Reel,
  type ReelSettings,
  type ReelVote,
  type Sound,
} from "@/core/reels";
import { posterSeed, soundFamily } from "@/core/sound";

type Props = { reels: Reel[]; locale: Locale };
type Phase = "loading" | "setup" | "feed";

const NEAREST_CITY_LIMIT_KM = 150;

const t = (locale: Locale, de: string, en: string) =>
  locale === "en" ? en : de;

const save = saveReelState;
const load = loadReelState;

function nightLabel(startsAt: string, timezone: string, locale: Locale) {
  const parts = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(startsAt));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("weekday").replace(".", "")} ${part("day")}.${part("month")}. · ${part("hour")}:${part("minute")}`;
}

function distanceLabel(distanceKm: number | null) {
  return distanceKm !== null && distanceKm >= 1 ? ` · ${distanceKm} km` : "";
}

function placeLabel(settings: ReelSettings | null, locale: Locale) {
  const origin = settings?.origin ? locationById(settings.origin) : undefined;
  if (!origin) return t(locale, "Überall", "Everywhere");
  return settings?.radiusKm
    ? `${origin.name} · ${settings.radiusKm} km`
    : `${origin.name} · ${t(locale, "egal wie weit", "any distance")}`;
}

export function ReelsFeed({ reels, locale }: Props) {
  const { consent, accept } = useProviderConsent("soundcloud");
  const [phase, setPhase] = useState<Phase>("loading");
  const [settings, setSettings] = useState<ReelSettings | null>(null);
  const [votes, setVotes] = useState<ReelVote[]>([]);
  const [seed, setSeed] = useState(0);
  const [queue, setQueue] = useState<RankedReel[]>([]);
  const [index, setIndex] = useState(0);
  const [nightsOpen, setNightsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const stored = load();
    const nextSeed = Math.floor(Math.random() * 1e9);
    // Reading the device's saved choice can only happen after hydration.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSeed(nextSeed);
    setVotes(stored.votes);
    setSettings(stored.settings);
    if (stored.settings) {
      setQueue(
        rankReels(reels, stored.settings, stored.votes, nextSeed, Date.now())
          .reels,
      );
      setPhase("feed");
    } else setPhase("setup");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [reels]);

  // Setup and feed each start at the top; the setup's scroll position would
  // otherwise leave the feed half off-screen on short phones.
  useEffect(() => {
    if (phase !== "loading") window.scrollTo({ top: 0 });
  }, [phase]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const start = (next: ReelSettings) => {
    if (consent !== "accepted") accept();
    setSettings(next);
    save(next, votes);
    setQueue(rankReels(reels, next, votes, seed, Date.now()).reels);
    setIndex(0);
    setPhase("feed");
  };

  // A vote reorders only what has not been seen yet.
  const vote = (reel: RankedReel, value: 1 | -1, sound: Sound | null) => {
    const entry: ReelVote = {
      djId: reel.dj.id,
      value,
      genres: [...new Set([...reel.genres, ...(sound?.genres ?? [])])].slice(
        0,
        40,
      ),
      sound: sound
        ? { url: sound.url, tags: sound.tags, key: sound.key }
        : null,
      at: Date.now(),
    };
    const nextVotes = addVote(votes, entry);
    setVotes(nextVotes);
    save(settings, nextVotes);
    if (settings) {
      const seen = queue.slice(0, index + 1);
      const ids = new Set(seen.map((item) => item.dj.id));
      setQueue([
        ...seen,
        ...rankReels(reels, settings, nextVotes, seed, Date.now()).reels.filter(
          (item) => !ids.has(item.dj.id),
        ),
      ]);
    }
    return nextVotes;
  };

  const reset = () => {
    setVotes([]);
    save(settings, []);
    setNightsOpen(false);
    if (settings)
      setQueue(rankReels(reels, settings, [], seed, Date.now()).reels);
    setIndex(0);
  };

  if (!SOUNDCLOUD_EMBEDS_ENABLED) return <section className="reels-intro">
    <h1>Reels</h1><p>{t(locale, "SoundCloud-Embeds sind derzeit deaktiviert. Du kannst die Künstler direkt auf SoundCloud anhören.", "SoundCloud embeds are currently disabled. Listen to the artists directly on SoundCloud.")}</p>
    <Link className="button" href={localizePath("/",locale)}>{t(locale, "Nächte entdecken", "Explore nights")}</Link>
    <ul>{reels.slice(0,20).map(reel=><li key={reel.dj.id}><a href={reel.dj.soundcloudUrl} target="_blank" rel="noopener noreferrer">{reel.dj.name} · SoundCloud ↗</a></li>)}</ul>
  </section>;
  if (phase === "loading")
    return <div className="reels-shell" aria-busy="true" />;
  if (phase === "setup")
    return (
      <Setup
        reels={reels}
        locale={locale}
        initial={settings}
        consentNeeded={consent !== "accepted"}
        onStart={start}
        onCancel={settings ? () => setPhase("feed") : undefined}
      />
    );
  return (
    <Feed
      queue={queue}
      index={index}
      setIndex={setIndex}
      locale={locale}
      settings={settings}
      votes={votes}
      consent={consent}
      accept={accept}
      onVote={(reel, value, sound) => {
        const nextVotes = vote(reel, value, sound);
        if (value === 1) {
          const night = reel.events[0];
          setToast(
            night
              ? t(locale, `Gemerkt: ${night.title}`, `Saved: ${night.title}`)
              : t(locale, "Gemerkt", "Saved"),
          );
        }
        return nextVotes;
      }}
      onChangePlace={() => setPhase("setup")}
      nightsOpen={nightsOpen}
      setNightsOpen={setNightsOpen}
      onReset={reset}
      toast={toast}
    />
  );
}

// ─── Step 1: how far will you travel? ───

function Setup({
  reels,
  locale,
  initial,
  consentNeeded,
  onStart,
  onCancel,
}: {
  reels: Reel[];
  locale: Locale;
  initial: ReelSettings | null;
  consentNeeded: boolean;
  onStart: (settings: ReelSettings) => void;
  onCancel?: () => void;
}) {
  const [now] = useState(() => Date.now());
  const [origin, setOrigin] = useState(initial?.origin ?? "");
  const [radiusKm, setRadiusKm] = useState<number | null>(
    initial ? initial.radiusKm : 100,
  );
  const [locating, setLocating] = useState<
    | { state: "idle" | "busy" | "failed" | "far" }
    | { state: "found"; name: string; km: number }
  >({ state: "idle" });
  const draft: ReelSettings = { origin, radiusKm: origin ? radiusKm : null };
  const result = useMemo(
    () => rankReels(reels, draft, [], 0, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reels, origin, radiusKm, now],
  );
  // DJs per radius, so an empty choice points at one that has nights.
  const perRadius = useMemo(
    () =>
      new Map(
        RADIUS_CHOICES.map((choice) => [
          choice,
          origin
            ? rankReels(reels, { origin, radiusKm: choice }, [], 0, now).reels
                .length
            : null,
        ]),
      ),
    [reels, origin, now],
  );
  const nights = new Set(
    result.reels.flatMap((reel) => reel.events.map((event) => event.id)),
  ).size;
  const places = useMemo(
    () => [...LOCATIONS].sort((a, b) => a.name.localeCompare(b.name, "de")),
    [],
  );

  // The position only picks the nearest listed city; it is never stored.
  const locate = () => {
    if (!("geolocation" in navigator)) return setLocating({ state: "failed" });
    setLocating({ state: "busy" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const place = nearestLocation(coords);
        const km = place ? Math.round(distanceKm(coords, place)) : Infinity;
        if (!place || km > NEAREST_CITY_LIMIT_KM)
          return setLocating({ state: "far" });
        setOrigin(place.id);
        setLocating({ state: "found", name: place.name, km });
      },
      () => setLocating({ state: "failed" }),
      { maximumAge: 600_000, timeout: 10_000 },
    );
  };

  return (
    <section className="reels-setup" aria-labelledby="reels-setup-title">
      <p className="reels-eyebrow">Reels</p>
      <h1 id="reels-setup-title">
        {t(locale, "Wie weit fährst du?", "How far will you go?")}
      </h1>
      <p className="reels-setup-lede">
        {t(
          locale,
          "Danach hörst du dich durch die DJs, die in deiner Nähe spielen. Like, was dich packt – der Feed lernt mit und merkt dir die Nächte.",
          "Then listen your way through DJs playing near you. Like what grabs you – the feed learns and keeps the nights for you.",
        )}
      </p>

      <div className="reels-field">
        <label htmlFor="reels-origin">{t(locale, "Von", "From")}</label>
        <div className="reels-origin">
          <select
            id="reels-origin"
            value={origin}
            onChange={(event) => {
              setOrigin(event.target.value);
              setLocating({ state: "idle" });
            }}
          >
            <option value="">
              {t(locale, "Überall (kein Radius)", "Everywhere (no radius)")}
            </option>
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="chip-button"
            onClick={locate}
            disabled={locating.state === "busy"}
          >
            {locating.state === "busy"
              ? t(locale, "Suche …", "Locating …")
              : t(locale, "Mein Standort", "My location")}
          </button>
        </div>
        {locating.state === "failed" && (
          <p className="reels-note" role="status">
            {t(
              locale,
              "Standort nicht verfügbar. Wähl einfach eine Stadt.",
              "Location unavailable. Just pick a city.",
            )}
          </p>
        )}
        {locating.state === "far" && (
          <p className="reels-note" role="status">
            {t(
              locale,
              "In deiner Nähe kennen wir noch keine Stadt. Wähl eine aus der Liste.",
              "We don't know a city near you yet. Pick one from the list.",
            )}
          </p>
        )}
        {locating.state === "found" && (
          <p className="reels-note" role="status">
            {locating.km < 5
              ? t(
                  locale,
                  `Du bist in ${locating.name}.`,
                  `You're in ${locating.name}.`,
                )
              : t(
                  locale,
                  `Nächste Stadt: ${locating.name} (≈ ${locating.km} km von dir). Der Radius zählt ab dort.`,
                  `Nearest city: ${locating.name} (≈ ${locating.km} km from you). The radius counts from there.`,
                )}
          </p>
        )}
      </div>

      <fieldset className="reels-field" disabled={!origin}>
        <legend>{t(locale, "Radius", "Radius")}</legend>
        <div className="reels-radius">
          {RADIUS_CHOICES.map((choice) => (
            <button
              key={String(choice)}
              type="button"
              className="chip-button"
              aria-pressed={origin ? radiusKm === choice : choice === null}
              aria-label={
                (choice === null ? t(locale, "Egal", "Any") : `${choice} km`) +
                (perRadius.get(choice) !== null
                  ? `, ${perRadius.get(choice)} DJs`
                  : "")
              }
              onClick={() => setRadiusKm(choice)}
            >
              {choice === null ? t(locale, "Egal", "Any") : `${choice} km`}
              {perRadius.get(choice) !== null && (
                <span className="reels-radius-count">
                  {perRadius.get(choice)}
                  <span className="visually-hidden"> DJs</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </fieldset>

      <p className="reels-count" aria-live="polite">
        <strong>{result.reels.length}</strong>{" "}
        {t(
          locale,
          `DJs · ${nights} ${nights === 1 ? "Nacht" : "Nächte"} in den nächsten 90 Tagen`,
          `DJs · ${nights} ${nights === 1 ? "night" : "nights"} in the next 90 days`,
        )}
      </p>
      {!result.reels.length && (
        <p className="reels-note" role="status">
          {t(
            locale,
            "Hier spielt gerade kein DJ mit SoundCloud-Profil. Nimm einen größeren Radius – die Zahl an jedem Radius zeigt, wie viele DJs dort spielen.",
            "No DJ with a SoundCloud profile plays here right now. Pick a larger radius – the number on each radius shows how many DJs play there.",
          )}
        </p>
      )}

      <div className="reels-setup-actions">
        <button
          type="button"
          className="button button-primary reels-go"
          disabled={!result.reels.length}
          onClick={() => onStart(draft)}
        >
          <Icon name="play" />
          {t(locale, "Los geht's", "Let's go")}
        </button>
        {onCancel && (
          <button type="button" className="chip-button" onClick={onCancel}>
            {t(locale, "Zurück zum Feed", "Back to the feed")}
          </button>
        )}
      </div>
      {consentNeeded && (
        <p className="reels-note">
          {t(
            locale,
            "„Los geht's“ lädt den SoundCloud-Player. SoundCloud erhält dabei deine Verbindungsdaten und kann Cookies setzen. ",
            "“Let's go” loads the SoundCloud player. SoundCloud receives your connection details and may set cookies. ",
          )}
          <Link href={localizePath("/datenschutz", locale)}>
            {t(locale, "Datenschutz", "Privacy")}
          </Link>
        </p>
      )}
      <p className="reels-note">
        {t(
          locale,
          "Entfernungen sind Luftlinie zwischen Stadtzentren. Dein Standort und deine Likes bleiben auf diesem Gerät.",
          "Distances are straight lines between city centres. Your location and likes stay on this device.",
        )}
      </p>
    </section>
  );
}

// ─── Step 2: the reels ───

function Feed({
  queue,
  index,
  setIndex,
  locale,
  settings,
  votes,
  consent,
  accept,
  onVote,
  onChangePlace,
  nightsOpen,
  setNightsOpen,
  onReset,
  toast,
}: {
  queue: RankedReel[];
  index: number;
  setIndex: (index: number) => void;
  locale: Locale;
  settings: ReelSettings | null;
  votes: ReelVote[];
  consent: "unset" | "accepted" | "rejected";
  accept: () => void;
  onVote: (reel: RankedReel, value: 1 | -1, sound: Sound | null) => ReelVote[];
  onChangePlace: () => void;
  nightsOpen: boolean;
  setNightsOpen: (open: boolean) => void;
  onReset: () => void;
  toast: string | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const active = queue[index];
  const player = useSoundcloudPlayer(
    consent === "accepted" ? (active?.dj.soundcloudUrl ?? null) : null,
    votes,
  );
  const nights = useMemo(() => likedNights(queue, votes), [queue, votes]);
  const [burst, setBurst] = useState(0);

  const go = useCallback((next: number) => {
    const root = scroller.current;
    const target = root?.children[next];
    // Scroll the feed only, never the page around it.
    if (root && target instanceof HTMLElement)
      root.scrollTo({ top: target.offsetTop, behavior: "smooth" });
  }, []);

  // The reel that fills most of the screen is the one that plays.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const at = Number(entry.target.getAttribute("data-index"));
          if (entry.isIntersecting && Number.isInteger(at)) setIndex(at);
        }
      },
      { root, threshold: 0.6 },
    );
    for (const child of root.children) observer.observe(child);
    return () => observer.disconnect();
  }, [queue, setIndex]);

  const voteOf = (reel: RankedReel) => tasteOf(votes).djs.get(reel.dj.id) ?? 0;

  const like = (reel: RankedReel) => {
    setBurst((value) => value + 1);
    onVote(reel, 1, reel === active ? player.sound : null);
  };
  const dislike = (reel: RankedReel, at: number) => {
    onVote(reel, -1, reel === active ? player.sound : null);
    go(at + 1);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (nightsOpen || !active) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
      )
        return;
      if (event.key === "ArrowDown" || event.key === "j") go(index + 1);
      else if (event.key === "ArrowUp" || event.key === "k") go(index - 1);
      else if (event.key === "l") like(active);
      else if (event.key === "d") dislike(active, index);
      else if (event.key === "n") player.next();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="reels-shell">
      <div className="reels-bar">
        <button type="button" className="reels-place" onClick={onChangePlace}>
          <span className="visually-hidden">
            {t(locale, "Ort und Radius ändern:", "Change place and radius:")}
          </span>
          {placeLabel(settings, locale)}
          <Icon name="chevron-down" />
        </button>
        <button
          type="button"
          className="reels-nights-button"
          aria-expanded={nightsOpen}
          onClick={() => setNightsOpen(!nightsOpen)}
        >
          <Icon name="heart" className={nights.length ? "filled" : ""} />
          <span className="reels-bar-label">
            {t(locale, "Meine Nächte", "My nights")}
          </span>
          <span className="reels-badge">{nights.length}</span>
        </button>
      </div>

      {queue.length ? (
        <div
          ref={scroller}
          className="reels-scroller"
          aria-label={t(locale, "Reels", "Reels")}
        >
          {queue.map((reel, at) => (
            <ReelCard
              key={reel.dj.id}
              reel={reel}
              at={at}
              total={queue.length}
              near={Math.abs(at - index) <= 2}
              activeSound={at === index ? player.sound : null}
              status={at === index ? player.status : "idle"}
              liked={voteOf(reel) > 0}
              burst={at === index ? burst : 0}
              locale={locale}
              onLike={() => like(reel)}
              onDislike={() => dislike(reel, at)}
              onNextTrack={player.next}
              onToggle={player.toggle}
            />
          ))}
          <section className="reel reel-end" data-index={queue.length}>
            <h2>{t(locale, "Das war's für hier.", "That's all for here.")}</h2>
            <p>
              {t(
                locale,
                "Mehr DJs gibt es mit größerem Radius.",
                "A larger radius brings more DJs.",
              )}
            </p>
            <button type="button" className="button" onClick={onChangePlace}>
              {t(locale, "Radius ändern", "Change radius")}
            </button>
          </section>
        </div>
      ) : (
        <div className="reels-empty">
          <p>
            {t(
              locale,
              "In diesem Radius spielt gerade kein DJ mit SoundCloud-Profil.",
              "No DJ with a SoundCloud profile is playing within this radius.",
            )}
          </p>
          <button type="button" className="button" onClick={onChangePlace}>
            {t(locale, "Radius ändern", "Change radius")}
          </button>
        </div>
      )}

      <div className="reels-player">
        {consent === "accepted" ? (
          player.frame
        ) : (
          <div className="reels-player-consent">
            <p>
              {t(
                locale,
                "Der SoundCloud-Player ist aus. Er lädt erst, wenn du zustimmst.",
                "The SoundCloud player is off. It loads only when you agree.",
              )}
            </p>
            <button
              type="button"
              className="button button-primary"
              onClick={accept}
            >
              <Icon name="play" />
              {t(locale, "SoundCloud laden", "Load SoundCloud")}
            </button>
          </div>
        )}
      </div>

      {toast && (
        <p className="reels-toast" role="status">
          <Icon name="heart" className="filled" />
          {toast}
        </p>
      )}

      {nightsOpen && (
        <Nights
          nights={nights}
          locale={locale}
          votes={votes.length}
          onClose={() => setNightsOpen(false)}
          onReset={onReset}
        />
      )}
    </div>
  );
}

function ReelCard({
  reel,
  at,
  total,
  near,
  activeSound,
  status,
  liked,
  burst,
  locale,
  onLike,
  onDislike,
  onNextTrack,
  onToggle,
}: {
  reel: RankedReel;
  at: number;
  total: number;
  near: boolean;
  activeSound: Sound | null;
  status: PlayerStatus;
  liked: boolean;
  burst: number;
  locale: Locale;
  onLike: () => void;
  onDislike: () => void;
  onNextTrack: () => void;
  onToggle: () => void;
}) {
  const tap = useRef<number | null>(null);
  const night = reel.events[0];
  const more = reel.events.length - 1;
  // One tap plays or pauses, a double tap likes.
  const onArtTap = () => {
    if (tap.current !== null) {
      window.clearTimeout(tap.current);
      tap.current = null;
      onLike();
      return;
    }
    tap.current = window.setTimeout(() => {
      tap.current = null;
      onToggle();
    }, 260);
  };

  return (
    <section
      className="reel"
      data-index={at}
      aria-roledescription="Reel"
      aria-label={`${reel.dj.name}, ${at + 1} / ${total}`}
    >
      {near && (
        <>
          <div className="reel-art" onClick={onArtTap}>
            {activeSound?.artworkUrl ? (
              // Artwork comes straight from SoundCloud's CDN after consent.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeSound.artworkUrl} alt="" />
            ) : (
              <SoundTile
                family={soundFamily(reel.genres)}
                seed={posterSeed(reel.dj.slug)}
              />
            )}
            {(status === "blocked" || status === "paused") && (
              <span className="reel-tap">
                <Icon name="play" />
                {status === "blocked"
                  ? t(locale, "Tippen zum Abspielen", "Tap to play")
                  : t(locale, "Pausiert", "Paused")}
              </span>
            )}
            {burst > 0 && (
              <span key={burst} className="reel-burst" aria-hidden="true">
                <Icon name="heart" className="filled" />
              </span>
            )}
          </div>

          <div className="reel-info">
            <p className="reel-genres">
              {reel.genres.slice(0, 3).join(" · ") ||
                t(locale, "Genre unbekannt", "Genre unknown")}
            </p>
            <h2 className="reel-dj">
              <Link href={localizePath(`/djs/${reel.dj.slug}`, locale)}>
                {reel.dj.name}
              </Link>
            </h2>
            <TrackLine sound={activeSound} status={status} locale={locale} />
            {night && (
              <div className="reel-night">
                <p className="reel-date">
                  {nightLabel(night.startsAt, night.timezone, locale)}
                </p>
                <Link
                  className="reel-event"
                  href={localizePath(`/events/${night.slug}`, locale)}
                >
                  {night.title}
                </Link>
                <p className="reel-place">
                  {night.venueName} · {night.city}
                  {distanceLabel(night.distanceKm)}
                </p>
                {night.lineup.length > 0 && (
                  <p className="reel-lineup">
                    {t(locale, "mit ", "with ")}
                    {night.lineup.slice(0, 3).join(", ")}
                    {night.lineup.length > 3 && ` +${night.lineup.length - 3}`}
                  </p>
                )}
                <div className="reel-actions">
                  {night.ticketUrl ? (
                    <a
                      className="button button-primary"
                      href={night.ticketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Tickets
                      <Icon name="arrow-up-right" />
                    </a>
                  ) : (
                    <span className="reel-noticket">
                      {t(locale, "Noch kein Ticketlink", "No ticket link yet")}
                    </span>
                  )}
                  <Link
                    className="chip-button"
                    href={localizePath(`/events/${night.slug}`, locale)}
                  >
                    {t(locale, "Event", "Event")}
                  </Link>
                  {more > 0 && (
                    <Link
                      className="chip-button"
                      href={localizePath(`/djs/${reel.dj.slug}`, locale)}
                    >
                      {t(
                        locale,
                        `+${more} ${more === 1 ? "Nacht" : "Nächte"}`,
                        `+${more} ${more === 1 ? "night" : "nights"}`,
                      )}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="reel-rail">
            <RailButton
              label={
                liked
                  ? t(locale, "Gemerkt", "Saved")
                  : t(locale, "Like", "Like")
              }
              pressed={liked}
              onClick={onLike}
            >
              <Icon name="heart" className={liked ? "filled" : ""} />
            </RailButton>
            <RailButton
              label={t(locale, "Nicht meins", "Not mine")}
              onClick={onDislike}
            >
              <Icon name="close" />
            </RailButton>
            <RailButton
              label={t(locale, "Nächster Track", "Next track")}
              onClick={onNextTrack}
            >
              <Icon name="skip" />
            </RailButton>
          </div>
        </>
      )}
    </section>
  );
}

function RailButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="reel-rail-button"
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function TrackLine({
  sound,
  status,
  locale,
}: {
  sound: Sound | null;
  status: PlayerStatus;
  locale: Locale;
}) {
  if (!sound)
    return (
      <p className="reel-track reel-track-wait">
        {status === "empty"
          ? t(
              locale,
              "Keine öffentlichen Tracks auf SoundCloud – einfach weiter",
              "No public tracks on SoundCloud – just keep going",
            )
          : status === "error"
            ? t(locale, "Player antwortet nicht", "Player not responding")
            : status === "idle"
              ? " "
              : t(locale, "Lädt …", "Loading …")}
      </p>
    );
  return (
    <p className="reel-track">
      <a href={sound.url} target="_blank" rel="noopener noreferrer">
        {sound.title}
      </a>
      {sound.key && <span className="reel-key">{sound.key}</span>}
      {sound.bpm && <span className="reel-key">{sound.bpm} BPM</span>}
    </p>
  );
}

function Nights({
  nights,
  locale,
  votes,
  onClose,
  onReset,
}: {
  nights: ReturnType<typeof likedNights>;
  locale: Locale;
  votes: number;
  onClose: () => void;
  onReset: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="reels-nights"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reels-nights-title"
    >
      <div className="reels-nights-head">
        <h2 id="reels-nights-title">
          {t(locale, "Meine Nächte", "My nights")}
        </h2>
        <button
          ref={closeRef}
          type="button"
          className="chip-button"
          onClick={onClose}
        >
          <Icon name="close" />
          {t(locale, "Schließen", "Close")}
        </button>
      </div>
      {nights.length ? (
        <ol className="reels-nights-list">
          {nights.map(({ event, dj }) => (
            <li key={event.id}>
              <p className="reel-date">
                {nightLabel(event.startsAt, event.timezone, locale)}
              </p>
              <Link href={localizePath(`/events/${event.slug}`, locale)}>
                {event.title}
              </Link>
              <p className="reel-place">
                {dj.name} · {event.venueName} · {event.city}
                {distanceLabel(event.distanceKm)}
              </p>
              {event.ticketUrl && (
                <a
                  className="chip-button"
                  href={event.ticketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Tickets <Icon name="arrow-up-right" />
                </a>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="reels-note">
          {t(
            locale,
            "Noch nichts gemerkt. Like einen DJ und seine Nächte landen hier.",
            "Nothing saved yet. Like a DJ and their nights land here.",
          )}
        </p>
      )}
      {votes > 0 && (
        <button type="button" className="chip-button" onClick={onReset}>
          <Icon name="refresh" />
          {t(locale, "Likes zurücksetzen", "Reset likes")}
        </button>
      )}
    </div>
  );
}
