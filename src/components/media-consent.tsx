"use client";

import { SOUNDCLOUD_EMBEDS_ENABLED } from "@/core/media-features";
import type { Locale } from "@/core/i18n";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  consentCookies,
  parseConsent,
  type ConsentState,
  type MediaProvider,
} from "@/components/consent-state";

export type { ConsentState, MediaProvider } from "@/components/consent-state";

// One consent per external media provider, one dialog and one settings entry
// for both. While either choice is unset, the shared dialog asks again.
type Choice = Exclude<ConsentState, "unset">;
const providers = SOUNDCLOUD_EMBEDS_ENABLED
  ? (["instagram", "soundcloud"] as const)
  : (["instagram"] as const);
const changeEvent = "evryvibe-media-consent-change";
const sixMonths = 60 * 60 * 24 * 180;
const memoryOverride: Record<MediaProvider, Choice | null> = {
  instagram: null,
  soundcloud: null,
};

function cookieConsent(provider: MediaProvider): ConsentState {
  const name = consentCookies[provider];
  return parseConsent(
    document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${name}=`))
      ?.slice(name.length + 1),
  );
}

function writeCookie(provider: MediaProvider, value: Choice) {
  document.cookie = `${consentCookies[provider]}=${value}; Max-Age=${sixMonths}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  return cookieConsent(provider) === value;
}

function savedConsent(provider: MediaProvider): ConsentState {
  const override = memoryOverride[provider];
  if (override !== null) return override;
  const cookie = cookieConsent(provider);
  if (cookie !== "unset" || provider !== "instagram") return cookie;
  try {
    // Instagram choices were once kept in localStorage.
    return parseConsent(
      localStorage.getItem(consentCookies.instagram) ?? undefined,
    );
  } catch {
    // Private browsing may deny storage; the visitor can still decide this tab.
    return "unset";
  }
}

function subscribe(listener: () => void) {
  window.addEventListener(changeEvent, listener);
  window.addEventListener("focus", listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener("focus", listener);
    document.removeEventListener("visibilitychange", listener);
  };
}

function store(choices: Partial<Record<MediaProvider, Choice>>) {
  for (const provider of providers) {
    const value = choices[provider];
    if (!value) continue;
    memoryOverride[provider] = value;
    try {
      if (writeCookie(provider, value)) memoryOverride[provider] = null;
      if (provider === "instagram")
        localStorage.removeItem(consentCookies.instagram);
    } catch {
      // The choice still takes effect immediately when storage is denied.
    }
  }
  window.dispatchEvent(new Event(changeEvent));
}

type ConsentContext = Record<MediaProvider, ConsentState> & {
  // Opens the shared dialog (header settings).
  open: () => void;
  // Records one provider's choice, e.g. from an embed's own load button.
  choose: (provider: MediaProvider, value: Choice) => void;
};

const MediaConsentContext = createContext<ConsentContext | null>(null);

const text = {
  de: {
    eyebrow: "EVRYVIBE / Externe Medien",
    title: SOUNDCLOUD_EMBEDS_ENABLED
      ? "Instagram und SoundCloud laden?"
      : "Instagram laden?",
    body: SOUNDCLOUD_EMBEDS_ENABLED
      ? "EVRYVIBE kann Instagram-Beiträge, Profilvorschauen und Titelbilder sowie DJ-Player von SoundCloud einbetten. Sie laden erst nach deiner Zustimmung direkt vom jeweiligen Anbieter. Dabei erhalten Meta bzw. SoundCloud deine IP-Adresse und weitere Verbindungsdaten und können Cookies verwenden. Du kannst deine Wahl jederzeit über „Einstellungen“ im Kopfbereich ändern."
      : "Instagram-Inhalte laden erst nach deiner Zustimmung direkt von Meta. Dabei erhält Meta deine Verbindungsdaten und kann Cookies setzen. SoundCloud-Embeds sind derzeit deaktiviert.",
    news: "Neu: DJ-Player von SoundCloud. Bitte bestätige deine Auswahl.",
    choices: "Einzeln wählen",
    instagram: "Beiträge, Profilvorschauen und Titelbilder (Meta)",
    soundcloud: "DJ-Player (SoundCloud)",
    reject: "Ablehnen",
    acceptAll: "Alle laden",
    save: "Auswahl speichern",
    close: "Schließen",
    current: "Aktuell",
    accepted: "an",
    rejected: "aus",
    unset: "offen",
  },
  en: {
    eyebrow: "EVRYVIBE / External media",
    title: SOUNDCLOUD_EMBEDS_ENABLED
      ? "Load Instagram and SoundCloud?"
      : "Load Instagram?",
    body: SOUNDCLOUD_EMBEDS_ENABLED
      ? "EVRYVIBE can embed Instagram posts, profile previews and cover images as well as DJ players from SoundCloud. They load directly from each provider only after you agree. Meta or SoundCloud then receive your IP address and other connection data and may use cookies. You can change your choice at any time in “Settings” in the header."
      : "Instagram content loads directly from Meta only after you agree. Meta receives your connection details and may use cookies. SoundCloud embeds are currently disabled.",
    news: "New: DJ players from SoundCloud. Please confirm your choice.",
    choices: "Choose individually",
    instagram: "Posts, profile previews and cover images (Meta)",
    soundcloud: "DJ players (SoundCloud)",
    reject: "Reject",
    acceptAll: "Load all",
    save: "Save choice",
    close: "Close",
    current: "Current",
    accepted: "on",
    rejected: "off",
    unset: "not set",
  },
} as const;

export function MediaConsentProvider({
  children,
  locale,
  initialConsent = "unset",
  initialSoundcloud = "unset",
}: {
  children: ReactNode;
  locale: Locale;
  // Instagram choice read from the request cookie (name kept for callers).
  initialConsent?: ConsentState;
  initialSoundcloud?: ConsentState;
}) {
  const instagram = useSyncExternalStore<ConsentState>(
    subscribe,
    () => savedConsent("instagram"),
    () => initialConsent,
  );
  const soundcloudChoice = useSyncExternalStore<ConsentState>(
    subscribe,
    () => savedConsent("soundcloud"),
    () => initialSoundcloud,
  );
  const soundcloud = SOUNDCLOUD_EMBEDS_ENABLED ? soundcloudChoice : "rejected";
  const [isOpen, setIsOpen] = useState(false);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const undecided = instagram === "unset" || soundcloud === "unset";
  const dialogOpen = isOpen || undecided;

  const open = useCallback(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setIsOpen(true);
  }, []);

  useEffect(() => {
    // Carry the old localStorage Instagram choice into its cookie once.
    if (cookieConsent("instagram") !== "unset") return;
    try {
      const legacy = parseConsent(
        localStorage.getItem(consentCookies.instagram) ?? undefined,
      );
      if (legacy !== "unset" && writeCookie("instagram", legacy)) {
        localStorage.removeItem(consentCookies.instagram);
        window.dispatchEvent(new Event(changeEvent));
      }
    } catch {
      // A denied cookie leaves the existing choice effective for this tab.
    }
  }, []);

  useEffect(() => {
    if (!dialogOpen) {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
      return;
    }
    rejectRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !undecided) {
        setIsOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), summary",
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dialogOpen, undecided]);

  const choose = useCallback((provider: MediaProvider, value: Choice) => {
    store({ [provider]: value });
  }, []);

  const finish = useCallback((choices: Record<MediaProvider, Choice>) => {
    setIsOpen(false);
    store(choices);
  }, []);

  const context = useMemo<ConsentContext>(
    () => ({ instagram, soundcloud, open, choose }),
    [instagram, soundcloud, open, choose],
  );
  const t = text[locale];
  const state = { instagram, soundcloud };

  return (
    <MediaConsentContext.Provider value={context}>
      {children}
      {dialogOpen && (
        <div className="consent-overlay">
          <section
            ref={dialogRef}
            className="consent-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="consent-title"
            aria-describedby="consent-description"
          >
            <span className="eyebrow">{t.eyebrow}</span>
            <h2 id="consent-title">{t.title}</h2>
            <p id="consent-description">{t.body}</p>
            {undecided && (instagram !== "unset" || soundcloud !== "unset") && (
              <p className="consent-news">{t.news}</p>
            )}
            <form
              className="consent-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                finish({
                  instagram: data.has("instagram") ? "accepted" : "rejected",
                  soundcloud: data.has("soundcloud") ? "accepted" : "rejected",
                });
              }}
            >
              <div className="consent-actions">
                <button
                  ref={rejectRef}
                  className="button button-outline"
                  type="button"
                  onClick={() =>
                    finish({ instagram: "rejected", soundcloud: "rejected" })
                  }
                >
                  {t.reject}
                </button>
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() =>
                    finish({ instagram: "accepted", soundcloud: "accepted" })
                  }
                >
                  {t.acceptAll}
                </button>
              </div>
              <fieldset className="consent-choices">
                <legend>{t.choices}</legend>
                {providers.map((provider) => (
                  <label key={provider}>
                    <input
                      type="checkbox"
                      name={provider}
                      defaultChecked={state[provider] === "accepted"}
                    />
                    <span>
                      <strong>
                        {provider === "instagram" ? "Instagram" : "SoundCloud"}
                      </strong>
                      <small>
                        {t[provider]} · {t.current}: {t[state[provider]]}
                      </small>
                    </span>
                  </label>
                ))}
                <button className="consent-save" type="submit">
                  {t.save}
                </button>
              </fieldset>
            </form>
            {!undecided && (
              <button
                className="consent-close"
                type="button"
                onClick={() => setIsOpen(false)}
              >
                {t.close}
              </button>
            )}
          </section>
        </div>
      )}
    </MediaConsentContext.Provider>
  );
}

function useMediaConsent() {
  const context = useContext(MediaConsentContext);
  if (!context) throw new Error("MediaConsentProvider is missing");
  return context;
}

export function useConsentSettings() {
  return useMediaConsent().open;
}

export function useProviderConsent(provider: MediaProvider) {
  const context = useMediaConsent();
  const { choose } = context;
  const accept = useCallback(
    () => choose(provider, "accepted"),
    [choose, provider],
  );
  return { consent: context[provider], open: context.open, accept };
}
