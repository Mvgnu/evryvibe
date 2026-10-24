import { Icon } from "@/components/icon";
import type { Locale } from "@/core/i18n";
import type { Catalog, Event } from "@/core/model";
export { Artwork } from "@/components/artwork";

export const copy = (locale: Locale, de: string, en: string) =>
  locale === "en" ? en : de;

export function translatedDescription(
  entity: {
    description: string;
    translations?: { en?: { description?: string } };
  },
  locale: Locale,
) {
  return locale === "en"
    ? (entity.translations?.en?.description ?? entity.description)
    : entity.description;
}

export function translatedEvent(event: Event, locale: Locale): Event {
  return {
    ...event,
    title:
      locale === "en"
        ? (event.translations?.en?.title ?? event.title)
        : event.title,
    description: translatedDescription(event, locale),
  };
}

export function DemoNotice({
  mode,
  locale = "de",
}: {
  mode: Catalog["mode"];
  locale?: Locale;
}) {
  return mode === "demo" ? (
    <div className="demo-notice">
      <span className="live-dot" />{" "}
      {copy(locale, "FIKTIVE VORSCHAU", "FICTIONAL PREVIEW")}{" "}
      <span>
        {copy(
          locale,
          "Alle Events, Orte und DJs hier sind fiktive Demoinhalte.",
          "All events, venues and artists here are demo content.",
        )}
      </span>
    </div>
  ) : null;
}

export function ExternalLink({
  href,
  children,
  className,
  label,
}: {
  href: string | null;
  children: React.ReactNode;
  className?: string;
  // Accessible name when the visible text alone is ambiguous.
  label?: string;
}) {
  return href ? (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
    >
      {children}{" "}
      <span aria-hidden="true">
        <Icon name="arrow-up-right" />
      </span>
    </a>
  ) : null;
}
