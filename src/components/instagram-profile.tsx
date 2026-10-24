"use client";

import { useState } from "react";
import { useInstagramConsent } from "@/components/instagram-consent";
import { Icon } from "@/components/icon";
import { instagramProfileSchema } from "@/core/model";
import type { Locale } from "@/core/i18n";

export function InstagramProfile({
  url,
  name,
  locale = "de",
}: {
  url: string;
  name: string;
  locale?: Locale;
}) {
  const parsed = instagramProfileSchema.safeParse(url);
  if (!parsed.success) return null;
  return (
    <ProfilePreview
      key={parsed.data}
      canonical={parsed.data}
      name={name}
      locale={locale}
    />
  );
}

function ProfilePreview({
  canonical,
  name,
  locale,
}: {
  canonical: string;
  name: string;
  locale: Locale;
}) {
  const { consent, accept } = useInstagramConsent();
  const [failed, setFailed] = useState(false);
  const de = locale === "de";
  return (
    <div className="instagram-media instagram-profile">
      <p className="embed-note">
        <a href={canonical} target="_blank" rel="noopener noreferrer">
          {de
            ? "Vollständiges Profil auf Instagram öffnen"
            : "Open full profile on Instagram"}{" "}
          <Icon name="arrow-up-right" />
        </a>
        <span>
          {de
            ? "Instagram bestimmt die Auswahl der Beiträge. Die Vorschau ist kein vollständiger Feed und kann eine Anmeldung erfordern. Falls sie leer bleibt oder blockiert wird, öffne das Profil über den Link."
            : "Instagram chooses which posts appear. This preview is not a complete feed and may require sign-in. If it stays empty or is blocked, open the profile using the link."}
        </span>
      </p>
      {consent !== "accepted" || failed ? (
        <div className="embed-placeholder">
          <h3>{de ? `${name} auf Instagram` : `${name} on Instagram`}</h3>
          <p>
            {failed
              ? de
                ? "Die Profilvorschau konnte nicht geladen werden. Öffne das Profil direkt auf Instagram oder versuche es erneut."
                : "The profile preview could not be loaded. Open the profile directly on Instagram or try again."
              : de
                ? "Lade eine Vorschau der Beiträge dieses Profils. Erst beim Laden erhält Instagram deine Verbindungsdaten und kann Cookies verwenden."
                : "Load a preview of this profile’s posts. Only when you load it will Instagram receive your connection details and may use cookies."}
          </p>
          <button
            className="button"
            type="button"
            onClick={() => {
              setFailed(false);
              accept();
            }}
          >
            {de ? "Instagram-Profil laden" : "Load Instagram profile"}
          </button>
        </div>
      ) : (
        <iframe
          title={
            de ? `Instagram-Profil von ${name}` : `${name}’s Instagram profile`
          }
          src={`${canonical}embed/`}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
