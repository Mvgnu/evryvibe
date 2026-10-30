"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectWidget,
  playerOptions,
  playerSrc,
  type Widget,
} from "@/components/soundcloud-widget";
import {
  bestSoundIndex,
  parseSound,
  tasteOf,
  type ReelVote,
  type Sound,
} from "@/core/reels";

// One SoundCloud widget, reused for every profile it plays (Reels and the
// night map). The first URL becomes the iframe's src; later profiles load
// into the same player. Without a URL (nothing to play, or consent
// withdrawn) the iframe is removed and calls to it become no-ops.

export type PlayerStatus =
  "idle" | "loading" | "playing" | "paused" | "blocked" | "empty" | "error";

export function useSoundcloudPlayer(url: string | null, votes: ReelVote[]) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const widget = useRef<Widget | null>(null);
  const loaded = useRef<string | null>(null);
  const sequence = useRef(0);
  const userPaused = useRef(false);
  const hasSound = useRef(false);
  const votesRef = useRef(votes);
  const [sdk, setSdk] = useState(false);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState<Sound | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const showSound = useCallback((next: Sound | null) => {
    if (next) hasSound.current = true;
    setSound(next);
  }, []);
  // A profile without public uploads never reports a sound, and the widget
  // may not even answer for it: after a while on one reel, say so.
  useEffect(() => {
    if (!url) return;
    const timer = window.setTimeout(() => {
      // A player that is playing has public uploads, even when their
      // metadata could not be read.
      if (!hasSound.current)
        setStatus((value) => (value === "playing" ? value : "empty"));
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [url]);
  // The first URL becomes the iframe's src; later reels reuse the same player.
  // Without a URL (consent withdrawn) the iframe is gone and starts over.
  const [firstUrl, setFirstUrl] = useState(url);
  if (firstUrl === null && url !== null) setFirstUrl(url);
  if (firstUrl !== null && url === null) setFirstUrl(null);

  useEffect(() => {
    votesRef.current = votes;
  }, [votes]);

  // After a profile loads, jump to the upload that fits the visitor best.
  const afterLoad = useCallback((run: number) => {
    const player = widget.current;
    if (!player) return;
    window.setTimeout(() => {
      if (run !== sequence.current) return;
      player.getSounds((raw) => {
        if (run !== sequence.current || !Array.isArray(raw)) return;
        // A profile without public uploads has nothing to play.
        if (!raw.length) return setStatus("empty");
        const sounds = raw.map(parseSound);
        const best = bestSoundIndex(sounds, tasteOf(votesRef.current));
        if (votesRef.current.length && best > 0) player.skip(best);
      });
    }, 1200);
    // Browsers that block autoplay leave the player paused.
    window.setTimeout(() => {
      if (run === sequence.current)
        setStatus((value) => (value === "loading" ? "blocked" : value));
    }, 3500);
  }, []);

  useEffect(() => {
    if (!sdk || !firstUrl || !iframe.current) return;
    const connected = connectWidget(iframe.current);
    if (!connected) {
      setStatus("error");
      return;
    }
    const { widget: player, events } = connected;
    widget.current = player;
    const readSound = () => {
      const run = sequence.current;
      player.getCurrentSound((raw) => {
        if (run === sequence.current) showSound(parseSound(raw));
      });
    };
    player.bind(events.READY, () => {
      setReady(true);
      setStatus((value) => (value === "idle" ? "loading" : value));
      readSound();
      afterLoad(sequence.current);
    });
    player.bind(events.PLAY, () => {
      userPaused.current = false;
      setStatus("playing");
      readSound();
    });
    // Only a pause the visitor asked for reads as "paused"; any other pause
    // is the browser refusing to autoplay.
    player.bind(events.PAUSE, () =>
      setStatus((value) =>
        value === "empty" ? value : userPaused.current ? "paused" : "blocked",
      ),
    );
    player.bind(events.ERROR, () => setStatus("error"));
    return () => {
      for (const event of Object.values(events)) player.unbind(event);
      player.pause();
      widget.current = null;
      loaded.current = null;
      sequence.current += 1;
      setReady(false);
      setSound(null);
      setStatus("idle");
    };
  }, [sdk, firstUrl, afterLoad, showSound]);

  useEffect(() => {
    const player = widget.current;
    if (!url || !ready || !player) return;
    if (loaded.current === null) loaded.current = firstUrl;
    if (loaded.current === url) return;
    loaded.current = url;
    userPaused.current = false;
    hasSound.current = false;
    const run = ++sequence.current;

    setSound(null);
    setStatus("loading");

    player.load(url, {
      ...playerOptions,
      auto_play: true,
      callback: () => {
        if (run !== sequence.current) return;
        player.getCurrentSound((raw) => {
          if (run === sequence.current) showSound(parseSound(raw));
        });
        afterLoad(run);
      },
    });
  }, [url, ready, firstUrl, afterLoad, showSound]);

  const frame = firstUrl ? (
    <>
      <Script
        id="soundcloud-widget-api"
        src="https://w.soundcloud.com/player/api.js"
        strategy="afterInteractive"
        onReady={() => setSdk(true)}
        onError={() => setStatus("error")}
      />
      <iframe
        ref={iframe}
        title="SoundCloud"
        src={playerSrc(firstUrl, true)}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </>
  ) : null;

  const shown: PlayerStatus = !url
    ? "idle"
    : status === "idle"
      ? "loading"
      : status;
  return {
    frame,
    sound,
    status: shown,
    next: () => widget.current?.next(),
    toggle: () => {
      userPaused.current = status === "playing";
      widget.current?.toggle();
    },
  };
}
