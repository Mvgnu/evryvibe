"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "@/components/icon";
import { useProviderConsent } from "@/components/media-consent";
import type { Locale } from "@/core/i18n";
import {
  soundcloudPlayerUrl,
  soundcloudProfileSchema,
} from "@/core/soundcloud";

// SoundCloud's own player for a profile: it lists the profile's latest
// uploads, so sets appear without any track data stored here. Nothing is
// requested from SoundCloud before consent; the profile link always stays.
export function SoundcloudPlayer({
  url,
  name,
  locale = "de",
  size = "profile",
}: {
  url: string;
  name: string;
  locale?: Locale;
  size?: "profile" | "compact";
}) {
  const parsed = soundcloudProfileSchema.safeParse(url);
  const { consent, accept } = useProviderConsent("soundcloud");
  if (!parsed.success) return null;
  const profile = parsed.data;
  const de = locale === "de";
  return (
    <div className={`sc-player sc-${size}`}>
      {consent === "accepted" ? (
        <iframe
          title={
            de ? `SoundCloud-Player: ${name}` : `SoundCloud player: ${name}`
          }
          src={soundcloudPlayerUrl(profile)}
          loading="lazy"
          allow="autoplay; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="sc-placeholder">
          <p>
            {de
              ? "Der Player lädt erst nach deiner Zustimmung direkt von SoundCloud. SoundCloud erhält dabei deine Verbindungsdaten und kann Cookies setzen. Die Wahl gilt für alle Player und lässt sich in den Einstellungen ändern."
              : "The player loads directly from SoundCloud only after you agree. SoundCloud then receives your connection details and may set cookies. The choice applies to all players and can be changed in Settings."}
          </p>
          <button className="button" type="button" onClick={accept}>
            <Icon name="play" />
            {de ? "SoundCloud-Player laden" : "Load SoundCloud player"}
          </button>
        </div>
      )}
      <a
        className="sc-link"
        href={profile}
        target="_blank"
        rel="noopener noreferrer"
      >
        {consent === "accepted"
          ? de
            ? "Auf SoundCloud öffnen"
            : "Open on SoundCloud"
          : de
            ? "Auf SoundCloud anhören"
            : "Listen on SoundCloud"}{" "}
        <Icon name="arrow-up-right" />
      </a>
    </div>
  );
}

type Listening = { current: string | null; toggle: (id: string) => void };
const ListenContext = createContext<Listening | null>(null);

// One open player per line-up.
export function ListenGroup({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<string | null>(null);
  const value = useMemo<Listening>(
    () => ({
      current,
      toggle: (id) => setCurrent((open) => (open === id ? null : id)),
    }),
    [current],
  );
  return (
    <ListenContext.Provider value={value}>{children}</ListenContext.Provider>
  );
}

function useListening(id: string) {
  const context = useContext(ListenContext);
  if (!context) throw new Error("ListenGroup is missing");
  return { open: context.current === id, toggle: () => context.toggle(id) };
}

export function ListenButton({
  id,
  url,
  name,
  locale = "de",
}: {
  id: string;
  url: string;
  name: string;
  locale?: Locale;
}) {
  const { open, toggle } = useListening(id);
  const de = locale === "de";
  return (
    <>
      <button
        className={`listen-toggle needs-js${open ? " is-open" : ""}`}
        type="button"
        aria-expanded={open}
        aria-controls={`listen-${id}`}
        aria-label={
          open
            ? de
              ? `Player von ${name} schließen`
              : `Close ${name} player`
            : de
              ? `${name} anhören`
              : `Listen to ${name}`
        }
        onClick={toggle}
      >
        <Icon name={open ? "close" : "play"} />
        {open ? (de ? "Schließen" : "Close") : de ? "Anhören" : "Listen"}
      </button>
      <noscript>
        <a
          className="listen-toggle"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          SoundCloud <Icon name="arrow-up-right" />
        </a>
      </noscript>
    </>
  );
}

export function ListenPanel({
  id,
  url,
  name,
  locale = "de",
}: {
  id: string;
  url: string;
  name: string;
  locale?: Locale;
}) {
  const { open } = useListening(id);
  return (
    <div id={`listen-${id}`} className="listen-panel" hidden={!open}>
      {open && (
        <SoundcloudPlayer
          url={url}
          name={name}
          locale={locale}
          size="compact"
        />
      )}
    </div>
  );
}
