import type { Metadata } from "next";
import Link from "next/link";
import { copy } from "@/components/catalog-ui";
import { localizePath, type Locale } from "@/core/i18n";
import {
  CAMELOT_KEYS,
  compatibleKeys,
  type CamelotKey,
} from "@/core/musical-key";
import { pageMetadata } from "@/core/site";
import { pageStructuredData, serializeJsonLd } from "@/core/structured-data";
import { requestLocale } from "@/lib/locale";
import "../reels/reels.css";

const title = (locale: Locale) =>
  copy(
    locale,
    "Camelot-Keys: welche Tonarten sich mixen lassen",
    "Camelot keys: which keys mix together",
  );
const description = (locale: Locale) =>
  copy(
    locale,
    "Alle 24 Camelot-Keys von 1A bis 12B mit Tonart und den Keys, die harmonisch dazu passen – zum Nachschlagen beim Mixen.",
    "All 24 Camelot keys from 1A to 12B with their musical key and the keys that mix harmonically with them.",
  );

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return pageMetadata(title(locale), description(locale), "/keys", locale);
}

function neighbours(key: CamelotKey, locale: Locale) {
  const [, down, up, relative] = compatibleKeys(key);
  const minor = key.endsWith("A");
  return [
    { key: down, label: copy(locale, "−1 ruhiger", "−1 calmer") },
    { key: up, label: copy(locale, "+1 mehr Energie", "+1 more energy") },
    {
      key: relative,
      label: minor
        ? copy(locale, "Dur-Parallele", "relative major")
        : copy(locale, "Moll-Parallele", "relative minor"),
    },
  ].filter((entry): entry is { key: CamelotKey; label: string } => !!entry.key);
}

export default async function KeysPage() {
  const locale = await requestLocale();
  return (
    <main id="main" className="detail-shell keys-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            pageStructuredData("/keys", title(locale), locale, {
              description: description(locale),
            }),
          ),
        }}
      />
      <header className="keys-head">
        <p className="reels-eyebrow">Camelot</p>
        <h1>
          {copy(
            locale,
            "Welche Keys passen zusammen",
            "Which keys fit together",
          )}
        </h1>
        <p>
          {copy(
            locale,
            "Zwei Tracks mixen sich sauber, wenn ihre Keys auf dem Camelot-Rad nebeneinander liegen: gleicher Key, eine Zahl hoch oder runter, oder derselbe Platz zwischen A (Moll) und B (Dur). Tipp einen Key an, um zu ihm zu springen.",
            "Two tracks mix cleanly when their keys sit next to each other on the Camelot wheel: the same key, one number up or down, or the same number between A (minor) and B (major). Tap a key to jump to it.",
          )}
        </p>
      </header>
      <ol className="keys-list">
        {CAMELOT_KEYS.map((entry) => (
          <li key={entry.key} id={`key-${entry.key}`} className="keys-row">
            <span className="keys-code">{entry.key}</span>
            <span className="keys-name">
              {locale === "en" ? entry.nameEn : entry.nameDe}
              <small>
                {entry.key.endsWith("A")
                  ? copy(locale, "Moll", "minor")
                  : copy(locale, "Dur", "major")}
              </small>
            </span>
            <span className="keys-fits">
              <span className="visually-hidden">
                {copy(locale, "Passt zu:", "Mixes with:")}
              </span>
              {neighbours(entry.key, locale).map((neighbour) => (
                <a key={neighbour.key} href={`#key-${neighbour.key}`}>
                  <b>{neighbour.key}</b>
                  <span>{neighbour.label}</span>
                </a>
              ))}
            </span>
          </li>
        ))}
      </ol>
      <section className="keys-about">
        <h2>{copy(locale, "Keys in den Reels", "Keys in Reels")}</h2>
        <p>
          {copy(
            locale,
            "SoundCloud liefert zu Tracks keine Tonart. In den Reels steht ein Key deshalb nur, wenn der Uploader ihn selbst in Titel oder Beschreibung geschrieben hat – dann führt er hierher. DJ-Sets wechseln ohnehin oft die Tonart.",
            "SoundCloud does not provide a track's key. Reels therefore show a key only when the uploader wrote it in the title or description – it then links here. DJ sets often change key anyway.",
          )}
        </p>
        <Link className="button" href={localizePath("/reels", locale)}>
          {copy(locale, "Zu den Reels", "Go to Reels")}
        </Link>
      </section>
    </main>
  );
}
