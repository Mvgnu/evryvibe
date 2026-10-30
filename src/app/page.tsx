import Link from "next/link";
import { Icon } from "@/components/icon";
import { genreFamilyBySlug } from "@/core/genres";
import { pageMetadata } from "@/core/site";
import { homeStructuredData, serializeJsonLd } from "@/core/structured-data";
import { cityPath, isScheduled, isUpcoming } from "@/core/cities";
import { requestLocale } from "@/lib/locale";
import { localizePath, type Locale } from "@/core/i18n";
import { getCatalog } from "@/db/catalog";
import { copy, DemoNotice } from "@/components/catalog-ui";
import { EventDays } from "@/components/event-days";
import { Popover } from "@/components/popover";
import { Chip, ChipRow } from "@/components/chips";
import { ScrollActiveChips } from "@/components/scroll-active";
import {
  dateChipLabel,
  earliestToday,
  filterLabel,
  homeHref,
  homeView,
  isFiltered,
  pageSize,
  parseHomeFilters,
  soundLabel,
  upcomingListings,
  whenLabel,
  windowed,
  type HomeFilters,
} from "@/components/discovery-filters";
import { requestTime } from "@/components/request-time";
import { NightExplorer } from "@/components/night-explorer";
import { nightMapData } from "@/components/night-map-data";

const homeDescription = (locale: Locale) =>
  copy(
    locale,
    "Kommende Techno-Partys mit Line-ups, Clubs und Tickets. Finde deine nächste Techno-Nacht mit EVRYVIBE.",
    "Upcoming techno parties with line-ups, venues and tickets. Find your next techno night with EVRYVIBE.",
  );
export async function generateMetadata() {
  const locale = await requestLocale();
  return pageMetadata(
    copy(
      locale,
      "Techno-Partys: Events, Line-ups & Tickets",
      "Techno parties: events, line-ups & tickets",
    ),
    homeDescription(locale),
    "/",
    locale,
  );
}
export const dynamic = "force-dynamic";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const nightsWord = (count: number, locale: Locale) =>
  copy(
    locale,
    count === 1 ? "Nacht" : "Nächte",
    count === 1 ? "night" : "nights",
  );

// Hidden fields that keep the other filters when a form is submitted.
function Keep({
  filters,
  omit,
}: {
  filters: HomeFilters;
  omit: (keyof HomeFilters)[];
}) {
  const values: [keyof HomeFilters, string][] = [
    ["q", filters.q],
    ["date", filters.date],
    ["when", filters.date ? "" : (filters.when ?? "")],
    ["city", filters.city],
    ["sound", filters.sound ?? ""],
    ["genre", filters.genre],
  ];
  return values
    .filter(([key, value]) => value && !omit.includes(key))
    .map(([key, value]) => (
      <input key={key} type="hidden" name={key} value={value} />
    ));
}

export default async function Discovery({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const locale = await requestLocale();
  const [catalog, params] = await Promise.all([getCatalog(), searchParams]);
  const { filters, ignored } = parseHomeFilters(params);
  const requestNow = requestTime();
  const listings = upcomingListings(catalog, requestNow);
  const view = homeView(listings, catalog, filters, locale);
  const filtered = isFiltered(filters);
  const limit = filters.limit ?? pageSize;
  const { shown, rest } = windowed(view.results, limit);
  const nextRow = rest[0];
  // Like the header, the count names scheduled nights, not cancellations.
  const restNights = rest.filter((listing) =>
    isScheduled(listing.event),
  ).length;
  const href = (change: Partial<HomeFilters>) =>
    homeHref(locale, filters, change);
  const today = earliestToday(listings, requestNow);
  const dateText = filters.date
    ? dateChipLabel(filters.date, today, locale)
    : "";
  // A date before today everywhere can only match nights still running.
  const past = Boolean(filters.date && filters.date < today && !shown.length);

  const active: { key: string; label: string; href: string }[] = [
    ...(filters.q
      ? [{ key: "q", label: `“${filters.q}”`, href: href({ q: "" }) }]
      : []),
    ...(filters.date
      ? [
          {
            key: "date",
            label: dateText,
            href: href({ date: "" }),
          },
        ]
      : filters.when
        ? [
            {
              key: "when",
              label: whenLabel(filters.when, locale),
              href: href({ when: null }),
            },
          ]
        : []),
    ...(filters.city
      ? [
          {
            key: "city",
            label: view.cityName ?? filters.city,
            href: href({ city: "" }),
          },
        ]
      : []),
    ...(filters.sound
      ? [
          {
            key: "sound",
            label: soundLabel(filters.sound, locale),
            href: href({ sound: null, genre: "" }),
          },
        ]
      : []),
    ...(filters.genre
      ? [{ key: "genre", label: filters.genre, href: href({ genre: "" }) }]
      : []),
  ];
  const cityPage = view.cityName ? cityPath(view.cityName) : null;

  return (
    <main id="main" className="discovery">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            homeStructuredData(
              catalog.mode === "demo"
                ? []
                : catalog.events
                    .filter((event) =>
                      catalog.venues.some(
                        (venue) =>
                          venue.id === event.venueId &&
                          isUpcoming(event, requestNow, venue.timezone),
                      ),
                    )
                    .sort(
                      (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
                    ),
              locale,
              homeDescription(locale),
            ),
          ),
        }}
      />
      <DemoNotice mode={catalog.mode} locale={locale} />
      <NightExplorer
        locale={locale}
        data={nightMapData(view.results, catalog, locale)}
        now={requestNow}
        demo={catalog.mode === "demo"}
        cityFilter={filters.city}
        head={
          <section className="discovery-head" aria-labelledby="home-title">
            <div className="home-heading">
              <h1 id="home-title">
                {copy(locale, "Techno-Partys", "Techno parties")}
              </h1>
              <p className="home-count">
                {filtered
                  ? copy(
                      locale,
                      `${view.shown} von ${view.total} ${nightsWord(view.total, locale)}`,
                      `${view.shown} of ${view.total} ${nightsWord(view.total, locale)}`,
                    )
                  : copy(
                      locale,
                      `${view.total} ${view.total === 1 ? "kommende Nacht" : "kommende Nächte"}`,
                      `${view.total} upcoming ${nightsWord(view.total, locale)}`,
                    )}
              </p>
              <Link
                className="home-reels-link"
                href={localizePath("/reels", locale)}
              >
                <Icon name="play" />
                <span className="home-reels-long">
                  {copy(
                    locale,
                    "Reels: DJs aus deiner Nähe hören",
                    "Reels: hear DJs near you",
                  )}
                </span>
                <span className="home-reels-short" aria-hidden="true">
                  Reels
                </span>
              </Link>
            </div>
          </section>
        }
        search={
          <div className="discovery-search">
            <form
              key={filters.q}
              className="search-form"
              action={localizePath("/", locale)}
              method="get"
              role="search"
              aria-label={copy(locale, "Nächte durchsuchen", "Search nights")}
            >
              <Keep filters={filters} omit={["q"]} />
              <label className="search-input">
                <Icon name="search" />
                <span className="visually-hidden">
                  {copy(locale, "Suche", "Search")}
                </span>
                <input
                  type="search"
                  name="q"
                  defaultValue={filters.q}
                  placeholder={copy(
                    locale,
                    "Event, Club oder DJ",
                    "Event, venue or DJ",
                  )}
                  enterKeyHint="search"
                />
              </label>
              <button className="search-submit" type="submit">
                {copy(locale, "Suchen", "Search")}
              </button>
            </form>
          </div>
        }
        filters={
          <section
            className="filter-panel"
            aria-label={copy(locale, "Filter", "Filters")}
          >
            <ScrollActiveChips state={homeHref(locale, filters)} />
            <ChipRow
              id="filter-when"
              label={copy(locale, "Wann", "When")}
              before={
                <Popover
                  key={filters.date || "any"}
                  className="date-pick"
                  summaryClassName={`chip date-chip${filters.date ? " is-active" : ""}`}
                  summary={
                    <>
                      <Icon name="calendar" />
                      <span className="date-chip-text">
                        {filters.date
                          ? dateText
                          : copy(locale, "Datum", "Date")}
                      </span>
                      <Icon name="chevron-down" className="chip-caret" />
                    </>
                  }
                >
                  <div className="date-pop">
                    {view.days.length > 0 && (
                      <ul className="date-days">
                        {view.days.map((day) => (
                          <li key={day.value}>
                            <Link
                              href={href({ date: day.value, when: null })}
                              scroll={false}
                              aria-current={
                                day.value === filters.date ? "true" : undefined
                              }
                            >
                              {day.label} <span>{day.count}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form
                      className="date-form"
                      action={localizePath("/", locale)}
                      method="get"
                    >
                      <Keep filters={filters} omit={["date", "when"]} />
                      <label>
                        <span>
                          {copy(locale, "Anderes Datum", "Other date")}
                        </span>
                        <input
                          type="date"
                          name="date"
                          required
                          min={today || undefined}
                          defaultValue={filters.date}
                        />
                      </label>
                      <button className="chip-button" type="submit">
                        {copy(locale, "Anzeigen", "Show")}
                      </button>
                    </form>
                  </div>
                </Popover>
              }
            >
              {view.when.map((facet) => {
                const on = !filters.date && filters.when === facet.value;
                return facet.count > 0 || on ? (
                  <Chip
                    key={facet.value}
                    label={facet.label}
                    count={facet.count}
                    active={on}
                    href={href({ when: on ? null : facet.value, date: "" })}
                  />
                ) : null;
              })}
            </ChipRow>
            {view.cities.length > 0 && (
              <ChipRow id="filter-city" label={copy(locale, "Wo", "Where")}>
                {view.cities.map((facet) => {
                  const on = facet.value === filters.city;
                  return (
                    <Chip
                      key={facet.value}
                      label={facet.label}
                      count={facet.count}
                      active={on}
                      href={href({ city: on ? "" : facet.value })}
                    />
                  );
                })}
              </ChipRow>
            )}
            {view.sounds.length > 0 && (
              <ChipRow id="filter-sound" label="Sound">
                {view.sounds.map((facet) => {
                  const on = facet.value === filters.sound;
                  return (
                    <Chip
                      key={facet.value}
                      label={facet.label}
                      count={facet.count}
                      active={on}
                      swatch={genreFamilyBySlug(facet.value)?.motif}
                      href={href({ sound: on ? null : facet.value, genre: "" })}
                    />
                  );
                })}
              </ChipRow>
            )}
            {view.genres.length > 1 && (
              <ChipRow id="filter-genre" label="Genre">
                {view.genres.map((facet) => {
                  const on = facet.value === filters.genre;
                  return (
                    <Chip
                      key={facet.value}
                      label={facet.label}
                      count={facet.count}
                      active={on}
                      href={href({ genre: on ? "" : facet.value })}
                    />
                  );
                })}
              </ChipRow>
            )}
          </section>
        }
        stageFilters={
          <ChipRow id="map-filter" label={copy(locale, "Filter", "Filters")}>
            {view.when.map((facet) => {
              const on = !filters.date && filters.when === facet.value;
              return facet.count > 0 || on ? (
                <Chip
                  key={facet.value}
                  label={facet.label}
                  count={facet.count}
                  active={on}
                  href={`${href({ when: on ? null : facet.value, date: "" })}#karte`}
                />
              ) : null;
            })}
            {view.sounds.map((facet) => {
              const on = facet.value === filters.sound;
              return (
                <Chip
                  key={facet.value}
                  label={facet.label}
                  count={facet.count}
                  active={on}
                  swatch={genreFamilyBySlug(facet.value)?.motif}
                  href={`${href({ sound: on ? null : facet.value, genre: "" })}#karte`}
                />
              );
            })}
          </ChipRow>
        }
        list={
          <section
            id="nights"
            className="listing-section"
            aria-labelledby="nights-title"
          >
            <h2 id="nights-title" className="visually-hidden">
              {copy(locale, "Programm", "Listings")}
            </h2>
            {ignored.length > 0 && (
              <p className="filter-error" role="alert">
                {copy(
                  locale,
                  `Diese Filter waren ungültig und werden ignoriert: ${ignored.map((key) => filterLabel(key, locale)).join(", ")}.`,
                  `These filters weren’t valid and are ignored: ${ignored.map((key) => filterLabel(key, locale)).join(", ")}.`,
                )}
              </p>
            )}
            {active.length > 0 && (
              <div className="active-filters">
                <span className="active-label" id="active-filters-label">
                  {copy(locale, "Aktive Filter", "Active filters")}
                </span>
                <ul aria-labelledby="active-filters-label">
                  {active.map((item) => (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        scroll={false}
                        aria-label={copy(
                          locale,
                          `Filter ${item.label} entfernen`,
                          `Remove filter ${item.label}`,
                        )}
                      >
                        {item.label} <Icon name="close" />
                      </Link>
                    </li>
                  ))}
                </ul>
                {active.length > 1 && (
                  <Link
                    className="active-clear"
                    href={localizePath("/", locale)}
                    scroll={false}
                  >
                    {copy(locale, "Alle löschen", "Clear all")}
                  </Link>
                )}
              </div>
            )}
            {shown.length ? (
              <>
                <EventDays
                  events={shown.map((listing) => listing.event)}
                  catalog={catalog}
                  locale={locale}
                  now={requestNow}
                />
                {cityPage && view.cityName && (
                  <p className="city-page-link">
                    <Link href={localizePath(cityPage, locale)}>
                      {copy(
                        locale,
                        `Alle Clubs und DJs in ${view.cityName}`,
                        `All venues and DJs in ${view.cityName}`,
                      )}
                    </Link>
                  </p>
                )}
                {nextRow && (
                  <div className="more-row">
                    <Link
                      className="button button-outline more-link"
                      href={`${href({ limit: shown.length + pageSize })}#e-${nextRow.event.slug}`}
                      scroll={false}
                    >
                      {copy(
                        locale,
                        "Weitere Nächte anzeigen",
                        "Show more nights",
                      )}{" "}
                      <span className="chip-count">
                        {restNights
                          ? copy(
                              locale,
                              `noch ${restNights} ${nightsWord(restNights, locale)}`,
                              `${restNights} more ${nightsWord(restNights, locale)}`,
                            )
                          : copy(
                              locale,
                              `noch ${rest.length} abgesagt`,
                              `${rest.length} more cancelled`,
                            )}
                      </span>
                    </Link>
                  </div>
                )}
              </>
            ) : past ? (
              <div className="empty-state">
                <h3>
                  {copy(
                    locale,
                    `${dateText} liegt in der Vergangenheit`,
                    `${dateText} is in the past`,
                  )}
                </h3>
                <p>
                  {copy(
                    locale,
                    "EVRYVIBE zeigt nur kommende Nächte.",
                    "EVRYVIBE only lists upcoming nights.",
                  )}
                </p>
                <Link
                  className="button button-outline"
                  href={href({ date: "" })}
                >
                  {copy(
                    locale,
                    "Kommende Nächte anzeigen",
                    "Show upcoming nights",
                  )}
                </Link>
              </div>
            ) : (
              <div className="empty-state">
                <h3>
                  {filtered
                    ? copy(
                        locale,
                        "Keine Nächte für diese Filter",
                        "No nights match these filters",
                      )
                    : copy(
                        locale,
                        "Keine kommenden Nächte",
                        "No upcoming nights",
                      )}
                </h3>
                <p>
                  {filtered
                    ? copy(
                        locale,
                        "Entferne einen Filter oder wähle ein anderes Datum, eine andere Stadt oder einen anderen Sound.",
                        "Remove a filter or try another date, city or sound.",
                      )
                    : copy(
                        locale,
                        "Es sind noch keine kommenden Events veröffentlicht.",
                        "No upcoming events have been published yet.",
                      )}
                </p>
                {filtered && (
                  <Link
                    className="button button-outline"
                    href={localizePath("/", locale)}
                  >
                    {copy(locale, "Alle Nächte anzeigen", "Show all nights")}
                  </Link>
                )}
              </div>
            )}
          </section>
        }
      />
    </main>
  );
}
