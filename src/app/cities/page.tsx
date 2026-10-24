import type { Metadata } from "next";
import Link from "next/link";
import { copy, DemoNotice } from "@/components/catalog-ui";
import { requestTime } from "@/components/request-time";
import { cityNights, catalogCities, type City } from "@/core/cities";
import { localizePath, type Locale } from "@/core/i18n";
import type { Catalog } from "@/core/model";
import { pageMetadata } from "@/core/site";
import { citiesStructuredData, serializeJsonLd } from "@/core/structured-data";
import { getCatalog } from "@/db/catalog";
import { requestLocale } from "@/lib/locale";
import { countryName } from "./city-data";

export const dynamic = "force-dynamic";

type CityRow = { city: City; nights: number; venues: number };

function cityRows(catalog: Catalog, now: number): CityRow[] {
  return catalogCities(catalog.venues)
    .map((city) => ({
      city,
      nights: cityNights(catalog, city, now).length,
      venues: city.venueIds.length,
    }))
    .sort(
      (a, b) =>
        b.nights - a.nights || a.city.name.localeCompare(b.city.name, "de"),
    );
}

function citiesDescription(rows: CityRow[], locale: Locale) {
  if (!rows.length)
    return copy(
      locale,
      "Städte auf EVRYVIBE. Noch sind keine Clubs veröffentlicht.",
      "Cities on EVRYVIBE. No venues have been published yet.",
    );
  const names = new Intl.ListFormat(locale === "en" ? "en-GB" : "de-DE", {
    type: "conjunction",
  }).format(rows.map(({ city }) => city.name));
  const nights = rows.reduce((sum, row) => sum + row.nights, 0);
  return copy(
    locale,
    `Techno-Partys in ${rows.length === 1 ? "einer Stadt" : `${rows.length} Städten`}: ${names}. ${nights} ${nights === 1 ? "kommende Nacht" : "kommende Nächte"} mit Clubs und DJs je Stadt.`,
    `Techno parties in ${rows.length === 1 ? "one city" : `${rows.length} cities`}: ${names}. ${nights} upcoming ${nights === 1 ? "night" : "nights"} with venues and DJs per city.`,
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const catalog = await getCatalog();
  const rows = cityRows(catalog, Date.now());
  const metadata = pageMetadata(
    copy(locale, "Techno-Partys nach Stadt", "Techno parties by city"),
    citiesDescription(rows, locale),
    "/cities",
    locale,
  );
  // Same rule as the sitemap: without upcoming nights the index stays out.
  return rows.some((row) => row.nights > 0)
    ? metadata
    : { ...metadata, robots: { index: false, follow: true } };
}

const count = (value: number) => String(value).padStart(2, "0");

export default async function CitiesPage() {
  const locale = await requestLocale();
  const catalog = await getCatalog();
  const requestNow = requestTime();
  const rows = cityRows(catalog, requestNow);
  const description = citiesDescription(rows, locale);
  return (
    <main id="main" className="city-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            citiesStructuredData(
              rows.map(({ city }) => city),
              locale,
              description,
            ),
          ),
        }}
      />
      <DemoNotice mode={catalog.mode} locale={locale} />
      <div className="city-shell">
        <section
          className="city-hero city-index-hero"
          aria-labelledby="cities-title"
        >
          <p className="city-kicker">{copy(locale, "Städte", "Cities")}</p>
          <h1 id="cities-title">
            {copy(locale, "Techno-Partys nach Stadt", "Techno parties by city")}
          </h1>
          <dl className="city-stats">
            <div>
              <dt>{copy(locale, "Städte", "Cities")}</dt>
              <dd>{count(rows.length)}</dd>
            </div>
            <div>
              <dt>{copy(locale, "Kommende Nächte", "Upcoming nights")}</dt>
              <dd>{count(rows.reduce((sum, row) => sum + row.nights, 0))}</dd>
            </div>
            <div>
              <dt>{copy(locale, "Clubs", "Venues")}</dt>
              <dd>{count(rows.reduce((sum, row) => sum + row.venues, 0))}</dd>
            </div>
          </dl>
        </section>
        {rows.length ? (
          <ol className="city-index">
            {rows.map(({ city, nights, venues }) => (
              <li key={city.slug} data-empty={nights ? undefined : "true"}>
                <Link href={localizePath(`/cities/${city.slug}`, locale)}>
                  <strong>{city.name}</strong>
                  <span className="city-index-country">
                    {countryName(city.country, locale)}
                  </span>
                  <span className="city-index-counts">
                    <span>
                      {count(nights)}{" "}
                      {copy(
                        locale,
                        nights === 1 ? "Nacht" : "Nächte",
                        nights === 1 ? "night" : "nights",
                      )}
                    </span>
                    <span>
                      {count(venues)}{" "}
                      {copy(
                        locale,
                        venues === 1 ? "Club" : "Clubs",
                        venues === 1 ? "venue" : "venues",
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty-state city-empty">
            <h3>{copy(locale, "Noch keine Städte", "No cities yet")}</h3>
            <p>
              {copy(
                locale,
                "Sobald Clubs veröffentlicht sind, erscheinen ihre Städte hier.",
                "Cities appear here once venues have been published.",
              )}
            </p>
            <Link
              className="button button-outline"
              href={localizePath("/", locale)}
            >
              {copy(locale, "Zur Startseite", "Go to the home page")}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
