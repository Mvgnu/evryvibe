import Link from "next/link";
import type { Locale } from "@/core/i18n";
import { localizePath } from "@/core/i18n";
import type { Catalog, Dj, Event, Venue } from "@/core/model";
import { isScheduled } from "@/core/cities";
import { Artwork, copy, translatedEvent } from "@/components/catalog-ui";
import { addDays, dayLabel, localDate } from "@/components/discovery-filters";
import { Icon } from "@/components/icon";
import { lineupNames, posterFacts } from "@/components/poster-facts";

// "2 Nächte", "2 Nächte · 1 abgesagt" or "1 abgesagt": cancelled listings are
// shown but never counted as nights.
export function nightCount(events: Event[], locale: Locale): string {
  const nights = events.filter(isScheduled).length;
  const cancelled = events.length - nights;
  const parts = [
    ...(nights || !cancelled
      ? [
          `${nights} ${copy(
            locale,
            nights === 1 ? "Nacht" : "Nächte",
            nights === 1 ? "night" : "nights",
          )}`,
        ]
      : []),
    ...(cancelled
      ? [`${cancelled} ${copy(locale, "abgesagt", "cancelled")}`]
      : []),
  ];
  return parts.join(" · ");
}

type Lookup = {
  venues: Map<string, Venue>;
  djs: readonly Dj[];
  listenable: Set<string>;
};

function lookup(catalog: Catalog): Lookup {
  return {
    venues: new Map(catalog.venues.map((venue) => [venue.id, venue])),
    djs: catalog.djs,
    listenable: new Set(
      catalog.djs.filter((dj) => dj.soundcloudUrl).map((dj) => dj.id),
    ),
  };
}

// "23:00–08:00" for a night; a run past the next day names its last day
// ("22:00 – So. 22:00") so a weekend marathon is not read as two hours.
function timeRange(event: Event, timezone: string, locale: Locale): string {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const start = clock.format(new Date(event.startsAt));
  if (!event.endsAt) return start;
  const end = clock.format(new Date(event.endsAt));
  const endDay = localDate(event.endsAt, timezone);
  const hours =
    (Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 3_600_000;
  if (hours < 24 && endDay <= addDays(localDate(event.startsAt, timezone), 1))
    return `${start}–${end}`;
  const weekday = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", {
    timeZone: timezone,
    weekday: "short",
  }).format(new Date(event.endsAt));
  return `${start} – ${weekday} ${end}`;
}

// One listing: one link (the title, stretched over the row), no button
// cluster. Date and time are formatted in the venue's timezone.
function EventRow({
  event: original,
  venue,
  lookup: { djs, listenable },
  locale,
  heading: Heading,
  withDate,
}: {
  event: Event;
  venue: Venue;
  lookup: Lookup;
  locale: Locale;
  heading: "h3" | "h4";
  withDate: boolean;
}) {
  const event = translatedEvent(original, locale);
  const names = lineupNames(event, djs);
  const shown = names.slice(0, 4);
  const cancelled = event.status === "cancelled";
  const listen = event.djIds.some((id) => listenable.has(id));
  return (
    <article
      className={`ev-row${cancelled ? " is-cancelled" : ""}`}
      id={`e-${event.slug}`}
    >
      <div className="ev-row-art" aria-hidden="true">
        <Artwork
          event={event}
          poster={posterFacts(event, venue, names, locale)}
          locale={locale}
        />
      </div>
      <p className="ev-row-when">
        {cancelled && (
          <strong className="cancelled">
            {copy(locale, "Abgesagt", "Cancelled")}
          </strong>
        )}
        <time dateTime={event.startsAt}>
          {withDate && (
            <span className="ev-row-date">
              {dayLabel(localDate(event.startsAt, venue.timezone), locale)}
            </span>
          )}
          <span className="ev-row-time">
            {timeRange(event, venue.timezone, locale)}
          </span>
        </time>
      </p>
      <Heading className="ev-row-title">
        <Link href={localizePath(`/events/${event.slug}`, locale)}>
          {event.title}
        </Link>
      </Heading>
      {shown.length > 0 && (
        <p className="ev-row-lineup">
          {shown.join(", ")}
          {names.length > shown.length && (
            <span> +{names.length - shown.length}</span>
          )}
        </p>
      )}
      <p className="ev-row-place">
        {venue.name}
        <span className="ev-row-city">{venue.city}</span>
      </p>
      {(event.genres.length > 0 || listen) && (
        <p className="ev-row-tags">
          {event.genres.length > 0 && (
            <span className="ev-row-sound">
              {event.genres.slice(0, 2).join(" · ")}
            </span>
          )}
          {listen && (
            <span className="ev-row-listen">
              <Icon name="wave" />
              <span aria-hidden="true">SoundCloud</span>
              <span className="visually-hidden">
                {copy(
                  locale,
                  "Line-up auf SoundCloud anhörbar",
                  "Lineup can be heard on SoundCloud",
                )}
              </span>
            </span>
          )}
        </p>
      )}
    </article>
  );
}

// A flat list for venue and DJ pages: each row carries its own date.
export function EventList({
  events,
  catalog,
  locale = "de",
}: {
  events: Event[];
  catalog: Catalog;
  locale?: Locale;
}) {
  const data = lookup(catalog);
  return (
    <div className="ev-rows">
      {events.map((event) => {
        const venue = data.venues.get(event.venueId);
        return venue ? (
          <EventRow
            key={event.id}
            event={event}
            venue={venue}
            lookup={data}
            locale={locale}
            heading="h3"
            withDate
          />
        ) : null;
      })}
    </div>
  );
}

type Day = { key: string; date: string; timezone: string; events: Event[] };

// Groups events by the calendar date at their own venue. Events whose venue is
// unknown are left out, as a row cannot place them either.
export function EventDays({
  events,
  catalog,
  locale = "de",
  now,
}: {
  events: Event[];
  catalog: Catalog;
  locale?: Locale;
  now: number;
}) {
  const data = lookup(catalog);
  const days = new Map<string, Day>();
  const nowIso = new Date(now).toISOString();
  for (const event of [...events].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  )) {
    const venue = data.venues.get(event.venueId);
    if (!venue) continue;
    const date = localDate(event.startsAt, venue.timezone);
    const key = `${date}:${venue.timezone}:${date < localDate(nowIso, venue.timezone) ? Boolean(event.endsAt) : "day"}`;
    const day = days.get(key);
    if (day) day.events.push(event);
    else
      days.set(key, { key, date, timezone: venue.timezone, events: [event] });
  }
  return (
    <div className="event-days">
      {[...days.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((day) => {
          const today = localDate(nowIso, day.timezone);
          const relative =
            day.date < today
              ? day.events.every((event) => Boolean(event.endsAt))
                ? copy(locale, "Läuft noch", "Still on")
                : copy(locale, "Beginn gestern", "Started yesterday")
              : day.date === today
                ? copy(locale, "Heute", "Today")
                : day.date === addDays(today, 1)
                  ? copy(locale, "Morgen", "Tomorrow")
                  : null;
          const dateText = dayLabel(day.date, locale);
          const tag = locale === "en" ? "en-GB" : "de-DE";
          const noon = new Date(`${day.date}T12:00:00Z`);
          const weekday = new Intl.DateTimeFormat(tag, {
            timeZone: "UTC",
            weekday: "long",
          }).format(noon);
          const shortDate = new Intl.DateTimeFormat(tag, {
            timeZone: "UTC",
            day: "numeric",
            month: "short",
          }).format(noon);
          return (
            <section
              key={day.key}
              className="event-day"
              aria-label={relative ? `${relative}, ${dateText}` : dateText}
            >
              <header className="event-day-heading">
                <h3>
                  <span className="event-day-name">{relative ?? weekday}</span>
                  <time dateTime={day.date}>
                    {relative ? dateText : shortDate}
                  </time>
                </h3>
                <span className="event-day-count">
                  {nightCount(day.events, locale)}
                </span>
              </header>
              <div className="ev-rows">
                {day.events.map((event) => {
                  const venue = data.venues.get(event.venueId);
                  return venue ? (
                    <EventRow
                      key={event.id}
                      event={event}
                      venue={venue}
                      lookup={data}
                      locale={locale}
                      heading="h4"
                      withDate={false}
                    />
                  ) : null;
                })}
              </div>
            </section>
          );
        })}
    </div>
  );
}
