"use client";
import { Icon } from "@/components/icon";
import { useInstagramConsent } from "@/components/instagram-consent";
import type { Locale } from "@/core/i18n";
import { instagramPostSchema } from "@/core/model";
export function InstagramEmbed({
  url,
  title,
  locale = "de",
}: {
  url: string;
  title: string;
  locale?: Locale;
}) {
  const parsed = instagramPostSchema.safeParse(url);
  const { consent, accept } = useInstagramConsent();
  if (!parsed.success) return null;
  const canonical = parsed.data;
  return (
    <div className="instagram-media">
      {consent === "accepted" ? (
        <iframe
          title={title}
          src={`${canonical}embed/`}
          loading="lazy"
          allow="encrypted-media; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="embed-placeholder">
          <h3>
            {locale === "de"
              ? "Originalbeitrag auf Instagram"
              : "Original post on Instagram"}
          </h3>
          <p>
            {locale === "de"
              ? "Der Beitrag lädt erst nach deiner Zustimmung direkt von Instagram. Dabei erhält Meta deine Verbindungsdaten. Die Wahl gilt für alle Instagram-Inhalte und lässt sich in den Einstellungen ändern."
              : "The post loads directly from Instagram only after you agree. Meta then receives your connection details. The choice applies to all Instagram content and can be changed in Settings."}
          </p>
          <button className="button" type="button" onClick={accept}>
            {locale === "de"
              ? "Instagram-Beitrag laden"
              : "Load Instagram post"}
          </button>
        </div>
      )}
      <p className="embed-note">
        <a href={canonical} target="_blank" rel="noopener noreferrer">
          {locale === "de" ? "Auf Instagram öffnen" : "Open on Instagram"}{" "}
          <Icon name="arrow-up-right" />
        </a>
        <span>
          {locale === "de"
            ? "Instagram kann nicht verfügbar sein oder eine Anmeldung verlangen."
            : "Instagram may be unavailable or require sign-in."}
        </span>
      </p>
    </div>
  );
}
