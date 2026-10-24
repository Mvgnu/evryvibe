"use client";

import { useState } from "react";
import { useInstagramConsent } from "@/components/instagram-consent";
import { EventPoster } from "@/components/poster";
import { posterFacts, type PosterFacts } from "@/components/poster-facts";
import type { Locale } from "@/core/i18n";
import { instagramPostSchema, type Event } from "@/core/model";

export function Artwork({
  event,
  poster,
  hero = false,
  className = "",
  locale = "de",
}: {
  event: Event;
  // Facts formatted on the server. Without them the poster shows no date,
  // because only the venue timezone can place the event on a local day.
  poster?: PosterFacts;
  hero?: boolean;
  locale?: Locale;
  className?: string;
}) {
  const { consent } = useInstagramConsent();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const publicPost = instagramPostSchema.safeParse(event.sourceUrl).success;
  const coverUrl = publicPost ? event.imageUrl : null;
  const showCover =
    consent === "accepted" && !!coverUrl && failedUrl !== coverUrl;

  return (
    <div className={`artwork ${className}`.trim()}>
      {showCover ? (
        // The image is requested directly from Instagram only after consent.
        // A missing or expired CDN URL falls back to EVRYVIBE artwork.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="artwork-cover"
          src={coverUrl}
          alt={event.title}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onError={() => setFailedUrl(coverUrl)}
        />
      ) : (
        <div className="artwork-fallback" aria-hidden="true">
          <EventPoster
            facts={poster ?? posterFacts(event, null, [], locale)}
            hero={hero}
          />
        </div>
      )}
    </div>
  );
}
