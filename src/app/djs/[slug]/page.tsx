import { InstagramProfile } from "@/components/instagram-profile";
import { Icon } from "@/components/icon";
import { djStructuredData, serializeJsonLd } from "@/core/structured-data";
import { requestLocale } from "@/lib/locale";
import { localizePath } from "@/core/i18n";
import type { Metadata } from "next";
import { pageMetadata } from "@/core/site";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { djRedirect, getCatalog } from "@/db/catalog";
import { database } from "@/db/client";
import { getArtistProfile } from "@/db/claims";
import { claimWebhookConfigured } from "@/lib/instagram-claim-config";
import { PastEvents } from "@/components/past-events";
import { EventList, nightCount } from "@/components/event-days";
import { copy, DemoNotice, ExternalLink } from "@/components/catalog-ui";
import { InstagramEmbed } from "@/components/instagram-embed";
import { SoundTile } from "@/components/poster";
import { djPosterFacts } from "@/components/poster-facts";
import { SoundcloudPlayer } from "@/components/soundcloud";
import { isSoundcloudUrl } from "@/core/soundcloud";
import { requestTime } from "@/components/request-time";
import { isUpcoming } from "@/core/cities";
import { publicBioFor } from "@/core/reconciliation";
import type { Locale } from "@/core/i18n";
import type { Dj } from "@/core/model";
import { directoryEntries } from "@/core/dj-directory";
import { genrePath, listedGenreSlugs } from "@/components/dj-directory-view";
import { compound } from "@/components/german-compound";
import { GenreLinks } from "@/components/genre-links";
import "../../directory.css";
import "../../artist/artist.css";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
// Shared by metadata and structured data so both describe the page alike.
const pageDescription = (dj: Dj, locale: Locale, artistBio?: string) =>
  (artistBio === undefined ? publicBioFor(dj, locale) : artistBio) ||
  copy(
    locale,
    `DJ-Profil und Events mit ${dj.name}.`,
    `DJ profile and events featuring ${dj.name}.`,
  );
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await requestLocale();
  const [{ slug }, catalog] = await Promise.all([params, getCatalog()]);
  const dj = catalog.djs.find((d) => d.slug === slug);
  if (!dj) {
    const canonical = await djRedirect(slug);
    if (canonical) permanentRedirect(localizePath(`/djs/${canonical}`, locale));
    notFound();
  }
  const artist =
    catalog.mode === "database"
      ? await getArtistProfile(database(), dj.id)
      : null;
  return pageMetadata(
    dj.name,
    pageDescription(dj, locale, artist?.bio),
    `/djs/${dj.slug}`,
    locale,
  );
}
export default async function DjPage({ params }: Props) {
  const locale = await requestLocale();
  const [{ slug }, catalog] = await Promise.all([params, getCatalog()]);
  const dj = catalog.djs.find((d) => d.slug === slug);
  if (!dj) {
    const canonical = await djRedirect(slug);
    if (canonical) permanentRedirect(localizePath(`/djs/${canonical}`, locale));
    notFound();
  }
  const requestNow = requestTime();
  const events = catalog.events
    .filter(
      (e) =>
        e.djIds.includes(dj.id) &&
        catalog.venues.some(
          (venue) =>
            venue.id === e.venueId && isUpcoming(e, requestNow, venue.timezone),
        ),
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const pastEvents = catalog.events
    .filter(
      (e) =>
        e.djIds.includes(dj.id) &&
        catalog.venues.some(
          (venue) =>
            venue.id === e.venueId &&
            !isUpcoming(e, requestNow, venue.timezone),
        ),
    )
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const artist =
    catalog.mode === "database"
      ? await getArtistProfile(database(), dj.id)
      : null;
  const bio = artist ? artist.bio : publicBioFor(dj, locale);
  const facts = djPosterFacts(dj, events, locale);
  const demo = catalog.mode === "demo";
  // A "website" that is just a SoundCloud page repeats the SoundCloud chip.
  const website =
    dj.soundcloudUrl && dj.websiteUrl && isSoundcloudUrl(dj.websiteUrl)
      ? null
      : dj.websiteUrl;
  const instagram = !demo && (dj.instagramUrl || dj.samplePostUrl);
  // The directory's genres for this DJ: the profile's, else those of their
  // nights. They lead to the genre pages with more DJs of that sound.
  const related =
    directoryEntries(
      {
        djs: [dj],
        venues: catalog.venues,
        events: catalog.events.filter((event) => event.djIds.includes(dj.id)),
      },
      requestNow,
    )[0]?.genres.slice(0, 2) ?? [];
  return (
    <main id="main">
      {!demo && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(
              djStructuredData(
                dj,
                locale,
                events,
                pageDescription(dj, locale, artist?.bio),
              ),
            ),
          }}
        />
      )}
      <DemoNotice mode={catalog.mode} locale={locale} />
      <div className="detail-shell">
        <Link className="back-link" href={localizePath("/djs", locale)}>
          <Icon name="arrow-left" /> {copy(locale, "Alle DJs", "All DJs")}
        </Link>
        <header className="pf-head">
          <SoundTile family={facts.family} seed={facts.seed} />
          <p className="pf-eyebrow">
            <span>DJ</span>
            {dj.genres.length > 0 && (
              <span>
                <GenreLinks
                  genres={dj.genres}
                  locale={locale}
                  listed={listedGenreSlugs(
                    directoryEntries(catalog, requestNow),
                    catalog,
                    requestNow,
                  )}
                />
              </span>
            )}
          </p>
          <h1 className="pf-title">{dj.name}</h1>
          {(dj.instagramUrl || dj.soundcloudUrl || website) && (
            <div className="pf-links">
              <ExternalLink className="chip-button" href={dj.instagramUrl}>
                Instagram
              </ExternalLink>
              <ExternalLink className="chip-button" href={dj.soundcloudUrl}>
                SoundCloud
              </ExternalLink>
              <ExternalLink className="chip-button" href={website}>
                Website
              </ExternalLink>
            </div>
          )}
          {catalog.mode === "database" && claimWebhookConfigured() && (
            <details className="artist-claim">
              <summary>
                {copy(locale, "Ist das dein Profil?", "Is this your profile?")}
              </summary>
              <p>
                {copy(
                  locale,
                  "Folge @evryvibe auf Instagram und sende uns CLAIM per DM. Wenn dein Instagram-Konto zu diesem Profil passt, schicken wir dir einen einmaligen Link.",
                  "Follow @evryvibe on Instagram and send us CLAIM by DM. If your Instagram account matches this profile, we will send you a one-time link.",
                )}
              </p>
              <a
                className="chip-button"
                href="https://www.instagram.com/evryvibe/"
                target="_blank"
                rel="noopener noreferrer"
              >
                {copy(locale, "Profil beanspruchen", "Claim profile")} ↗
              </a>
            </details>
          )}
        </header>
        <div
          className={`pf-body${dj.soundcloudUrl || bio ? "" : " pf-body-single"}`}
        >
          {(dj.soundcloudUrl || bio) && (
            <div className="pf-primary">
              {dj.soundcloudUrl && (
                <section className="pf-section" aria-labelledby="listen-title">
                  <h2 id="listen-title" className="pf-label">
                    {copy(locale, "Anhören", "Listen")}
                  </h2>
                  <SoundcloudPlayer
                    url={dj.soundcloudUrl}
                    name={dj.name}
                    locale={locale}
                  />
                </section>
              )}
              {bio && (
                <section className="pf-section" aria-labelledby="about-title">
                  <h2 id="about-title" className="pf-label">
                    {copy(locale, "Über", "About")} {dj.name}
                  </h2>
                  <p className="description">{bio}</p>
                </section>
              )}
            </div>
          )}
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
                  "Noch keine kommenden Termine angekündigt.",
                  "No upcoming dates have been announced yet.",
                )}
              </p>
            )}
          </section>
        </div>
        <PastEvents events={pastEvents} catalog={catalog} locale={locale} />
        {artist && artist.links.length > 0 && (
          <section
            className="pf-section artist-profile-links"
            aria-label={copy(locale, "Artist-Links", "Artist links")}
          >
            <h2 className="pf-label">{copy(locale, "Links", "Links")}</h2>
            <div className="pf-links">
              {artist.links.map((link, index) => (
                <a
                  className="chip-button"
                  key={`${link.url}-${index}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span aria-hidden="true">
                    {link.icon === "booking"
                      ? "✉"
                      : link.icon === "merch"
                        ? "◇"
                        : link.icon === "tickets"
                          ? "▣"
                          : "↗"}
                  </span>{" "}
                  {link.label}
                </a>
              ))}
            </div>
          </section>
        )}
        {related.length > 0 && (
          <nav className="pf-section pf-more" aria-labelledby="more-djs-title">
            <h2 id="more-djs-title" className="pf-label">
              {copy(locale, "Mehr DJs", "More DJs")}
            </h2>
            <div className="pf-links">
              {related.map((genre) => (
                <Link
                  key={genre.slug}
                  className="chip-button"
                  href={localizePath(genrePath(genre), locale)}
                >
                  {copy(
                    locale,
                    `Mehr ${compound(genre.name, "DJs", "de")}`,
                    `More ${compound(genre.name, "DJs", "en")}`,
                  )}
                </Link>
              ))}
            </div>
          </nav>
        )}
        {instagram && (
          <section className="pf-section pf-social" aria-labelledby="ig-title">
            <h2 id="ig-title" className="pf-label">
              Instagram
            </h2>
            <div className="pf-social-grid">
              {dj.instagramUrl && (
                <InstagramProfile
                  url={dj.instagramUrl}
                  name={dj.name}
                  locale={locale}
                />
              )}
              {dj.samplePostUrl && (
                <InstagramEmbed
                  url={dj.samplePostUrl}
                  title={`${dj.name} ${copy(locale, "auf Instagram", "on Instagram")}`}
                  locale={locale}
                />
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
