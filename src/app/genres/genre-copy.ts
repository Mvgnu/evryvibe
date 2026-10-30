import { copy } from "@/components/catalog-ui";
import { formatCount } from "@/components/dj-directory-view";
import { compound } from "@/components/german-compound";
import type { City } from "@/core/cities";
import type { Count, DirectoryEntry } from "@/core/dj-directory";
import type { CanonicalGenre } from "@/core/genres";
import { genreFamilyBySlug } from "@/core/genres";
import type { Locale } from "@/core/i18n";

// Programmatic copy for genre pages. Every number comes from the catalogue;
// a page without upcoming nights does not promise parties.

/** "Hard-Techno-DJs und -Partys", or "Hard-Techno-DJs" without nights. */
export function genreTitle(
  genre: CanonicalGenre,
  nights: number,
  locale: Locale,
): string {
  return nights
    ? copy(
        locale,
        `${compound(genre.name, "DJs", "de")} und -Partys`,
        `${genre.name} DJs and parties`,
      )
    : compound(genre.name, "DJs", locale);
}

function list(items: readonly string[], locale: Locale) {
  return new Intl.ListFormat(locale === "en" ? "en-GB" : "de-DE", {
    type: "conjunction",
  }).format(items);
}

export function genreDescription(
  genre: CanonicalGenre,
  djs: readonly DirectoryEntry[],
  cities: readonly Count<City>[],
  nights: number,
  locale: Locale,
  city: City | null = null,
): string {
  const listenable = djs.filter((entry) => entry.dj.soundcloudUrl).length;
  const top = cities.slice(0, 3).map(({ item }) => item.name);
  const where = city
    ? copy(locale, ` mit Gigs in ${city.name}`, ` with gigs in ${city.name}`)
    : top.length
      ? copy(
          locale,
          ` mit Gigs in ${list([...top, ...(cities.length > 3 ? ["weiteren Städten"] : [])], locale)}`,
          ` with gigs in ${list([...top, ...(cities.length > 3 ? ["more cities"] : [])], locale)}`,
        )
      : "";
  const lead = djs.length
    ? copy(
        locale,
        `${formatCount(djs.length, locale)} ${compound(genre.name, "DJs", "de")}${where}.`,
        `${formatCount(djs.length, locale)} ${genre.name} DJs${where}.`,
      )
    : copy(
        locale,
        `Noch keine ${compound(genre.name, "DJs", "de")}${city ? ` mit Gigs in ${city.name}` : ""} auf EVRYVIBE.`,
        `No ${genre.name} DJs${city ? ` with gigs in ${city.name}` : ""} on EVRYVIBE yet.`,
      );
  const listen = listenable
    ? copy(
        locale,
        ` ${formatCount(listenable, locale)} davon direkt auf SoundCloud anhören.`,
        ` Listen to ${formatCount(listenable, locale)} of them straight from SoundCloud.`,
      )
    : "";
  const parties = nights
    ? copy(
        locale,
        ` ${formatCount(nights, locale)} ${nights === 1 ? `kommende ${compound(genre.name, "Party", "de")}` : `kommende ${compound(genre.name, "Partys", "de")}`}${city ? ` in ${city.name}` : ""}.`,
        ` ${formatCount(nights, locale)} upcoming ${genre.name} ${nights === 1 ? "party" : "parties"}${city ? ` in ${city.name}` : ""}.`,
      )
    : "";
  return `${lead}${listen}${parties}`;
}

/** The factual "about" paragraph at the bottom of a genre page. */
export function genreAbout(genre: CanonicalGenre, locale: Locale): string {
  const family = genreFamilyBySlug(genre.family)?.label[locale] ?? "";
  const sound =
    family && family !== genre.name
      ? copy(
          locale,
          `${genre.name} gehört auf EVRYVIBE zum Sound ${family}. `,
          `On EVRYVIBE, ${genre.name} is part of the ${family} sound. `,
        )
      : "";
  return `${sound}${copy(
    locale,
    `Hier stehen DJs, die Gigs auf EVRYVIBE haben und ${genre.name} spielen: laut ihrem Profil oder, wenn das Profil kein Genre nennt, laut den Nächten, auf denen sie gespielt haben oder spielen werden. DJs mit SoundCloud-Profil stehen oben; ihre SoundCloud-Profile öffnen sich als externe Links. Termine stammen aus veröffentlichten Ankündigungen, die Quelle steht auf jeder Eventseite. Weitere DJs und Partys können fehlen.`,
    `This page lists DJs with gigs on EVRYVIBE who play ${genre.name}: according to their profile or, where the profile names no genre, the nights they played or will play. DJs with a SoundCloud profile come first; their SoundCloud profiles open through external links. Dates come from published announcements, and each event page links to its source. Other DJs and parties may be missing.`,
  )}`;
}
