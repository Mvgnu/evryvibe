"use client";
import { Icon } from "@/components/icon";
import type { Locale } from "@/core/i18n";
import { useState } from "react";
export function ShareButton({
  title,
  locale = "de",
  className = "button button-outline",
}: {
  title: string;
  locale?: Locale;
  className?: string;
}) {
  const [message, setMessage] = useState("");
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title, url: window.location.href });
        setMessage(locale === "de" ? "Geteilt." : "Shared.");
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setMessage(locale === "de" ? "Link kopiert." : "Link copied.");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(window.location.href);
        setMessage(locale === "de" ? "Link kopiert." : "Link copied.");
      } catch {
        setMessage(
          locale === "de"
            ? "Kopieren fehlgeschlagen. Kopiere die Adresse aus deinem Browser."
            : "Could not copy. Copy the address from your browser.",
        );
      }
    }
  }
  return (
    <div className="share-control needs-js">
      <button className={className} type="button" onClick={share}>
        {locale === "de" ? "Teilen" : "Share"} <Icon name="arrow-up-right" />
      </button>
      <span role="status">{message}</span>
    </div>
  );
}
