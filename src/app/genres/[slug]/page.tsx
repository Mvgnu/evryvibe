import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { copy, DemoNotice } from "@/components/catalog-ui";
import { Chip, ChipRow } from "@/components/chips";
import { emptyFilters, homeHref } from "@/components/discovery-filters";
import {
  directoryHref,
  djPageSize,
  djRow,
  familyGenreCounts,
  familyName,
  formatCount,
  genreNightsShown,
  genrePath,
  isIndexableGenre,
  maxDjLimit,
  paramLabel,
  parseDirectoryQuery,
  placesOf,
  windowedEntries,
  type DirectoryQuery,
} from "@/components/dj-directory-view";
import { compound } from "@/components/german-compound";
import { DjList } from "@/components/dj-list";
import { FocusRow } from "@/components/focus-row";
import { EventList } from "@/components/event-days";
import { Icon } from "@/components/icon";
import { requestTime } from "@/components/request-time";
import { ScrollActiveChips } from "@/components/scroll-active";
import { catalogCities } from "@/core/cities";
import {
  directoryEntries,
  directoryFacets,
  filterDirectory,
  upcomingGenreEvents,
} from "@/core/dj-directory";
import { type CanonicalGenre } from "@/core/genres";
import { localizePath, type Locale } from "@/core/i18n";
import type { Catalog } from "@/core/model";
import { pageMetadata } from "@/core/site";
import { genreStructuredData, serializeJsonLd } from "@/core/structured-data";
import { getCatalog } from "@/db/catalog";
import { requestLocale } from "@/lib/locale";
import { resolveGenreRoute } from "../genre-routing";
import { genreAbout, genreDescription, genreTitle } from "../genre-copy";
import "../../directory.css";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Metadata and page resolve the same legacy routes before rendering.
function genreOrRedirect(
  slug: string,
  locale: Locale,
  catalog: Catalog,
): CanonicalGenre {
  const route = resolveGenreRoute(slug, catalogCities(catalog.venues), locale);
  switch (route.kind) {
    case "genre":
      return route.genre;
    case "redirect":
      permanentRedirect(route.href);
    case "missing":
      notFound();
  }
}

function genreView(
  catalog: Catalog,
  genre: CanonicalGenre,
  params: Record<string, string | string[] | undefined>,
  now: number,
  locale: Locale,
) {
  const entries = directoryEntries(catalog, now);
  const parsed = parseDirectoryQuery(params, catalogCities(catalog.venues), [
    "city",
    "limit",
  ]);
  const { city } = parsed.query;
  const all = filterDirectory(entries, { genre });
  const djs = city ? filterDirectory(entries, { genre, city }) : all;
  const allNights = upcomingGenreEvents(catalog, genre, now);
  const venueIds = new Set(city?.venueIds ?? []);
  const nights = city
    ? allNights.filter((event) => venueIds.has(event.venueId))
    : allNights;
  const cities = directoryFacets(entries, { genre, city }).cities;
  return {
    ...parsed,
    entries,
    all,
    djs,
    allNights,
    nights,
    cities,
    title: genreTitle(genre, nights.length, locale),
    description: genreDescription(
      genre,
      djs,
      cities,
      nights.length,
      locale,
      city,
    ),
    indexable: isIndexableGenre({ djs: all.length, nights: allNights.length }),
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const locale = await requestLocale();
  const [{ slug }, catalog, query] = await Promise.all([
    params,
    getCatalog(),
    searchParams,
  ]);
  const genre = genreOrRedirect(slug, locale, catalog);
  const view = genreView(catalog, genre, query, Date.now(), locale);
  const { city, limit } = view.query;
  const metadata = pageMetadata(
    city ? `${view.title} · Gigs in ${city.name}` : view.title,
    view.description,
    // City and longer variants point search engines at the genre page.
    genrePath(genre),
    locale,
  );
  const variant = Boolean(city) || limit !== null || view.ignored.length > 0;
  return variant || !view.indexable || catalog.mode === "demo"
    ? { ...metadata, robots: { index: false, follow: true } }
    : metadata;
}

export default async function GenrePage({ params, searchParams }: Props) {
  const locale = await requestLocale();
  const [{ slug }, catalog, query] = await Promise.all([
    params,
    getCatalog(),
    searchParams,
  ]);
  const genre = genreOrRedirect(slug, locale, catalog);
  const requestNow = requestTime();
  const view = genreView(catalog, genre, query, requestNow, locale);
  const { city } = view.query;
  const path = genrePath(genre);
  if (slug !== genre.slug || view.redirect)
    permanentRedirect(
      directoryHref(path, locale, view.query, { limit: view.query.limit }),
    );
  const href = (change: Partial<DirectoryQuery>) =>
    directoryHref(path, locale, view.query, change);
  const family = familyName(genre.family, locale);
  const limit = view.query.limit ?? djPageSize;
  const { shown, rest } = windowedEntries(view.djs, limit);
  const places = placesOf(catalog);
  const rows = shown.map((entry) =>
    djRow(entry, city, places, locale, requestNow, { genre, family: null }),
  );
  const listenable = view.djs.filter((entry) => entry.dj.soundcloudUrl).length;
  const nextRow = view.djs[shown.length];
  const nextLimit = Math.min(maxDjLimit, shown.length + djPageSize);
  const siblings = familyGenreCounts(view.entries, genre.family, city);
  if (!siblings.some(({ item }) => item.slug === genre.slug))
    siblings.unshift({ item: genre, count: 0 });
  const nightsShown = view.nights.slice(0, genreNightsShown);
  const homeFilter = homeHref(locale, emptyFilters, {
    sound: genre.family,
    genre: genre.name,
    city: city?.slug ?? "",
  });
  const demo = catalog.mode === "demo";

  return (
    <main id="main" className="directory-page genre-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            genreStructuredData(
              genre,
              demo ? [] : view.djs.map((entry) => entry.dj),
              demo ? [] : view.nights,
              locale,
              {
                name: view.title,
                description: view.description,
                path,
              },
            ),
          ),
        }}
      />
      <DemoNotice mode={catalog.mode} locale={locale} />
      <div className="city-shell directory-shell">
        <nav
          className="city-crumbs"
          aria-label={copy(locale, "Brotkrumen", "Breadcrumb")}
        >
          <Link href={localizePath("/genres", locale)}>
            <Icon name="arrow-left" />{" "}
            {copy(locale, "Alle Genres", "All genres")}
          </Link>
        </nav>
        <section
          className="city-hero directory-hero"
          aria-labelledby="genre-title"
        >
          <p className="city-kicker">
            Genre{family !== genre.name && ` · ${family}`}
            {city && ` · Gigs in ${city.name}`}
          </p>
          <h1 id="genre-title">{view.title}</h1>
          <dl className="city-stats">
            <div>
              <dt>DJs</dt>
              <dd>{formatCount(view.djs.length, locale)}</dd>
            </div>
            <div>
              <dt>{copy(locale, "Auf SoundCloud", "On SoundCloud")}</dt>
              <dd>{formatCount(listenable, locale)}</dd>
            </div>
            <div>
              <dt>{copy(locale, "Kommende Nächte", "Upcoming nights")}</dt>
              <dd>{formatCount(view.nights.length, locale)}</dd>
            </div>
          </dl>
          {view.nights.length > 0 && rows.length > 0 && (
            <p className="city-tools genre-jump">
              <a className="chip-button" href="#nights">
                <Icon name="arrow-down" />
                {copy(
                  locale,
                  `Kommende ${compound(genre.name, "Partys", "de")}`,
                  `Upcoming ${genre.name} parties`,
                )}
              </a>
            </p>
          )}
        </section>

        <div
          className="filter-panel directory-filters"
          role="group"
          aria-label={copy(locale, "Filter und Genres", "Filters and genres")}
        >
          <ScrollActiveChips
            state={JSON.stringify([genre.slug, city?.slug ?? null])}
          />
          {view.cities.length > 0 && (
            <ChipRow id="genre-cities" label="Gigs in">
              {view.cities.map(({ item, count }) => {
                const on = item.slug === city?.slug;
                return (
                  <Chip
                    key={item.slug}
                    label={item.name}
                    count={count}
                    active={on}
                    href={href({ city: on ? null : item })}
                  />
                );
              })}
            </ChipRow>
          )}
          {siblings.length > 1 && (
            <ChipRow id="genre-siblings" label="Genres" as="nav">
              {siblings.map(({ item, count }) => (
                <Chip
                  key={item.slug}
                  label={item.name}
                  count={count}
                  active={item.slug === genre.slug}
                  current="page"
                  href={directoryHref(genrePath(item), locale, {
                    ...view.query,
                    limit: null,
                  })}
                />
              ))}
            </ChipRow>
          )}
        </div>

        {(view.ignored.length > 0 || city) && (
          <div className="directory-notes">
            {view.ignored.length > 0 && (
              <p className="filter-error" role="alert">
                {copy(
                  locale,
                  `Diese Filter waren ungültig und werden ignoriert: ${view.ignored.map((key) => paramLabel(key, locale)).join(", ")}.`,
                  `These filters weren’t valid and are ignored: ${view.ignored.map((key) => paramLabel(key, locale)).join(", ")}.`,
                )}
              </p>
            )}
            {city && (
              <p className="city-filter directory-filter">
                <span>
                  <strong>Gigs in {city.name}</strong>
                </span>
                <Link href={localizePath(path, locale)} scroll={false}>
                  {copy(locale, "Filter löschen", "Clear filter")}{" "}
                  <Icon name="close" />
                </Link>
              </p>
            )}
          </div>
        )}

        <div className="genre-body">
          <section
            id="djs"
            className="genre-djs"
            aria-labelledby="genre-djs-title"
          >
            <div className="pf-label-row">
              <h2 id="genre-djs-title" className="pf-label">
                {compound(genre.name, "DJs", locale)}
                {city && ` · ${city.name}`}
              </h2>
              <span>{formatCount(view.djs.length, locale)}</span>
            </div>
            {rows.length ? (
              <>
                <FocusRow shown={shown.length} />
                <DjList
                  rows={rows}
                  listenable={listenable}
                  others={view.djs.length - listenable}
                  locale={locale}
                  level={3}
                />
                {nextRow &&
                  (nextLimit > shown.length ? (
                    <div className="more-row">
                      <Link
                        className="button button-outline more-link"
                        href={`${href({ limit: nextLimit })}#dj-${nextRow.dj.slug}`}
                        scroll={false}
                      >
                        {copy(locale, "Weitere DJs anzeigen", "Show more DJs")}{" "}
                        <span className="chip-count">
                          {copy(
                            locale,
                            `noch ${formatCount(rest, locale)}`,
                            `${formatCount(rest, locale)} more`,
                          )}
                        </span>
                      </Link>
                    </div>
                  ) : (
                    <p className="directory-cap">
                      {copy(
                        locale,
                        `Die Liste zeigt bis zu ${maxDjLimit} DJs. Wähle eine Stadt, um die übrigen ${formatCount(rest, locale)} zu finden.`,
                        `The list shows up to ${maxDjLimit} DJs. Choose a city to find the other ${formatCount(rest, locale)}.`,
                      )}
                    </p>
                  ))}
              </>
            ) : (
              <p className="quiet-empty">
                {city
                  ? copy(
                      locale,
                      `Noch keine ${compound(genre.name, "DJs", "de")} mit Gigs in ${city.name}.`,
                      `No ${genre.name} DJs with gigs in ${city.name} yet.`,
                    )
                  : copy(
                      locale,
                      `Noch keine ${compound(genre.name, "DJs", "de")} auf EVRYVIBE.`,
                      `No ${genre.name} DJs on EVRYVIBE yet.`,
                    )}
              </p>
            )}
          </section>

          <section
            id="nights"
            className="genre-nights"
            aria-labelledby="genre-nights-title"
          >
            <div className="pf-label-row">
              <h2 id="genre-nights-title" className="pf-label">
                {copy(
                  locale,
                  `Kommende ${compound(genre.name, "Partys", "de")}`,
                  `Upcoming ${genre.name} parties`,
                )}
                {city && ` · ${city.name}`}
              </h2>
              <span>{formatCount(view.nights.length, locale)}</span>
            </div>
            {nightsShown.length ? (
              <>
                <EventList
                  events={nightsShown}
                  catalog={catalog}
                  locale={locale}
                />
                {view.nights.length > nightsShown.length && (
                  <p className="city-page-link">
                    <Link href={homeFilter}>
                      {copy(
                        locale,
                        `Alle ${formatCount(view.nights.length, locale)} ${compound(genre.name, "Partys", "de")}`,
                        `All ${formatCount(view.nights.length, locale)} ${genre.name} parties`,
                      )}
                    </Link>
                  </p>
                )}
              </>
            ) : (
              <p className="quiet-empty">
                {copy(
                  locale,
                  `Gerade sind keine kommenden ${compound(genre.name, "Partys", "de")}${city ? ` in ${city.name}` : ""} veröffentlicht.`,
                  `No upcoming ${genre.name} parties${city ? ` in ${city.name}` : ""} are published right now.`,
                )}
              </p>
            )}
          </section>
        </div>

        <section
          className="city-section city-about"
          aria-labelledby="genre-about-title"
        >
          <div className="city-section-heading">
            <h2 id="genre-about-title">
              {copy(locale, "Über diese Seite", "About this page")}
            </h2>
          </div>
          <p className="city-intro">{genreAbout(genre, locale)}</p>
        </section>
      </div>
    </main>
  );
}
