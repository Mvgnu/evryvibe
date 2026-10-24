import type { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { copy, DemoNotice } from "@/components/catalog-ui";
import { Chip, ChipRow } from "@/components/chips";
import {
  directoryDescription,
  directoryFilter,
  directoryHref,
  djPageSize,
  djRow,
  djsTitle,
  familyName,
  formatCount,
  genrePath,
  isFilteredQuery,
  maxDjLimit,
  paramLabel,
  parseDirectoryQuery,
  placesOf,
  windowedEntries,
  type DirectoryQuery,
} from "@/components/dj-directory-view";
import { DjList } from "@/components/dj-list";
import { FocusRow } from "@/components/focus-row";
import { Icon } from "@/components/icon";
import { requestTime } from "@/components/request-time";
import { ScrollActiveChips } from "@/components/scroll-active";
import { catalogCities } from "@/core/cities";
import {
  directoryEntries,
  directoryFacets,
  filterDirectory,
  type DirectoryEntry,
} from "@/core/dj-directory";
import { genreFamilyBySlug } from "@/core/genres";
import { localizePath, type Locale } from "@/core/i18n";
import type { Catalog } from "@/core/model";
import { pageMetadata } from "@/core/site";
import {
  djDirectoryStructuredData,
  serializeJsonLd,
} from "@/core/structured-data";
import { getCatalog } from "@/db/catalog";
import { requestLocale } from "@/lib/locale";
import "../directory.css";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const path = "/djs";

// Everything the page and its metadata say, computed once per render.
function directoryView(
  catalog: Catalog,
  params: Record<string, string | string[] | undefined>,
  now: number,
  locale: Locale,
) {
  const entries = directoryEntries(catalog, now);
  const parsed = parseDirectoryQuery(params, catalogCities(catalog.venues));
  const { query } = parsed;
  const filter = directoryFilter(query);
  const results = filterDirectory(entries, filter);
  const facets = directoryFacets(entries, filter);
  const subject =
    query.genre?.name ??
    (query.family ? familyName(query.family, locale) : "Techno");
  const title = djsTitle(subject, locale);
  return {
    ...parsed,
    entries,
    results,
    facets,
    subject,
    title,
    description: directoryDescription(
      results,
      facets.cities,
      locale,
      subject,
      query.city,
    ),
  };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const locale = await requestLocale();
  const [catalog, params] = await Promise.all([getCatalog(), searchParams]);
  const view = directoryView(catalog, params, Date.now(), locale);
  const { query } = view;
  const filtered = isFilteredQuery(query);
  const metadata = pageMetadata(
    filtered
      ? `${view.title}${query.city ? copy(locale, ` mit Gigs in ${query.city.name}`, ` with gigs in ${query.city.name}`) : ""}`
      : copy(
          locale,
          "Techno-DJs: SoundCloud, Gigs & Partys",
          "Techno DJs: SoundCloud, gigs & parties",
        ),
    view.description,
    // Filtered and longer variants point search engines at the directory.
    path,
    locale,
  );
  const variant = filtered || query.limit !== null || view.ignored.length > 0;
  return variant || catalog.mode === "demo" || !view.entries.length
    ? { ...metadata, robots: { index: false, follow: true } }
    : metadata;
}

const listenableCount = (entries: readonly DirectoryEntry[]) =>
  entries.filter((entry) => entry.dj.soundcloudUrl).length;

export default async function DjsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const locale = await requestLocale();
  const [catalog, params] = await Promise.all([getCatalog(), searchParams]);
  const requestNow = requestTime();
  const view = directoryView(catalog, params, requestNow, locale);
  const { query, results, facets, ignored } = view;
  if (view.redirect)
    permanentRedirect(
      directoryHref(path, locale, query, { limit: query.limit }),
    );
  const href = (change: Partial<DirectoryQuery>) =>
    directoryHref(path, locale, query, change);
  const filtered = isFilteredQuery(query);
  const limit = query.limit ?? djPageSize;
  const { shown, rest } = windowedEntries(results, limit);
  const places = placesOf(catalog);
  const rows = shown.map((entry) =>
    djRow(entry, query.city, places, locale, requestNow, query),
  );
  const listenable = listenableCount(results);
  const upcoming = results.filter((entry) =>
    query.city
      ? entry.cities.some(
          (tally) => tally.city.slug === query.city?.slug && tally.upcoming > 0,
        )
      : entry.upcomingNights > 0,
  ).length;
  const nextRow = results[shown.length];
  const nextLimit = Math.min(maxDjLimit, shown.length + djPageSize);
  const familyGenres = query.family
    ? facets.genres.filter(({ item }) => item.family === query.family)
    : [];
  const filterSummary = [
    query.genre?.name ??
      (query.family ? familyName(query.family, locale) : null),
    query.city ? `Gigs in ${query.city.name}` : null,
  ].filter((part) => part !== null);
  const topGenres = directoryFacets(view.entries, {}).genres.slice(0, 16);

  return (
    <main id="main" className="directory-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            djDirectoryStructuredData(
              catalog.mode === "demo" ? [] : results.map((entry) => entry.dj),
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
        <section
          className="city-hero directory-hero"
          aria-labelledby="djs-title"
        >
          <p className="city-kicker">
            DJs
            {query.city && ` · Gigs in ${query.city.name}`}
          </p>
          <h1 id="djs-title">{view.title}</h1>
          <dl className="city-stats">
            <div>
              <dt>DJs</dt>
              <dd>{formatCount(results.length, locale)}</dd>
            </div>
            <div>
              <dt>{copy(locale, "Auf SoundCloud", "On SoundCloud")}</dt>
              <dd>{formatCount(listenable, locale)}</dd>
            </div>
            <div>
              <dt>
                {copy(locale, "Mit kommendem Gig", "With an upcoming gig")}
              </dt>
              <dd>{formatCount(upcoming, locale)}</dd>
            </div>
          </dl>
          {query.genre && (
            <p className="city-tools">
              <Link
                className="chip-button"
                href={localizePath(genrePath(query.genre), locale)}
              >
                {copy(
                  locale,
                  `${query.genre.name}: DJs und Partys`,
                  `${query.genre.name}: DJs and parties`,
                )}{" "}
                <Icon name="arrow-up-right" />
              </Link>
            </p>
          )}
        </section>

        {(facets.cities.length > 0 || facets.families.length > 0) && (
          <section
            className="filter-panel directory-filters"
            aria-label={copy(locale, "Filter", "Filters")}
          >
            <ScrollActiveChips state={href({ limit: query.limit })} />
            {facets.cities.length > 0 && (
              <ChipRow id="filter-city" label="Gigs in">
                {facets.cities.map(({ item, count }) => {
                  const on = item.slug === query.city?.slug;
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
            {facets.families.length > 0 && (
              <ChipRow id="filter-sound" label="Sound">
                {facets.families.map(({ item, count }) => {
                  const on = item.slug === query.family;
                  return (
                    <Chip
                      key={item.slug}
                      label={item.label[locale]}
                      count={count}
                      active={on}
                      swatch={genreFamilyBySlug(item.slug)?.motif}
                      href={href({
                        family: on ? null : item.slug,
                        genre: null,
                      })}
                    />
                  );
                })}
              </ChipRow>
            )}
            {familyGenres.length > 1 && (
              <ChipRow id="filter-genre" label="Genre">
                {familyGenres.map(({ item, count }) => {
                  const on = item.slug === query.genre?.slug;
                  return (
                    <Chip
                      key={item.slug}
                      label={item.name}
                      count={count}
                      active={on}
                      href={href({ genre: on ? null : item })}
                    />
                  );
                })}
              </ChipRow>
            )}
          </section>
        )}

        <section
          id="djs"
          className="directory-section"
          aria-label={copy(locale, "DJ-Liste", "DJ list")}
        >
          {ignored.length > 0 && (
            <p className="filter-error" role="alert">
              {copy(
                locale,
                `Diese Filter waren ungültig und werden ignoriert: ${ignored.map((key) => paramLabel(key, locale)).join(", ")}.`,
                `These filters weren’t valid and are ignored: ${ignored.map((key) => paramLabel(key, locale)).join(", ")}.`,
              )}
            </p>
          )}
          {filtered && (
            <p className="city-filter directory-filter">
              <span>
                <strong>
                  {formatCount(results.length, locale)}{" "}
                  {results.length === 1 ? "DJ" : "DJs"}
                </strong>{" "}
                · {filterSummary.join(" · ")}
              </span>
              <Link href={localizePath(path, locale)} scroll={false}>
                {copy(locale, "Filter löschen", "Clear filters")}{" "}
                <Icon name="close" />
              </Link>
            </p>
          )}
          {rows.length ? (
            <>
              <FocusRow shown={shown.length} />
              <DjList
                rows={rows}
                listenable={listenable}
                others={results.length - listenable}
                locale={locale}
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
                      `Die Liste zeigt bis zu ${maxDjLimit} DJs. Wähle eine Stadt oder einen Sound, um die übrigen ${formatCount(rest, locale)} zu finden.`,
                      `The list shows up to ${maxDjLimit} DJs. Choose a city or a sound to find the other ${formatCount(rest, locale)}.`,
                    )}
                  </p>
                ))}
            </>
          ) : (
            <div className="empty-state">
              <h3>
                {filtered
                  ? copy(
                      locale,
                      "Keine DJs für diese Filter",
                      "No DJs match these filters",
                    )
                  : copy(locale, "Noch keine DJs", "No DJs yet")}
              </h3>
              <p>
                {filtered
                  ? copy(
                      locale,
                      "Entferne einen Filter oder wähle eine andere Stadt oder einen anderen Sound.",
                      "Remove a filter or try another city or sound.",
                    )
                  : copy(
                      locale,
                      "Sobald Events mit Line-up veröffentlicht sind, erscheinen ihre DJs hier.",
                      "DJs appear here once events with a line-up are published.",
                    )}
              </p>
              {filtered && (
                <Link
                  className="button button-outline"
                  href={localizePath(path, locale)}
                >
                  {copy(locale, "Alle DJs anzeigen", "Show all DJs")}
                </Link>
              )}
            </div>
          )}
        </section>

        {topGenres.length > 0 && (
          <div className="city-section directory-more">
            <ChipRow
              id="djs-genres"
              label={copy(locale, "Nach Genre", "By genre")}
              as="nav"
            >
              {topGenres.map(({ item, count }) => (
                <Chip
                  key={item.slug}
                  label={item.name}
                  count={count}
                  href={localizePath(genrePath(item), locale)}
                />
              ))}
              <li>
                <Link className="chip" href={localizePath("/genres", locale)}>
                  {copy(locale, "Alle Genres", "All genres")}
                </Link>
              </li>
            </ChipRow>
          </div>
        )}
      </div>
    </main>
  );
}
