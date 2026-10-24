"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { Preferences } from "@/components/preferences";
import { localizePath, type Locale } from "@/core/i18n";

const copy = (locale: Locale, de: string, en: string) =>
  locale === "en" ? en : de;

type Section = "nights" | "listen" | "djs" | "cities" | null;

// The English alias is a proxy rewrite, so compare against the unprefixed path.
function currentSection(pathname: string): Section {
  const path = localizePath(pathname || "/", "de");
  if (path === "/") return "nights";
  if (path === "/listen") return "listen";
  if (path === "/cities" || path.startsWith("/cities/")) return "cities";
  if (
    path === "/djs" ||
    path.startsWith("/djs/") ||
    path === "/genres" ||
    path.startsWith("/genres/")
  )
    return "djs";
  return null;
}

export function Header({ locale = "de" }: { locale?: Locale }) {
  const section = currentSection(usePathname());
  const links = [
    {
      key: "listen" as const,
      href: localizePath("/listen", locale),
      label: copy(locale, "Hören", "Listen"),
    },
    {
      key: "nights" as const,
      href: localizePath("/", locale),
      label: copy(locale, "Nächte", "Nights"),
    },
    {
      key: "djs" as const,
      href: localizePath("/djs", locale),
      label: "DJs",
    },
    {
      key: "cities" as const,
      href: localizePath("/cities", locale),
      label: copy(locale, "Städte", "Cities"),
    },
  ];
  return (
    <header className="site-header">
      <Link
        className="wordmark"
        href={localizePath("/", locale)}
        aria-label={copy(locale, "EVRYVIBE Startseite", "EVRYVIBE home")}
      >
        EVRYVIBE
        <span className="brand-star" aria-hidden="true">
          <Icon name="asterisk" />
        </span>
      </Link>
      <nav
        className="site-nav"
        aria-label={copy(locale, "Hauptnavigation", "Main navigation")}
      >
        {links.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            data-section={link.key}
            aria-current={section === link.key ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <Preferences locale={locale} />
    </header>
  );
}

export function Footer({ locale = "de" }: { locale?: Locale }) {
  return (
    <footer className="site-footer">
      <Link
        className="wordmark small"
        href={localizePath("/", locale)}
        aria-label={copy(locale, "EVRYVIBE Startseite", "EVRYVIBE home")}
      >
        EVRYVIBE
        <span className="brand-star" aria-hidden="true">
          <Icon name="asterisk" />
        </span>
      </Link>
      <nav
        className="footer-nav"
        aria-label={copy(
          locale,
          "DJs, Städte, Kontakt und rechtliche Informationen",
          "DJs, cities, contact and legal information",
        )}
      >
        <Link href={localizePath("/listen", locale)}>
          {copy(locale, "Hören", "Listen")}
        </Link>
        <Link href={localizePath("/djs", locale)}>DJs</Link>
        <Link href={localizePath("/genres", locale)}>Genres</Link>
        <Link href={localizePath("/cities", locale)}>
          {copy(locale, "Städte", "Cities")}
        </Link>
        <Link href={localizePath("/kontakt", locale)}>
          {copy(locale, "Kontakt", "Contact")}
        </Link>
        <Link href={localizePath("/takedown", locale)}>
          {copy(locale, "Inhalt melden", "Report content")}
        </Link>
        <Link href={localizePath("/impressum", locale)}>
          {copy(locale, "Impressum", "Legal notice")}
        </Link>
        <Link href={localizePath("/datenschutz", locale)}>
          {copy(locale, "Datenschutz", "Privacy")}
        </Link>
      </nav>
    </footer>
  );
}
