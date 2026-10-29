import { Icon } from "@/components/icon";
import { eventStructuredData, serializeJsonLd } from "@/core/structured-data";
import { requestLocale } from "@/lib/locale";
import { localizePath } from "@/core/i18n";
import type { Metadata } from "next";
import { pageMetadata } from "@/core/site";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalog } from "@/db/catalog";
import {
  Artwork,
  copy,
  DemoNotice,
  ExternalLink,
  translatedEvent,
} from "@/components/catalog-ui";
import { posterFacts } from "@/components/poster-facts";
import { cityPath, isUpcoming } from "@/core/cities";
import type { Locale } from "@/core/i18n";
import type { Event } from "@/core/model";
import { ShareButton } from "@/components/share-button";
import { InstagramEmbed } from "@/components/instagram-embed";
import { GenreLinks } from "@/components/genre-links";
import { genrePath, listedGenreSlugs } from "@/components/dj-directory-view";
import { compound } from "@/components/german-compound";
import { requestTime } from "@/components/request-time";
import { directoryEntries } from "@/core/dj-directory";
import { canonicalGenresOf } from "@/core/genres";
import {
  ListenButton,
  ListenGroup,
  ListenPanel,
} from "@/components/soundcloud";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
// Shared by metadata and structured data so both describe the page alike.
const pageDescription = (event: Event, locale: Locale) =>
  event.description ||
  copy(
    locale,
    `Details, Ort und Line-up für ${event.title}.`,
    `Details, venue and lineup for ${event.title}.`,
  );
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await requestLocale();
  const [{ slug }, catalog] = await Promise.all([params, getCatalog()]);
  const originalEvent = catalog.events.find((e) => e.slug === slug);
  if (!originalEvent) notFound();
  const event = translatedEvent(originalEvent, locale);
  const venue = catalog.venues.find((v) => v.id === event.venueId);
  if (!venue) notFound();
  const date = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", {
    timeZone: venue.timezone,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(event.startsAt));
  return {
    ...pageMetadata(
      `${event.title} – ${date} · ${venue.name}, ${venue.city}`,
      pageDescription(event, locale),
      `/events/${event.slug}`,
      locale,
    ),
    ...(!isUpcoming(event, requestTime(), venue.timezone) ||
    catalog.mode === "demo"
      ? { robots: { index: false, follow: true } }
      : {}),
  };
}
export default async function EventPage({ params }: Props) {
  const locale = await requestLocale();
  const [{ slug }, catalog] = await Promise.all([params, getCatalog()]);
  const originalEvent = catalog.events.find((e) => e.slug === slug);
  if (!originalEvent) notFound();
  const event = translatedEvent(originalEvent, locale);
  const venue = catalog.venues.find((v) => v.id === event.venueId);
  if (!venue) notFound();
  const storySource =
    event.sourceUrl !== null &&
    new URL(event.sourceUrl).pathname.startsWith("/stories/");
  const artists = new Map(catalog.djs.map((dj) => [dj.id, dj]));
  const lineup = event.djIds
    .map((id) => artists.get(id))
    .filter((dj) => dj !== undefined);
  const unlinkedArtists = event.unlinkedArtists ?? [];
  const totalLineup = lineup.length + unlinkedArtists.length;
  const poster = posterFacts(
    event,
    venue,
    [...lineup.map((dj) => dj.name), ...unlinkedArtists],
    locale,
  );
  const when = eventWhen(event, venue.timezone, locale);
  const cityHref = cityPath(venue.city);
  const cancelled = event.status === "cancelled";
  const demo = catalog.mode === "demo";
  // Genre links lead only to genre pages that list DJs or nights.
  const now = requestTime();
  const listed = listedGenreSlugs(directoryEntries(catalog, now), catalog, now);
  const sound = canonicalGenresOf(event.genres).find((genre) =>
    listed.has(genre.slug),
  );
  const address =
    ` ${venue.address.toLocaleLowerCase().replace(/[,\s]+/g, " ")} `.includes(
      ` ${venue.city.toLocaleLowerCase()} `,
    )
      ? venue.address
      : `${venue.address}, ${venue.city}`;
  return (
    <main id="main">
      {!demo && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(
              eventStructuredData(
                event,
                venue,
                lineup,
                locale,
                undefined,
                pageDescription(event, locale),
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
        <article className="ev-page">
          <header className="ev-head">
            <p className="ev-eyebrow">
              {cityHref ? (
                <Link href={localizePath(cityHref, locale)}>{venue.city}</Link>
              ) : (
                <span>{venue.city}</span>
              )}
              {event.genres.length > 0 && (
                <span>
                  <GenreLinks
                    genres={event.genres}
                    locale={locale}
                    listed={listed}
                  />
                </span>
              )}
            </p>
            {cancelled && (
              <p className="cancelled cancellation-banner">
                {copy(
                  locale,
                  "Abgesagt: Dieses Event findet nicht statt.",
                  "Cancelled: this event will not take place.",
                )}
              </p>
            )}
            <p className="ev-when">
              <time dateTime={event.startsAt}>
                <span className="ev-date">{when.date}</span>
                <span className="ev-time">{when.time}</span>
              </time>
              <small>
                {copy(locale, "Ortszeit", "Local time")}
                {when.zone && ` · ${when.zone}`}
              </small>
            </p>
            <h1 className="ev-title">{event.title}</h1>
          </header>

          <div className="ev-facts">
            <div className="detail-venue">
              <Link href={localizePath(`/venues/${venue.slug}`, locale)}>
                {venue.name}
              </Link>
              <p>{address}</p>
            </div>
            <div className="ev-actions">
              {!cancelled &&
                (event.ticketUrl ? (
                  <ExternalLink
                    className="button ticket-button"
                    href={event.ticketUrl}
                  >
                    Tickets
                  </ExternalLink>
                ) : (
                  <p className="ev-no-ticket">
                    {copy(
                      locale,
                      "Noch kein Ticketlink bekannt.",
                      "No ticket link known yet.",
                    )}
                  </p>
                ))}
              <div className="ev-secondary">
                <ExternalLink className="chip-button" href={event.websiteUrl}>
                  Website
                </ExternalLink>
                {!demo && event.sourceUrl && !storySource && (
                  <ExternalLink
                    className="chip-button"
                    href={event.sourceUrl}
                    label={copy(
                      locale,
                      "Quelle: Originalankündigung auf Instagram (neuer Tab)",
                      "Source: original announcement on Instagram (new tab)",
                    )}
                  >
                    {copy(locale, "Quelle", "Source")}
                  </ExternalLink>
                )}
                {!demo && storySource && (
                  <ExternalLink
                    className="chip-button"
                    href={event.sourceAccountUrl ?? null}
                    label={copy(
                      locale,
                      "Instagram-Profil der Quelle (neuer Tab)",
                      "Source Instagram profile (new tab)",
                    )}
                  >
                    {copy(locale, "Quellprofil", "Source profile")}
                  </ExternalLink>
                )}
                <ShareButton
                  title={event.title}
                  locale={locale}
                  className="chip-button"
                />
              </div>
              {event.ticketUrl && !cancelled && (
                <p className="external-note">
                  {copy(
                    locale,
                    "Tickets öffnen sich auf der Website des Veranstalters.",
                    "Tickets open on the organiser’s website.",
                  )}
                </p>
              )}
            </div>
          </div>

          <section className="ev-lineup" aria-labelledby="lineup-heading">
            <div className="ev-label-row">
              <h2 id="lineup-heading">Line-up</h2>
              {totalLineup > 0 && (
                <span>
                  {totalLineup} {totalLineup === 1 ? "DJ" : "DJs"}
                </span>
              )}
            </div>
            {totalLineup ? (
              <ListenGroup>
                <ol className="ev-lineup-list">
                  {lineup.map((dj, index) => (
                    <li className="ev-lineup-row" key={dj.id}>
                      <span className="ev-lineup-number" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Link
                        className="ev-lineup-artist"
                        href={localizePath(`/djs/${dj.slug}`, locale)}
                      >
                        <strong>{dj.name}</strong>
                        {dj.genres.length > 0 && (
                          <small>{dj.genres.join(" / ")}</small>
                        )}
                      </Link>
                      {(dj.soundcloudUrl || dj.instagramUrl) && (
                        <div className="ev-lineup-actions">
                          {dj.soundcloudUrl && (
                            <ListenButton
                              id={dj.slug}
                              url={dj.soundcloudUrl}
                              name={dj.name}
                              locale={locale}
                            />
                          )}
                          {dj.instagramUrl && (
                            <a
                              className="ev-lineup-instagram"
                              href={dj.instagramUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={copy(
                                locale,
                                `${dj.name} auf Instagram (neuer Tab)`,
                                `${dj.name} on Instagram (new tab)`,
                              )}
                            >
                              Instagram <Icon name="arrow-up-right" />
                            </a>
                          )}
                        </div>
                      )}
                      {dj.soundcloudUrl && (
                        <ListenPanel
                          id={dj.slug}
                          url={dj.soundcloudUrl}
                          name={dj.name}
                          locale={locale}
                        />
                      )}
                    </li>
                  ))}
                  {unlinkedArtists.map((name) => (
                    <li key={name} className="ev-lineup-item">
                      <strong>{name}</strong>
                    </li>
                  ))}
                </ol>
              </ListenGroup>
            ) : (
              <p className="ev-quiet">
                {copy(
                  locale,
                  "Noch kein Line-up bekannt.",
                  "Lineup not listed.",
                )}
              </p>
            )}
            {sound && (
              <p className="city-page-link">
                <Link href={localizePath(genrePath(sound), locale)}>
                  {copy(
                    locale,
                    `Mehr ${compound(sound.name, "DJs", "de")}`,
                    `More ${compound(sound.name, "DJs", "en")}`,
                  )}
                </Link>
              </p>
            )}
          </section>

          <div className="ev-poster">
            <Artwork
              event={event}
              poster={poster}
              hero
              className="detail-art"
              locale={locale}
            />
          </div>

          <div className="ev-more">
            <section className="ev-about" aria-labelledby="about-heading">
              <h2 id="about-heading">
                {copy(locale, "Über die Nacht", "About the night")}
              </h2>
              <p className="description">
                {event.description ||
                  copy(
                    locale,
                    "Keine weitere Beschreibung verfügbar.",
                    "No additional description available.",
                  )}
              </p>
              <p className="ev-source">
                {demo
                  ? copy(
                      locale,
                      "Fiktive Vorschau – keine echte Ankündigung oder Tickets.",
                      "Fictional preview — no live announcement or tickets.",
                    )
                  : !event.sourceUrl
                    ? copy(
                        locale,
                        "Vom Artist eingetragen",
                        "Added by the artist",
                      )
                    : `${
                        storySource
                          ? copy(
                              locale,
                              "Quelle: Instagram-Story (nicht mehr einbettbar). ",
                              "Source: Instagram story (no longer embeddable). ",
                            )
                          : ""
                      }${copy(locale, "Quelle erfasst am", "Source observed")} ${new Intl.DateTimeFormat(
                        locale === "en" ? "en-GB" : "de-DE",
                        { dateStyle: "medium", timeZone: "UTC" },
                      ).format(new Date(event.observedAt))}`}
              </p>
            </section>
            {!demo && event.sourceUrl && !storySource && (
              <section className="sample-section">
                <h2>{copy(locale, "Originalbeitrag", "Original post")}</h2>
                <InstagramEmbed
                  url={event.sourceUrl}
                  title={`${event.title} ${copy(locale, "auf Instagram", "on Instagram")}`}
                  locale={locale}
                />
              </section>
            )}
          </div>
        </article>
      </div>
    </main>
  );
}

// Server-formatted date block in the venue timezone.
function eventWhen(
  event: Pick<Event, "startsAt" | "endsAt">,
  timezone: string,
  locale: Locale,
) {
  const tag = locale === "en" ? "en-GB" : "de-DE";
  const start = new Date(event.startsAt);
  const date = new Intl.DateTimeFormat(tag, {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(start);
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  let time = clock.format(start);
  if (event.endsAt) {
    const end = new Date(event.endsAt);
    const endDay =
      day.format(end) === day.format(start)
        ? ""
        : `${new Intl.DateTimeFormat(tag, { timeZone: timezone, weekday: "short" }).format(end)} `;
    time = `${time} – ${endDay}${clock.format(end)}`;
  }
  const zone =
    new Intl.DateTimeFormat(tag, { timeZone: timezone, timeZoneName: "short" })
      .formatToParts(start)
      .find((part) => part.type === "timeZoneName")?.value ?? null;
  return { date, time, zone };
}
