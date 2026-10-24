import type { Metadata } from "next";
import { compound } from "@/components/german-compound";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { z } from "zod";
import { Icon } from "@/components/icon";
import { copy, DemoNotice } from "@/components/catalog-ui";
import { Chip, ChipRow } from "@/components/chips";
import { hasGenre } from "@/components/discovery-filters";
import { requestTime } from "@/components/request-time";
import { EventDays } from "@/components/event-days";
import { cityNights, catalogCities, findCity } from "@/core/cities";
import { localizePath, type Locale } from "@/core/i18n";
import { pageMetadata } from "@/core/site";
import { cityStructuredData, serializeJsonLd } from "@/core/structured-data";
import { getCatalog } from "@/db/catalog";
import { getCityContent } from "@/db/city-editorial";
import { requestLocale } from "@/lib/locale";
import {
  cityDescription,
  cityGenre,
  cityIntro,
  cityGenreTitle,
  cityMonths,
  monthName,
  latestObservation,
  cityTitle,
  cityView,
  countryName,
} from "../city-data";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const filtersSchema = z.object({
  genre: z.string().trim().max(100).optional().default(""),
});

const count = (value: number) => String(value).padStart(2, "0");

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
  const city = findCity(catalog.venues, slug);
  if (!city) notFound();
  const requestNow = Date.now();
  const view = cityView(catalog, city, requestNow);
  const editorial =
    catalog.mode === "database" ? await getCityContent(city.slug) : null;
  const content = editorial?.[locale];
  const parsed = filtersSchema.safeParse(query);
  const requested = parsed.success ? parsed.data.genre : "";
  const genre = cityGenre(view, requested);
  const filteredView = genre
    ? cityView(
        {
          ...catalog,
          events: catalog.events.filter((event) => hasGenre(event, genre)),
        },
        city,
        requestNow,
      )
    : view;
  const path = `/cities/${city.slug}${genre ? `?${new URLSearchParams({ genre })}` : ""}`;
  const metadata = pageMetadata(
    genre
      ? cityGenreTitle(city, genre, locale)
      : content?.seoTitle || cityTitle(city, locale),
    genre
      ? cityDescription(filteredView, locale, genre)
      : content?.metaDescription || cityDescription(view, locale),
    path,
    locale,
  );
  const invalidQuery =
    !parsed.success ||
    Boolean(requested && !genre) ||
    Object.keys(query).some((key) => key !== "genre");
  return filteredView.nights.length && catalog.mode !== "demo" && !invalidQuery
    ? metadata
    : { ...metadata, robots: { index: false, follow: true } };
}

// The editorial heading usually targets the same keyword as the H1; repeating
// it word for word under the listing reads as a mistake.
function sameHeading(a: string, b: string) {
  const key = (value: string) =>
    value
      .toLocaleLowerCase("de")
      .replace(/[\s-]+/g, " ")
      .trim();
  return key(a) === key(b);
}

function nightsLabel(value: number, locale: Locale) {
  return copy(
    locale,
    value === 1 ? "Nacht" : "Nächte",
    value === 1 ? "night" : "nights",
  );
}

export default async function CityPage({ params, searchParams }: Props) {
  const locale = await requestLocale();
  const [{ slug }, catalog, query] = await Promise.all([
    params,
    getCatalog(),
    searchParams,
  ]);
  const city = findCity(catalog.venues, slug);
  if (!city) notFound();
  const requestNow = requestTime();
  const view = cityView(catalog, city, requestNow);
  const editorial =
    catalog.mode === "database" ? await getCityContent(city.slug) : null;
  const content = editorial?.[locale];
  const path = localizePath(`/cities/${city.slug}`, locale);

  const parsed = filtersSchema.safeParse(query);
  const requested = parsed.success ? parsed.data.genre : "";
  // Any spelling of a city genre selects it; an alias spelling redirects to
  // the canonical page so each genre has one URL.
  const genre = cityGenre(view, requested);
  if (genre && requested !== genre)
    permanentRedirect(
      localizePath(
        `/cities/${city.slug}?${new URLSearchParams({ genre })}`,
        locale,
      ),
    );
  const unknownGenre = Boolean(requested && !genre);
  const events = genre
    ? view.events.filter((event) => hasGenre(event, genre))
    : view.events;

  const title = genre
    ? cityGenreTitle(city, genre, locale)
    : cityTitle(city, locale);
  const filteredView = genre
    ? cityView(
        {
          ...catalog,
          events: catalog.events.filter((event) => hasGenre(event, genre)),
        },
        city,
        requestNow,
      )
    : view;
  const description = cityDescription(filteredView, locale, genre);
  const intro = genre
    ? cityIntro(filteredView, locale, genre)
    : cityIntro(view, locale);
  const filteredCatalog = genre
    ? {
        ...catalog,
        events: catalog.events.filter((event) => hasGenre(event, genre)),
      }
    : catalog;
  const months = cityMonths(filteredCatalog, city, requestNow);
  const directory = genre
    ? {
        ...filteredView,
        venues: filteredView.venues.filter(({ nights }) => nights > 0),
      }
    : view;
  const observation =
    catalog.mode === "demo" ? null : latestObservation(filteredView.events);

  const otherCities = catalogCities(catalog.venues)
    .filter((other) => other.slug !== city.slug)
    .map((other) => ({
      city: other,
      nights: cityNights(catalog, other, requestNow).length,
    }))
    .sort(
      (a, b) =>
        b.nights - a.nights || a.city.name.localeCompare(b.city.name, "de"),
    );

  return (
    <main id="main" className="city-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            cityStructuredData(
              city,
              catalog.mode === "demo" ? [] : filteredView.nights,
              locale,
              {
                name: title,
                description,
                path: `/cities/${city.slug}${genre ? `?${new URLSearchParams({ genre })}` : ""}`,
              },
            ),
          ),
        }}
      />
      <DemoNotice mode={catalog.mode} locale={locale} />
      <div className="city-shell">
        <nav
          className="city-crumbs"
          aria-label={copy(locale, "Brotkrumen", "Breadcrumb")}
        >
          <Link href={localizePath("/cities", locale)}>
            <Icon name="arrow-left" />{" "}
            {copy(locale, "Alle Städte", "All cities")}
          </Link>
        </nav>
        <section className="city-hero" aria-labelledby="city-title">
          <p className="city-kicker">
            {genre
              ? copy(
                  locale,
                  `${compound(genre, "Events", "de")}`,
                  `${genre} events`,
                )
              : copy(locale, "Techno", "Techno")}{" "}
            · {countryName(city.country, locale)}
          </p>
          <h1 id="city-title" className="city-context-title">
            {title}
          </h1>
          <dl className="city-stats">
            <div>
              <dt>
                {genre
                  ? copy(
                      locale,
                      `Kommende ${compound(genre, "Events", "de")}`,
                      `Upcoming ${genre} events`,
                    )
                  : copy(locale, "Kommende Nächte", "Upcoming nights")}
              </dt>
              <dd>{count(filteredView.nights.length)}</dd>
            </div>
            <div>
              <dt>{copy(locale, "Clubs", "Venues")}</dt>
              <dd>{count(directory.venues.length)}</dd>
            </div>
            <div>
              <dt>{copy(locale, "DJs gebucht", "DJs booked")}</dt>
              <dd>{count(filteredView.djs.length)}</dd>
            </div>
          </dl>
          {view.nights.length > 0 && (
            <p className="city-tools">
              <Link
                className="chip-button"
                href={`${localizePath("/", locale)}?${new URLSearchParams({ city: city.slug })}`}
              >
                <Icon name="calendar" />
                {copy(
                  locale,
                  "Nach Datum und Sound filtern",
                  "Filter by date and sound",
                )}
              </Link>
            </p>
          )}
        </section>

        {(view.genres.length > 0 || months.length > 0) && (
          <div className="city-filters">
            {view.genres.length > 0 && (
              <ChipRow id="city-genres" label="Genre">
                {view.genres.map(({ item, nights }) => (
                  <Chip
                    key={item}
                    label={item}
                    count={nights}
                    active={item === genre}
                    href={
                      item === genre
                        ? `${path}#nights`
                        : `${path}?${new URLSearchParams({ genre: item })}#nights`
                    }
                  />
                ))}
              </ChipRow>
            )}
            {months.length > 0 && (
              <ChipRow
                id="city-months"
                label={copy(locale, "Monat", "Month")}
                as="nav"
              >
                {months.map((month) => (
                  <Chip
                    key={month}
                    label={monthName(month, locale)}
                    href={localizePath(
                      `/cities/${city.slug}/${month}${genre ? `?${new URLSearchParams({ genre })}` : ""}`,
                      locale,
                    )}
                  />
                ))}
              </ChipRow>
            )}
          </div>
        )}

        <section
          id="nights"
          className="city-section city-nights"
          aria-labelledby="city-nights-title"
        >
          <h2 id="city-nights-title" className="visually-hidden">
            {genre
              ? copy(
                  locale,
                  `Kommende ${compound(genre, "Events", "de")}`,
                  `Upcoming ${genre} events`,
                )
              : copy(locale, "Kommende Nächte", "Upcoming nights")}
          </h2>
          {genre && (
            <p className="city-filter">
              <span>
                {copy(locale, "Genre", "Genre")}: <strong>{genre}</strong>
              </span>
              <Link href={`${path}#nights`} scroll={false}>
                {copy(locale, "Filter löschen", "Clear filter")}{" "}
                <Icon name="close" />
              </Link>
            </p>
          )}
          {(!parsed.success || unknownGenre) && (
            <p className="filter-error" role="alert">
              {!parsed.success
                ? copy(
                    locale,
                    "Dieser Filter ist ungültig. Wir zeigen alle kommenden Nächte.",
                    "That filter wasn’t valid. Showing all upcoming nights.",
                  )
                : copy(
                    locale,
                    `Keine kommenden Nächte mit „${requested}“ in ${city.name}. Wir zeigen alle kommenden Nächte.`,
                    `No upcoming nights tagged “${requested}” in ${city.name}. Showing all upcoming nights.`,
                  )}
            </p>
          )}
          {events.length ? (
            <EventDays
              events={events}
              catalog={catalog}
              locale={locale}
              now={requestNow}
            />
          ) : (
            <div className="empty-state city-empty">
              <h3>
                {copy(
                  locale,
                  `Noch keine Nächte in ${city.name}`,
                  `No nights in ${city.name} yet`,
                )}
              </h3>
              <p>
                {copy(
                  locale,
                  `Für ${city.name} sind gerade keine kommenden Events veröffentlicht. Die Clubs unten zeigen, wo als Nächstes etwas angekündigt wird.`,
                  `No upcoming events are published for ${city.name} right now. The venues below are where the next nights will be announced.`,
                )}
              </p>
              <Link
                className="button button-outline"
                href={localizePath("/", locale)}
              >
                {copy(locale, "Alle Nächte ansehen", "See all nights")}
              </Link>
            </div>
          )}
        </section>

        <div className="city-directory">
          <section className="city-section" aria-labelledby="city-venues">
            <div className="city-section-heading">
              <h2 id="city-venues">{copy(locale, "Clubs", "Venues")}</h2>
              <span className="city-label">
                {count(directory.venues.length)}
              </span>
            </div>
            <ul className="city-rows">
              {directory.venues.map(({ item: venue, nights }) => (
                <li key={venue.id}>
                  <Link href={localizePath(`/venues/${venue.slug}`, locale)}>
                    <span className="city-row-main">
                      <strong>{venue.name}</strong>
                      <span>{venue.address}</span>
                    </span>
                    <span className="city-row-count">
                      {nights} {nightsLabel(nights, locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section className="city-section" aria-labelledby="city-djs">
            <div className="city-section-heading">
              <h2 id="city-djs">DJs</h2>
              <span className="city-label">
                {count(filteredView.djs.length)}
              </span>
            </div>
            {filteredView.djs.length ? (
              <details className="city-dj-directory">
                <summary>
                  {copy(
                    locale,
                    `Alle ${filteredView.djs.length} gebuchten DJs ansehen`,
                    `See all ${filteredView.djs.length} booked DJs`,
                  )}
                </summary>
                <ul className="city-rows">
                  {filteredView.djs.map(({ item: dj, nights }) => (
                    <li key={dj.id}>
                      <Link href={localizePath(`/djs/${dj.slug}`, locale)}>
                        <span className="city-row-main">
                          <strong>{dj.name}</strong>
                          {dj.genres.length > 0 && (
                            <span>{dj.genres.slice(0, 3).join(" · ")}</span>
                          )}
                        </span>
                        <span className="city-row-count">
                          {nights} {nightsLabel(nights, locale)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="quiet-empty">
                {copy(
                  locale,
                  `Für die kommenden Nächte in ${city.name} sind noch keine DJs bekannt.`,
                  `No DJs are known yet for the upcoming nights in ${city.name}.`,
                )}
              </p>
            )}
          </section>
        </div>

        {otherCities.length > 0 && (
          <div className="city-section city-others">
            <ChipRow
              id="city-others"
              label={copy(locale, "Weitere Städte", "Other cities")}
              as="nav"
            >
              {otherCities.map(({ city: other, nights }) => (
                <Chip
                  key={other.slug}
                  label={other.name}
                  count={nights}
                  href={localizePath(`/cities/${other.slug}`, locale)}
                />
              ))}
            </ChipRow>
          </div>
        )}
        <section
          className="city-section city-about"
          aria-labelledby="city-about-title"
        >
          <div className="city-section-heading">
            <h2 id="city-about-title">
              {copy(locale, "Über dieses Programm", "About this programme")}
            </h2>
          </div>
          <p className="city-intro">{intro}</p>
          {observation && (
            <p className="city-freshness">
              {copy(
                locale,
                "Neueste Eventquelle erfasst: ",
                "Latest event source observed: ",
              )}
              <time dateTime={observation}>
                {new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", {
                  dateStyle: "long",
                  timeStyle: "short",
                  timeZone: city.timezone,
                }).format(new Date(observation))}{" "}
                ({city.timezone})
              </time>
            </p>
          )}
        </section>
        {!genre && content && editorial && (
          <section
            className="city-section city-editorial"
            aria-labelledby="city-editorial-title"
          >
            <div className="city-section-heading">
              <h2 id="city-editorial-title">
                {sameHeading(content.heading, title)
                  ? copy(
                      locale,
                      `Mehr über Techno in ${city.name}`,
                      `More about techno in ${city.name}`,
                    )
                  : content.heading}
              </h2>
            </div>
            <p className="city-intro">{content.intro}</p>
            <p className="city-freshness">
              <span>
                {copy(
                  locale,
                  "Stadttext aktualisiert: ",
                  "City text updated: ",
                )}
                <time dateTime={editorial.updatedAt}>
                  {new Intl.DateTimeFormat(
                    locale === "en" ? "en-GB" : "de-DE",
                    { dateStyle: "long", timeZone: city.timezone },
                  ).format(new Date(editorial.updatedAt))}
                </time>
              </span>
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
