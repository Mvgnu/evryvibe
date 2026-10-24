"use client";
import { Icon } from "@/components/icon";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { localizePath, type Locale } from "@/core/i18n";
import { useConsentSettings } from "@/components/media-consent";

export function Preferences({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [theme, setTheme] = useState<string | null>(null);
  const openMediaSettings = useConsentSettings();
  function toggleTheme() {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("evryvibe-theme", next);
    } catch {
      /* Storage can be unavailable. */
    }
    setTheme(next);
  }
  return (
    <div className="preferences">
      <div
        className="language-switch"
        aria-label={locale === "de" ? "Sprache" : "Language"}
      >
        {(["de", "en"] as const).map((language) => (
          <a
            key={language}
            href={
              localizePath(pathname, language) +
              (searchParams.size ? `?${searchParams}` : "")
            }
            lang={language}
            hrefLang={language}
            aria-current={locale === language ? "true" : undefined}
            onClick={(event) => {
              event.preventDefault();
              window.location.assign(
                localizePath(window.location.pathname, language) +
                  window.location.search +
                  window.location.hash,
              );
            }}
          >
            {language.toUpperCase()}
          </a>
        ))}
      </div>
      <button
        className="media-settings-button needs-js"
        type="button"
        onClick={openMediaSettings}
        aria-label={
          locale === "de"
            ? "Einstellungen für Instagram und SoundCloud"
            : "Instagram and SoundCloud settings"
        }
        title={
          locale === "de"
            ? "Einstellungen für Instagram und SoundCloud"
            : "Instagram and SoundCloud settings"
        }
      >
        <Icon name="settings" />
        <span className="settings-text">
          {locale === "de" ? "Einstellungen" : "Settings"}
        </span>
      </button>
      <button
        className="theme-switch needs-js"
        type="button"
        onClick={toggleTheme}
        aria-label={
          locale === "de"
            ? "Hell-/Dunkelmodus wechseln"
            : "Toggle light/dark theme"
        }
        title={
          locale === "de"
            ? "Hell-/Dunkelmodus wechseln"
            : "Toggle light/dark theme"
        }
        data-choice={theme}
      >
        <span className="theme-sun" aria-hidden="true">
          <Icon name="sun" />
        </span>
        <span className="theme-moon" aria-hidden="true">
          <Icon name="moon" />
        </span>
      </button>
    </div>
  );
}
