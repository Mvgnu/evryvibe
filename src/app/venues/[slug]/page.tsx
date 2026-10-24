import { InstagramProfile } from "@/components/instagram-profile";
import { Icon } from "@/components/icon";
import { venueStructuredData, serializeJsonLd } from "@/core/structured-data";
import { requestLocale } from "@/lib/locale";
import { localizePath } from "@/core/i18n";
import type { Metadata } from "next";
import { pageMetadata } from "@/core/site";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalog } from "@/db/catalog";
import { EventList, nightCount } from "@/components/event-days";
import { copy, DemoNotice, ExternalLink } from "@/components/catalog-ui";
import { SoundTile } from "@/components/poster";
import { venuePosterFacts } from "@/components/poster-facts";
import { SoundcloudPlayer } from "@/components/soundcloud";
import { isSoundcloudUrl } from "@/core/soundcloud";
import { requestTime } from "@/components/request-time";
import { cityPath, isUpcoming } from "@/core/cities";
import { publicBioFor } from "@/core/reconciliation";
import type { Locale } from "@/core/i18n";
import type { Venue } from "@/core/model";
import { countryName } from "../../cities/city-data";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
// Shared by metadata and structured data so both describe the page alike.
const pageDescription = (venue: Venue, locale: Locale) =>
  publicBioFor(venue, locale) ||
  copy(
    locale,
    `Events und Informationen zu ${venue.name} in ${venue.city}.`,
    `Events and information about ${venue.name} in ${venue.city}.`,
  );
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await requestLocale();
  const [{ slug }, catalog] = await Promise.all([params, getCatalog()]);
  const venue = catalog.venues.find((v) => v.slug === slug);
  if (!venue) notFound();
  return pageMetadata(
    venue.name,
    pageDescription(venue, locale),
    `/venues/${venue.slug}`,
    locale,
  );
}
export default async function VenuePage({ params }: Props) {
  const locale = await requestLocale();
  const [{ slug }, catalog] = await Promise.all([params, getCatalog()]);
  const venue = catalog.venues.find((v) => v.slug === slug);
  if (!venue) notFound();
  const requestNow = requestTime();
  const events = catalog.events
    .filter(
      (e) =>
        e.venueId === venue.id &&
        catalog.venues.some(
          (venue) =>
            venue.id === e.venueId && isUpcoming(e, requestNow, venue.timezone),
        ),
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const bio = publicBioFor(venue, locale);
  const cityHref = cityPath(venue.city);
  const facts = venuePosterFacts(venue, events, locale);
  const demo = catalog.mode === "demo";
  // A "website" that is just a SoundCloud page repeats the SoundCloud chip.
  const website =
    venue.soundcloudUrl && venue.websiteUrl && isSoundcloudUrl(venue.websiteUrl)
      ? null
      : venue.websiteUrl;
  return (
    <main id="main">
      {!demo && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(
              venueStructuredData(
                venue,
                locale,
                events,
                pageDescription(venue, locale),
              ),
            ),
          }}
        />
      )}
      <DemoNotice mode={catalog.mode} locale={locale} />
      <div className="detail-shell">
        <Link className="back-link" href={localizePath("/", locale)}>
          <Icon name="arrow-left" /> {copy(locale, "Alle Nächte", "All nights")}
        </Link>
        <header className="pf-head">
          <SoundTile family={facts.family} seed={facts.seed} />
          <p className="pf-eyebrow">
            <span>Club</span>
            <span>
              {cityHref ? (
                <Link href={localizePath(cityHref, locale)}>{venue.city}</Link>
              ) : (
                venue.city
              )}
              , {countryName(venue.country, locale)}
            </span>
          </p>
          <h1 className="pf-title">{venue.name}</h1>
          <p className="pf-address">{venue.address}</p>
          {(venue.instagramUrl || venue.soundcloudUrl || website) && (
            <div className="pf-links">
              <ExternalLink className="chip-button" href={venue.instagramUrl}>
                Instagram
              </ExternalLink>
              <ExternalLink className="chip-button" href={venue.soundcloudUrl}>
                SoundCloud
              </ExternalLink>
              <ExternalLink className="chip-button" href={website}>
                Website
              </ExternalLink>
            </div>
          )}
        </header>
        <div
          className={`pf-body pf-body-venue${venue.soundcloudUrl || bio ? "" : " pf-body-single"}`}
        >
          <section
            className="pf-section pf-dates"
            aria-labelledby="dates-title"
          >
            <div className="pf-label-row">
              <h2 id="dates-title" className="pf-label">
                {copy(locale, "Kommende Nächte", "Upcoming nights")}
              </h2>
              <span>{nightCount(events, locale)}</span>
            </div>
            {events.length ? (
              <EventList events={events} catalog={catalog} locale={locale} />
            ) : (
              <p className="quiet-empty">
                {copy(
                  locale,
                  "Hier sind noch keine kommenden Nächte angekündigt.",
                  "No upcoming nights have been announced here yet.",
                )}
              </p>
            )}
          </section>
          {(venue.soundcloudUrl || bio) && (
            <div className="pf-primary">
              {bio && (
                <section className="pf-section" aria-labelledby="about-title">
                  <h2 id="about-title" className="pf-label">
                    {copy(locale, "Über", "About")} {venue.name}
                  </h2>
                  <p className="description">{bio}</p>
                </section>
              )}
              {venue.soundcloudUrl && (
                <section className="pf-section" aria-labelledby="listen-title">
                  <h2 id="listen-title" className="pf-label">
                    {copy(locale, "Anhören", "Listen")}
                  </h2>
                  <SoundcloudPlayer
                    url={venue.soundcloudUrl}
                    name={venue.name}
                    locale={locale}
                  />
                </section>
              )}
            </div>
          )}
        </div>
        {!demo && venue.instagramUrl && (
          <section className="pf-section pf-social" aria-labelledby="ig-title">
            <h2 id="ig-title" className="pf-label">
              Instagram
            </h2>
            <div className="pf-social-grid">
              <InstagramProfile
                url={venue.instagramUrl}
                name={venue.name}
                locale={locale}
              />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
