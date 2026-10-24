import type { Metadata } from "next";
import { localizePath, type Locale } from "./i18n";

export const siteUrl = "https://evryvibe.com";
export const siteTitle = "EVRYVIBE — Techno-Partys und Events";
export const siteDescription =
  "Techno-Partys, Clubs und DJs: kommende Events mit Line-ups, Terminen und Tickets.";

export function isPublicSite(): boolean {
  return (
    process.env.NODE_ENV === "production" && process.env.EVRYVIBE_DEMO !== "1"
  );
}

export function absoluteUrl(path: string, locale: Locale = "de"): string {
  return new URL(localizePath(path, locale), siteUrl).href;
}

export function languageAlternates(path: string) {
  return {
    de: absoluteUrl(path, "de"),
    en: absoluteUrl(path, "en"),
    "x-default": absoluteUrl(path, "de"),
  };
}

export function pageMetadata(
  title: string,
  description: string,
  path: string,
  locale: Locale = "de",
  imageUrl?: string | null,
): Metadata {
  const url = absoluteUrl(path, locale);
  // MCP editorial titles may already carry the brand; keep one consistent suffix.
  const unbrandedTitle = title
    .trim()
    .replace(/\s*(?:[|·—–-])\s*EVRYVIBE\s*$/i, "");
  const fullTitle = `${unbrandedTitle} · EVRYVIBE`;
  const summary = description.trim().replace(/\s+/g, " ");
  return {
    title: { absolute: fullTitle },
    description: summary,
    alternates: { canonical: url, languages: languageAlternates(path) },
    openGraph: {
      title: fullTitle,
      description: summary,
      url,
      siteName: "EVRYVIBE",
      type: "website",
      ...(imageUrl ? { images: [{ url: imageUrl, alt: title }] } : {}),
      locale: locale === "de" ? "de_DE" : "en_GB",
      alternateLocale: locale === "de" ? "en_GB" : "de_DE",
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title: fullTitle,
      description: summary,
      ...(imageUrl ? { images: [{ url: imageUrl, alt: title }] } : {}),
    },
  };
}
