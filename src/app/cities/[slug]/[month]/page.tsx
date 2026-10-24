import type { Metadata } from "next";
import { compound } from "@/components/german-compound";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { z } from "zod";
import { copy, DemoNotice } from "@/components/catalog-ui";
import { EventDays } from "@/components/event-days";
import { Icon } from "@/components/icon";
import { Chip, ChipRow } from "@/components/chips";
import { hasGenre } from "@/components/discovery-filters";
import { canonicalGenre } from "@/core/genres";
import { findCity, isScheduled, cityNights } from "@/core/cities";
import { localizePath } from "@/core/i18n";
import { pageMetadata } from "@/core/site";
import {
  cityMonthStructuredData,
  serializeJsonLd,
} from "@/core/structured-data";
import { getCatalog } from "@/db/catalog";
import { requestLocale } from "@/lib/locale";
import {
  cityMonthEvents,
  cityMonths,
  countryName,
  latestObservation,
  monthName,
} from "../../city-data";

export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{ slug: string; month: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const routeSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  month: z.string().regex(/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/),
});

async function monthData(
  params: Props["params"],
  searchParams: Props["searchParams"],
) {
  const parsed = routeSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const [catalog, locale] = await Promise.all([getCatalog(), requestLocale()]);
  const city = findCity(catalog.venues, parsed.data.slug);
  if (!city) notFound();
  const now = Date.now();
  const month = parsed.data.month;
  const months = cityMonths(catalog, city, now);
  if (!months.includes(month)) notFound();
  const query = await searchParams;
  const filter = z
    .object({ genre: z.string().trim().max(100).optional().default("") })
    .safeParse(query);
  const requested = filter.success ? filter.data.genre : "";
  // Any spelling of a genre selects it; the page uses the canonical name.
  const genre = requested ? (canonicalGenre(requested)?.name ?? requested) : "";
  const knownGenre =
    !genre ||
    cityNights(catalog, city, now).some((event) => hasGenre(event, genre));
  const invalidQuery =
    !filter.success ||
    !knownGenre ||
    Object.keys(query).some((key) => key !== "genre");
  const filteredCatalog = genre
    ? {
        ...catalog,
        events: catalog.events.filter((event) => hasGenre(event, genre)),
      }
    : catalog;
  const filteredMonths = cityMonths(filteredCatalog, city, now);
  const events =
    !filter.success || !knownGenre
      ? []
      : cityMonthEvents(filteredCatalog, city, month, now);
  const nights = events.filter(isScheduled);
  const name = monthName(month, locale);
  const title = copy(
    locale,
    genre
      ? `Kommende ${compound(genre, "Events", "de")} in ${city.name} im ${name}`
      : `Techno-Partys in ${city.name} im ${name}`,
    genre
      ? `Upcoming ${genre} events in ${city.name} in ${name}`
      : `Techno parties in ${city.name} in ${name}`,
  );
  const venueIds = new Set(nights.map((event) => event.venueId));
  const venues = catalog.venues.filter((venue) => venueIds.has(venue.id));
  const genres = [...new Set(nights.flatMap((event) => event.genres))];
  const eventLabelDe = genre
    ? `${compound(genre, nights.length === 1 ? "Event" : "Events", "de")}`
    : nights.length === 1
      ? "Techno-Party"
      : "Techno-Partys";
  const eventLabelEn = genre
    ? `${genre} ${nights.length === 1 ? "event" : "events"}`
    : nights.length === 1
      ? "techno party"
      : "techno parties";
  const description = copy(
    locale,
    `${nights.length} ${nights.length === 1 ? "kommendes" : "kommende"} ${eventLabelDe} in ${city.name} im ${name}. ${venues.length} ${venues.length === 1 ? "Club" : "Clubs"}${genres.length ? `, ${genres.slice(0, 3).join(", ")}` : ""}. Termine, bekannte Line-ups und Quellen im Monatsprogramm.`,
    `${nights.length} upcoming ${eventLabelEn} in ${city.name} in ${name}. ${venues.length} ${venues.length === 1 ? "venue" : "venues"}${genres.length ? `, ${genres.slice(0, 3).join(", ")}` : ""}. Dates, known line-ups and sources in the monthly programme.`,
  );
  return {
    catalog,
    locale,
    city,
    month,
    months: filteredMonths,
    events,
    nights,
    title,
    description,
    now,
    venues,
    genre,
    // An alias spelling of a known genre belongs at the canonical URL.
    redirectPath:
      genre && knownGenre && requested !== genre
        ? localizePath(
            `/cities/${city.slug}/${month}?${new URLSearchParams({ genre })}`,
            locale,
          )
        : null,
    invalidQuery,
    path: `/cities/${city.slug}/${month}${genre && knownGenre && nights.length > 0 ? `?${new URLSearchParams({ genre })}` : ""}`,
  };
}

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const data = await monthData(params, searchParams);
  const metadata = pageMetadata(
    data.title,
    data.description,
    data.path,
    data.locale,
  );
  return data.catalog.mode !== "demo" &&
    !data.invalidQuery &&
    data.nights.length > 0
    ? metadata
    : { ...metadata, robots: { index: false, follow: true } };
}

export default async function CityMonthPage({ params, searchParams }: Props) {
  const {
    catalog,
    locale,
    city,
    month,
    months,
    events,
    nights,
    title,
    description,
    now,
    venues,
    genre,
    path,
    redirectPath,
  } = await monthData(params, searchParams);
  if (redirectPath) permanentRedirect(redirectPath);
  const observation =
    catalog.mode === "demo" ? null : latestObservation(events);
  return (
    <main id="main" className="city-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            cityMonthStructuredData(
              city,
              catalog.mode === "demo" ? [] : nights,
              month,
              locale,
              { name: title, description, path },
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
          <Link
            href={localizePath(
              `/cities/${city.slug}${genre ? `?${new URLSearchParams({ genre })}` : ""}`,
              locale,
            )}
          >
            <Icon name="arrow-left" />{" "}
            {copy(
              locale,
              genre
                ? `Alle ${compound(genre, "Events", "de")} in ${city.name}`
                : `Alle Nächte in ${city.name}`,
              genre
                ? `All ${genre} events in ${city.name}`
                : `All nights in ${city.name}`,
            )}
          </Link>
        </nav>
        <section className="city-hero" aria-labelledby="city-title">
          <p className="city-kicker">
            {genre
              ? copy(
                  locale,
                  `${compound(genre, "Events", "de")} · Monatsprogramm`,
                  `${genre} events · Monthly programme`,
                )
              : copy(locale, "Monatsprogramm", "Monthly programme")}{" "}
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
              <dd>{String(nights.length).padStart(2, "0")}</dd>
            </div>
            <div>
              <dt>{copy(locale, "Clubs", "Venues")}</dt>
              <dd>{String(venues.length).padStart(2, "0")}</dd>
            </div>
          </dl>
        </section>
        {months.length > 0 && (
          <div className="city-filters">
            <ChipRow
              id="city-months"
              label={copy(locale, "Monat", "Month")}
              as="nav"
            >
              {months.map((item) => (
                <Chip
                  key={item}
                  label={monthName(item, locale)}
                  active={item === month}
                  current="page"
                  href={localizePath(
                    `/cities/${city.slug}/${item}${genre ? `?${new URLSearchParams({ genre })}` : ""}`,
                    locale,
                  )}
                />
              ))}
            </ChipRow>
          </div>
        )}
        <section
          className="city-section city-nights"
          aria-labelledby="month-nights"
        >
          <h2 id="month-nights" className="visually-hidden">
            {copy(locale, "Termine und Line-ups", "Dates and line-ups")}
          </h2>
          {genre && (
            <p className="city-filter">
              <span>
                {copy(locale, "Genre", "Genre")}: <strong>{genre}</strong>
              </span>
              <Link
                href={localizePath(`/cities/${city.slug}/${month}`, locale)}
              >
                {copy(locale, "Filter löschen", "Clear filter")}
              </Link>
            </p>
          )}
          {events.length ? (
            <EventDays
              events={events}
              catalog={catalog}
              locale={locale}
              now={now}
            />
          ) : (
            <div className="empty-state city-empty">
              <h3>
                {copy(
                  locale,
                  "Keine passenden kommenden Events",
                  "No matching upcoming events",
                )}
              </h3>
              <p>
                {copy(
                  locale,
                  "Für diesen Monat und Filter sind keine kommenden Events veröffentlicht. Lösche den Filter, um das gesamte Monatsprogramm anzusehen.",
                  "No upcoming events are published for this month and filter. Clear the filter to see the full monthly programme.",
                )}
              </p>
              <Link
                className="button button-outline"
                href={localizePath(`/cities/${city.slug}/${month}`, locale)}
              >
                {copy(
                  locale,
                  "Gesamtes Monatsprogramm",
                  "Full monthly programme",
                )}
              </Link>
            </div>
          )}
        </section>
        <section className="city-section" aria-labelledby="month-venues">
          <div className="city-section-heading">
            <h2 id="month-venues">
              {copy(
                locale,
                "Clubs im Monatsprogramm",
                "Venues in this programme",
              )}
            </h2>
          </div>
          <ul className="city-rows">
            {venues.map((venue) => (
              <li key={venue.id}>
                <Link href={localizePath(`/venues/${venue.slug}`, locale)}>
                  <span className="city-row-main">
                    <strong>{venue.name}</strong>
                    <span>{venue.address}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section
          className="city-section city-about"
          aria-labelledby="month-about"
        >
          <div className="city-section-heading">
            <h2 id="month-about">
              {copy(locale, "Über dieses Programm", "About this programme")}
            </h2>
          </div>
          <p className="city-intro">
            {description}{" "}
            {copy(
              locale,
              "Das Programm zeigt veröffentlichte Ankündigungen. Weitere Clubs und Events können fehlen; Details und Tickets findest du auf der jeweiligen Eventseite.",
              "The programme shows published announcements. Other venues and events may be missing; each event page has details and available ticket links.",
            )}
          </p>
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
      </div>
    </main>
  );
}
