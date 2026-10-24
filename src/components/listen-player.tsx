"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useProviderConsent } from "@/components/media-consent";
import { Icon } from "@/components/icon";
import type { Locale } from "@/core/i18n";
import { parseSoundMetadata, type SoundMetadata } from "@/core/listen";
import {
  soundcloudPlayerUrl,
  soundcloudProfileSchema,
} from "@/core/soundcloud";

type Widget = {
  bind: (name: string, callback: (value: unknown) => void) => void;
  unbind: (name: string) => void;
  getCurrentSound: (callback: (value: unknown) => void) => void;
  pause: () => void;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWidget(value: unknown): value is Widget {
  return (
    record(value) &&
    typeof value.bind === "function" &&
    typeof value.unbind === "function" &&
    typeof value.getCurrentSound === "function" &&
    typeof value.pause === "function"
  );
}

const eventsSchema = z.object({
  READY: z.string(),
  PLAY: z.string(),
  FINISH: z.string(),
  ERROR: z.string(),
});

/** Official profile player. Metadata belongs to this mounted sound, never a DJ. */
export function ListenPlayer({
  url,
  name,
  locale,
  onSound,
}: {
  url: string;
  name: string;
  locale: Locale;
  onSound: (sound: SoundMetadata | null) => void;
}) {
  const { consent, accept } = useProviderConsent("soundcloud");
  const iframe = useRef<HTMLIFrameElement>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const parsed = soundcloudProfileSchema.safeParse(url);
  const profile = parsed.success ? parsed.data : null;
  const de = locale === "de";

  useEffect(() => {
    onSound(null);
    if (consent !== "accepted" || !profile || !sdkReady || !iframe.current)
      return;
    const api: unknown = Reflect.get(window, "SC");
    if (!record(api) || typeof api.Widget !== "function") return;
    const rawEvents: unknown = Reflect.get(api.Widget, "Events");
    const parsedEvents = eventsSchema.safeParse(rawEvents);
    if (!parsedEvents.success) return;
    const candidate: unknown = Reflect.apply(api.Widget, api, [iframe.current]);
    if (!isWidget(candidate)) return;
    const widget = candidate;
    const events = parsedEvents.data;
    let disposed = false;
    let sequence = 0;
    const timeout = window.setTimeout(() => {
      if (!disposed) setFailed(true);
    }, 15000);
    const readSound = () => {
      const request = ++sequence;
      onSound(null);
      widget.getCurrentSound((raw) => {
        if (disposed || request !== sequence) return;
        onSound(parseSoundMetadata(raw));
      });
    };
    widget.bind(events.READY, () => {
      if (disposed) return;
      window.clearTimeout(timeout);
      setFailed(false);
      readSound();
    });
    widget.bind(events.PLAY, () => {
      if (disposed) return;
      window.clearTimeout(timeout);
      setFailed(false);
      readSound();
    });
    widget.bind(events.FINISH, () => {
      if (!disposed) {
        ++sequence;
        onSound(null);
      }
    });
    widget.bind(events.ERROR, () => {
      if (!disposed) {
        window.clearTimeout(timeout);
        ++sequence;
        onSound(null);
        setFailed(true);
      }
    });
    return () => {
      disposed = true;
      ++sequence;
      window.clearTimeout(timeout);
      for (const event of Object.values(events)) widget.unbind(event);
      widget.pause();
      onSound(null);
    };
  }, [consent, profile, sdkReady, attempt, onSound]);

  if (!profile) return null;
  return (
    <div className="listen-player sc-player sc-profile">
      {consent === "accepted" ? (
        <>
          <Script
            id="listen-soundcloud-sdk"
            src="https://w.soundcloud.com/player/api.js"
            strategy="afterInteractive"
            onReady={() => setSdkReady(true)}
            onError={() => setFailed(true)}
          />
          <iframe
            key={`${profile}:${attempt}`}
            ref={iframe}
            title={
              de ? `SoundCloud-Player: ${name}` : `SoundCloud player: ${name}`
            }
            src={soundcloudPlayerUrl(profile, { autoPlay: true })}
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            onError={() => setFailed(true)}
          />
          <p className="listen-player-hint">
            {de
              ? "Zum Hören Play im Player antippen."
              : "Tap Play in the player to listen."}
          </p>
          {failed && (
            <div className="listen-player-fallback" role="status">
              <p>
                {de
                  ? "Der Player antwortet gerade nicht. Du kannst den Sound direkt auf SoundCloud öffnen."
                  : "The player is not responding. You can open the sound directly on SoundCloud."}
              </p>
              <button
                className="chip-button"
                type="button"
                onClick={() => {
                  setFailed(false);
                  onSound(null);
                  setAttempt((value) => value + 1);
                }}
              >
                {de ? "Player neu laden" : "Reload player"}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="sc-placeholder">
          <p>
            {de
              ? "SoundCloud lädt erst nach deiner Zustimmung. Dabei erhält SoundCloud deine Verbindungsdaten und kann Cookies setzen. Du kannst deine Wahl in den Einstellungen ändern."
              : "SoundCloud loads only after you agree. It receives your connection details and may set cookies. You can change your choice in Settings."}
          </p>
          <button className="button" type="button" onClick={accept}>
            <Icon name="play" />
            {de ? "SoundCloud laden" : "Load SoundCloud"}
          </button>
        </div>
      )}
      <a
        className="sc-link"
        href={profile}
        target="_blank"
        rel="noopener noreferrer"
      >
        {de ? "Auf SoundCloud öffnen" : "Open on SoundCloud"}
        <Icon name="arrow-up-right" />
      </a>
    </div>
  );
}
