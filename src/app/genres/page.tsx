import type { Metadata } from "next";
import Link from "next/link";
import { copy, DemoNotice } from "@/components/catalog-ui";
import {
  formatCount,
  genreIndex,
  genrePath,
  genreStats,
  isIndexableGenre,
  type FamilyGroup,
} from "@/components/dj-directory-view";
import { requestTime } from "@/components/request-time";
import { directoryEntries } from "@/core/dj-directory";
import { localizePath, type Locale } from "@/core/i18n";
import type { Catalog } from "@/core/model";
import { pageMetadata } from "@/core/site";
import { genresStructuredData, serializeJsonLd } from "@/core/structured-data";
import { getCatalog } from "@/db/catalog";
import { requestLocale } from "@/lib/locale";
import "../directory.css";

export const dynamic = "force-dynamic";

const title = (locale: Locale) =>
  copy(locale, "Techno-DJs nach Genre", "Techno DJs by genre");

function indexView(catalog: Catalog, now: number) {
  const entries = directoryEntries(catalog, now);
  const stats = genreStats(entries, catalog, now);
  const groups = genreIndex(entries, stats);
  const genres = groups.flatMap((group) => group.genres);
  return {
    entries,
    groups,
    genres,
    indexable: genres.filter(isIndexableGenre),
  };
}

function indexDescription(
  groups: FamilyGroup[],
  genres: number,
  locale: Locale,
): string {
  if (!genres)
    return copy(
      locale,
      "DJs und Partys nach Genre. Noch sind keine DJs mit Genre veröffentlicht.",
      "DJs and parties by genre. No DJs with a genre have been published yet.",
    );
  const names = groups
    .flatMap((group) => group.genres)
    .sort((a, b) => b.djs - a.djs)
    .slice(0, 4)
    .map(({ genre }) => genre.name);
  const named = new Intl.ListFormat(locale === "en" ? "en-GB" : "de-DE", {
    type: "conjunction",
  }).format(names);
  return copy(
    locale,
    `DJs und Partys in ${formatCount(genres, locale)} Genres, darunter ${named}. Jede Genreseite zeigt ihre DJs zum Anhören auf SoundCloud und die kommenden Partys.`,
    `DJs and parties in ${formatCount(genres, locale)} genres, including ${named}. Each genre page lists its DJs to listen to on SoundCloud and the upcoming parties.`,
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const catalog = await getCatalog();
  const view = indexView(catalog, Date.now());
  const metadata = pageMetadata(
    title(locale),
    indexDescription(view.groups, view.genres.length, locale),
    "/genres",
    locale,
  );
  return view.indexable.length && catalog.mode !== "demo"
    ? metadata
    : { ...metadata, robots: { index: false, follow: true } };
}

const nightsWord = (count: number, locale: Locale) =>
  copy(
    locale,
    count === 1 ? "Nacht" : "Nächte",
    count === 1 ? "night" : "nights",
  );

export default async function GenresPage() {
  const locale = await requestLocale();
  const catalog = await getCatalog();
  const requestNow = requestTime();
  const view = indexView(catalog, requestNow);
  const description = indexDescription(view.groups, view.genres.length, locale);
  const nights = view.genres.reduce((sum, item) => sum + item.nights, 0);
  return (
    <main id="main" className="directory-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            genresStructuredData(
              catalog.mode === "demo"
                ? []
                : view.indexable.map(({ genre }) => genre),
              locale,
              { name: title(locale), description },
            ),
          ),
        }}
      />
      <DemoNotice mode={catalog.mode} locale={locale} />
      <div className="city-shell directory-shell">
        <section
          className="city-hero city-index-hero"
          aria-labelledby="genres-title"
        >
          <p className="city-kicker">Genres</p>
          <h1 id="genres-title">{title(locale)}</h1>
          <dl className="city-stats">
            <div>
              <dt>Genres</dt>
              <dd>{formatCount(view.genres.length, locale)}</dd>
            </div>
            <div>
              <dt>DJs</dt>
              <dd>{formatCount(view.entries.length, locale)}</dd>
            </div>
          </dl>
          <p className="city-tools">
            <Link className="chip-button" href={localizePath("/djs", locale)}>
              {copy(
                locale,
                "Alle DJs nach Stadt filtern",
                "Filter all DJs by city",
              )}
            </Link>
          </p>
        </section>
        {view.groups.length > 1 && (
          <nav
            className="filter-row genre-jumps"
            aria-labelledby="genre-jumps-label"
          >
            <span className="filter-label" id="genre-jumps-label">
              Sound
            </span>
            <ul className="chip-scroll">
              {view.groups.map(({ family, genres }) => (
                <li key={family.slug}>
                  <a className="chip" href={`#family-${family.slug}`}>
                    <span className={`chip-swatch fam-${family.motif}`} />
                    {family.label[locale]}{" "}
                    <span className="chip-count">{genres.length}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {view.groups.length ? (
          <div className="genre-index">
            {view.groups.map(({ family, djs, genres }) => (
              <section
                key={family.slug}
                id={`family-${family.slug}`}
                className="genre-family"
                aria-labelledby={`family-${family.slug}-title`}
              >
                <header className="genre-family-head">
                  <h2 id={`family-${family.slug}-title`}>
                    <span
                      className={`chip-swatch fam-${family.motif}`}
                      aria-hidden="true"
                    />
                    {family.label[locale]}
                  </h2>
                  <Link
                    href={`${localizePath("/djs", locale)}?${new URLSearchParams({ sound: family.slug })}`}
                  >
                    <span className="visually-hidden">
                      {family.label[locale]}:{" "}
                    </span>
                    {formatCount(djs, locale)} DJs
                  </Link>
                </header>
                <ul className="genre-rows">
                  {genres.map(({ genre, djs: count, nights: upcoming }) => (
                    <li key={genre.slug}>
                      <Link href={localizePath(genrePath(genre), locale)}>
                        <strong>{genre.name}</strong>
                        <span className="genre-row-counts">
                          <span>
                            {formatCount(count, locale)}{" "}
                            {count === 1 ? "DJ" : "DJs"}
                          </span>
                          {upcoming > 0 && (
                            <span>
                              {formatCount(upcoming, locale)}{" "}
                              {nightsWord(upcoming, locale)}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="empty-state city-empty">
            <h3>{copy(locale, "Noch keine Genres", "No genres yet")}</h3>
            <p>
              {copy(
                locale,
                "Sobald DJs mit Genre veröffentlicht sind, erscheinen ihre Genres hier.",
                "Genres appear here once DJs with a genre have been published.",
              )}
            </p>
          </div>
        )}
        {nights > 0 && (
          <p className="directory-footnote">
            {copy(
              locale,
              "Nächte: kommende Partys mit diesem Genre. Eine Party mit mehreren Genres zählt bei jedem.",
              "Nights: upcoming parties tagged with the genre. A party with several genres counts for each.",
            )}
          </p>
        )}
      </div>
    </main>
  );
}
