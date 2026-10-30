"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icon";
import type { MapNight } from "@/components/night-map-data";
import { localizePath, type Locale } from "@/core/i18n";

/** Public lineup browsing: ordinary social links, no embedded media. */
export function MapDjBrowser({
  night,
  locale,
  onClose,
}: {
  night: MapNight;
  locale: Locale;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const dj = night.artists[index];
  const de = locale === "de";
  if (!dj) return null;
  return (
    <section
      className="nm-dj-browser"
      aria-label={de ? "DJs der Nacht" : "Night's DJs"}
    >
      <button
        className="nm-icon-button"
        type="button"
        onClick={() =>
          setIndex(
            (value) =>
              (value - 1 + night.artists.length) % night.artists.length,
          )
        }
        aria-label={de ? "Vorheriger DJ" : "Previous DJ"}
      >
        <Icon name="arrow-left" />
      </button>
      <div className="nm-dj-browser-name" aria-live="polite">
        <span>
          {index + 1} / {night.artists.length} · LINE-UP
        </span>
        <Link href={localizePath(`/djs/${dj.slug}`, locale)}>{dj.name}</Link>
      </div>
      <button
        className="nm-icon-button nm-dj-next"
        type="button"
        onClick={() => setIndex((value) => (value + 1) % night.artists.length)}
        aria-label={de ? "Nächster DJ" : "Next DJ"}
      >
        <Icon name="arrow-left" />
      </button>
      <button
        className="nm-icon-button"
        type="button"
        onClick={onClose}
        aria-label={de ? "DJ-Auswahl schließen" : "Close DJ selection"}
      >
        <Icon name="close" />
      </button>
      <div className="nm-dj-browser-links">
        {dj.soundcloudUrl && (
          <a
            className="chip-button"
            href={dj.soundcloudUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            SoundCloud <Icon name="arrow-up-right" />
          </a>
        )}
        {dj.instagramUrl && (
          <a
            className="chip-button"
            href={dj.instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Instagram <Icon name="arrow-up-right" />
          </a>
        )}
        {!dj.soundcloudUrl && !dj.instagramUrl && (
          <span>
            {de ? "Keine Social-Links hinterlegt" : "No social links available"}
          </span>
        )}
      </div>
    </section>
  );
}
