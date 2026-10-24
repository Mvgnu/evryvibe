import type { Dj, Event, Venue } from "./model";
import { localizedDescription, localizedTitle, type Locale } from "./i18n";
import { cityPath, type City } from "./cities";
import { normalizeGenres } from "./genres";
import { operator } from "./operator";
import { publicBioFor } from "./reconciliation";
import { absoluteUrl, siteUrl } from "./site";

const organizationId = `${siteUrl}/#organization`;
const websiteId = `${siteUrl}/#website`;
// Listing pages summarize at most this many upcoming events.
const listLimit = 50;

const organization = {
  "@type": "Organization",
  "@id": organizationId,
  name: "EVRYVIBE",
  url: `${siteUrl}/`,
  logo: `${siteUrl}/apple-icon.png`,
  email: operator.email.general,
};

const website = {
  "@type": "WebSite",
  "@id": websiteId,
  name: "EVRYVIBE",
  url: `${siteUrl}/`,
  inLanguage: ["de", "en"],
  publisher: { "@id": organizationId },
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${siteUrl}/?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

export type PageType =
  "WebPage" | "CollectionPage" | "ProfilePage" | "ContactPage";
export type Crumb = { name: string; path: string };

const homeCrumb = (locale: Locale): Crumb => ({
  name: locale === "en" ? "Home" : "Startseite",
  path: "/",
});
const citiesCrumb = (locale: Locale): Crumb => ({
  name: locale === "en" ? "Cities" : "Städte",
  path: "/cities",
});
function cityCrumbs(cityName: string, locale: Locale): Crumb[] {
  const path = cityPath(cityName);
  return path ? [citiesCrumb(locale), { name: cityName, path }] : [];
}

function breadcrumbList(path: string, trail: Crumb[], locale: Locale) {
  return {
    "@type": "BreadcrumbList",
    "@id": `${absoluteUrl(path, locale)}#breadcrumb`,
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path, locale),
    })),
  };
}

type PageOptions = {
  type?: PageType;
  description?: string;
  mainEntity?: string;
  // Other nodes on the page. ProfilePage.mainEntity must be a Person or
  // Organization, so a profile's event list hangs off the page here instead.
  hasPart?: string;
  about?: string;
  // Ancestors of this page, excluding the home page and the page itself.
  crumbs?: Crumb[];
  // The page's own breadcrumb label when it differs from the page name.
  crumbName?: string;
};

// The page node and, except on the home page, its breadcrumb trail.
function page(
  path: string,
  name: string,
  locale: Locale,
  options: PageOptions = {},
) {
  const url = absoluteUrl(path, locale);
  const trail =
    path === "/"
      ? []
      : [
          homeCrumb(locale),
          ...(options.crumbs ?? []),
          { name: options.crumbName ?? name, path },
        ];
  const breadcrumb = trail.length ? breadcrumbList(path, trail, locale) : null;
  const summary = options.description?.trim().replace(/\s+/g, " ");
  const node = {
    "@type": options.type ?? "WebPage",
    "@id": `${url}#webpage`,
    url,
    name,
    ...(summary ? { description: summary } : {}),
    inLanguage: locale,
    isPartOf: { "@id": websiteId },
    publisher: { "@id": organizationId },
    ...(options.about ? { about: { "@id": options.about } } : {}),
    ...(options.mainEntity
      ? { mainEntity: { "@id": options.mainEntity } }
      : {}),
    ...(options.hasPart ? { hasPart: { "@id": options.hasPart } } : {}),
    ...(breadcrumb ? { breadcrumb: { "@id": breadcrumb["@id"] } } : {}),
  };
  return { node, nodes: breadcrumb ? [node, breadcrumb] : [node], breadcrumb };
}

const eventId = (event: Event) =>
  `${absoluteUrl(`/events/${event.slug}`)}#event`;
const venueId = (venue: Venue) =>
  `${absoluteUrl(`/venues/${venue.slug}`)}#venue`;
const personId = (dj: Dj) => `${absoluteUrl(`/djs/${dj.slug}`)}#person`;
const eventStatus = (event: Event) =>
  event.status === "cancelled"
    ? "https://schema.org/EventCancelled"
    : "https://schema.org/EventScheduled";

const optionalDescription = (description: string) =>
  description ? { description } : {};

function venueEntity(venue: Venue, locale: Locale) {
  const path = `/venues/${venue.slug}`;
  return {
    "@type": ["MusicVenue", "LocalBusiness"],
    "@id": venueId(venue),
    name: venue.name,
    // Only the public bio: filler and event notes never reach structured data.
    ...optionalDescription(publicBioFor(venue, locale)),
    url: absoluteUrl(path, locale),
    address: {
      "@type": "PostalAddress",
      streetAddress: venue.address,
      addressLocality: venue.city,
      addressCountry: venue.country,
    },
    ...(venue.imageUrl ? { image: venue.imageUrl } : {}),
    sameAs: [venue.websiteUrl, venue.instagramUrl, venue.soundcloudUrl].filter(
      (url) => url !== null,
    ),
  };
}

function djEntity(dj: Dj, locale: Locale) {
  const path = `/djs/${dj.slug}`;
  return {
    "@type": "Person",
    "@id": personId(dj),
    name: dj.name,
    ...optionalDescription(publicBioFor(dj, locale)),
    jobTitle: "DJ",
    url: absoluteUrl(path, locale),
    ...(dj.imageUrl ? { image: dj.imageUrl } : {}),
    sameAs: [dj.websiteUrl, dj.instagramUrl, dj.soundcloudUrl].filter(
      (url) => url !== null,
    ),
  };
}

function eventList(
  path: string,
  name: string,
  events: Event[],
  locale: Locale,
) {
  const listed = events.slice(0, listLimit);
  return {
    "@type": "ItemList",
    "@id": `${absoluteUrl(path, locale)}#events`,
    name,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: listed.length,
    itemListElement: listed.map((event, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: localizedTitle(event, locale),
      url: absoluteUrl(`/events/${event.slug}`, locale),
    })),
  };
}

// A directory lists people by reference: each entry is the same Person node
// (same @id) that the DJ's own page describes in full. No itemListOrder: the
// order (SoundCloud first, then most nights) is not a ranking.
function personList(
  path: string,
  name: string,
  djs: readonly Pick<Dj, "slug" | "name">[],
  locale: Locale,
) {
  const listed = djs.slice(0, listLimit);
  return {
    "@type": "ItemList",
    "@id": `${absoluteUrl(path, locale)}#djs`,
    name,
    numberOfItems: listed.length,
    itemListElement: listed.map((dj, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Person",
        "@id": `${absoluteUrl(`/djs/${dj.slug}`)}#person`,
        name: dj.name,
        url: absoluteUrl(`/djs/${dj.slug}`, locale),
      },
    })),
  };
}

function graph(...nodes: object[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [organization, website, ...nodes],
  };
}

export function pageStructuredData(
  path: string,
  name: string,
  locale: Locale = "de",
  options: Pick<PageOptions, "type" | "description" | "crumbs"> = {},
) {
  return graph(...page(path, name, locale, options).nodes);
}

// The home page and city pages list upcoming events. Pass no events for demo
// catalogs so fictional listings never become structured data.
export function homeStructuredData(
  events: Event[],
  locale: Locale = "de",
  description?: string,
) {
  const name = locale === "en" ? "Upcoming nights" : "Kommende Nächte";
  const list = events.length ? eventList("/", name, events, locale) : null;
  return graph(
    ...page("/", "EVRYVIBE", locale, {
      type: "CollectionPage",
      description,
      mainEntity: list?.["@id"],
    }).nodes,
    ...(list ? [list] : []),
  );
}

export function cityStructuredData(
  city: City,
  events: Event[],
  locale: Locale = "de",
  options: {
    name?: string;
    description?: string;
    path?: string;
  } = {},
) {
  const cityRoute = `/cities/${city.slug}`;
  const path = options.path ?? cityRoute;
  const place = {
    "@type": "City",
    "@id": `${absoluteUrl(cityRoute)}#city`,
    name: city.name,
    address: {
      "@type": "PostalAddress",
      addressLocality: city.name,
      addressCountry: city.country,
    },
  };
  const title = options.name ?? city.name;
  const list = events.length ? eventList(path, title, events, locale) : null;
  return graph(
    ...page(path, title, locale, {
      type: "CollectionPage",
      description: options.description,
      about: place["@id"],
      crumbName: city.name,
      mainEntity: list?.["@id"],
      crumbs: [citiesCrumb(locale)],
    }).nodes,
    place,
    ...(list ? [list] : []),
  );
}

export function cityMonthStructuredData(
  city: City,
  events: Event[],
  month: string,
  locale: Locale = "de",
  options: { name?: string; description?: string; path?: string } = {},
) {
  const cityRoute = `/cities/${city.slug}`;
  const path = options.path ?? `${cityRoute}/${month}`;
  const place = {
    "@type": "City",
    "@id": `${absoluteUrl(cityRoute)}#city`,
    name: city.name,
    address: {
      "@type": "PostalAddress",
      addressLocality: city.name,
      addressCountry: city.country,
    },
  };
  const title = options.name ?? `${city.name} · ${month}`;
  const list = events.length ? eventList(path, title, events, locale) : null;
  return graph(
    ...page(path, title, locale, {
      type: "CollectionPage",
      description: options.description,
      about: place["@id"],
      mainEntity: list?.["@id"],
      crumbs: [citiesCrumb(locale), { name: city.name, path: cityRoute }],
    }).nodes,
    place,
    ...(list ? [list] : []),
  );
}

export function citiesStructuredData(
  cities: City[],
  locale: Locale = "de",
  description?: string,
) {
  const path = "/cities";
  const name = citiesCrumb(locale).name;
  const list = cities.length
    ? {
        "@type": "ItemList",
        "@id": `${absoluteUrl(path, locale)}#cities`,
        name,
        numberOfItems: cities.length,
        itemListElement: cities.map((city, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: city.name,
          url: absoluteUrl(`/cities/${city.slug}`, locale),
        })),
      }
    : null;
  return graph(
    ...page(path, name, locale, {
      type: "CollectionPage",
      description,
      mainEntity: list?.["@id"],
    }).nodes,
    ...(list ? [list] : []),
  );
}

// "Genres" reads the same in both languages.
const genresCrumb: Crumb = { name: "Genres", path: "/genres" };

type CollectionOptions = {
  name: string;
  description?: string;
  // The page's own URL; filtered variants pass their query.
  path?: string;
};

// The DJ directory: a collection whose main entity is the list of DJs. Pass
// no DJs for demo catalogs so fictional people never become structured data.
export function djDirectoryStructuredData(
  djs: readonly Pick<Dj, "slug" | "name">[],
  locale: Locale = "de",
  options: CollectionOptions,
) {
  const path = options.path ?? "/djs";
  const list = djs.length ? personList(path, options.name, djs, locale) : null;
  return graph(
    ...page(path, options.name, locale, {
      type: "CollectionPage",
      description: options.description,
      mainEntity: list?.["@id"],
      crumbName: "DJs",
    }).nodes,
    ...(list ? [list] : []),
  );
}

// A genre page: its DJs are the main entity, its upcoming nights a URL-only
// event list beside them (the full MusicEvent lives on each event page).
export function genreStructuredData(
  genre: { slug: string; name: string },
  djs: readonly Pick<Dj, "slug" | "name">[],
  events: Event[],
  locale: Locale = "de",
  options: CollectionOptions,
) {
  const path = options.path ?? `/genres/${genre.slug}`;
  const people = djs.length
    ? personList(path, `${genre.name} DJs`, djs, locale)
    : null;
  const nights = events.length
    ? eventList(
        path,
        locale === "en"
          ? `Upcoming ${genre.name} nights`
          : `Kommende ${genre.name}-Nächte`,
        events,
        locale,
      )
    : null;
  return graph(
    ...page(path, options.name, locale, {
      type: "CollectionPage",
      description: options.description,
      mainEntity: people?.["@id"] ?? nights?.["@id"],
      hasPart: people && nights ? nights["@id"] : undefined,
      crumbs: [genresCrumb],
      crumbName: genre.name,
    }).nodes,
    ...(people ? [people] : []),
    ...(nights ? [nights] : []),
  );
}

// The genre index lists genre pages by URL, like the city index.
export function genresStructuredData(
  genres: readonly { slug: string; name: string }[],
  locale: Locale = "de",
  options: CollectionOptions,
) {
  const path = "/genres";
  const list = genres.length
    ? {
        "@type": "ItemList",
        "@id": `${absoluteUrl(path, locale)}#genres`,
        name: options.name,
        numberOfItems: genres.length,
        itemListElement: genres.map((genre, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: genre.name,
          url: absoluteUrl(`/genres/${genre.slug}`, locale),
        })),
      }
    : null;
  return graph(
    ...page(path, options.name, locale, {
      type: "CollectionPage",
      description: options.description,
      mainEntity: list?.["@id"],
      crumbName: genresCrumb.name,
    }).nodes,
    ...(list ? [list] : []),
  );
}

// Upcoming events are optional so callers can omit them for demo catalogs.
export function venueStructuredData(
  venue: Venue,
  locale: Locale = "de",
  upcoming: Event[] = [],
  description?: string,
) {
  const entity = venueEntity(venue, locale);
  const path = `/venues/${venue.slug}`;
  const eventsName = `${venue.name} ${locale === "en" ? "events" : "Events"}`;
  const list = upcoming.length
    ? eventList(path, eventsName, upcoming, locale)
    : null;
  return graph(
    ...page(path, venue.name, locale, {
      description,
      mainEntity: entity["@id"],
      hasPart: list?.["@id"],
      crumbs: cityCrumbs(venue.city, locale),
    }).nodes,
    entity,
    ...(list ? [list] : []),
  );
}

export function djStructuredData(
  dj: Dj,
  locale: Locale = "de",
  upcoming: Event[] = [],
  description?: string,
) {
  const entity = djEntity(dj, locale);
  const path = `/djs/${dj.slug}`;
  const eventsName = `${dj.name} ${locale === "en" ? "events" : "Events"}`;
  const list = upcoming.length
    ? eventList(path, eventsName, upcoming, locale)
    : null;
  return graph(
    ...page(path, dj.name, locale, {
      type: "ProfilePage",
      description,
      mainEntity: entity["@id"],
      hasPart: list?.["@id"],
    }).nodes,
    entity,
    ...(list ? [list] : []),
  );
}

export function eventStructuredData(
  event: Event,
  venue: Venue,
  djs: Dj[],
  locale: Locale = "de",
  sourceAccountUrl: string | undefined = event.sourceAccountUrl ?? undefined,
  description?: string,
) {
  const path = `/events/${event.slug}`;
  const id = eventId(event);
  const location = venueEntity(venue, locale);
  const { genres } = normalizeGenres(event.genres);
  const performers = djs
    .filter((dj) => event.djIds.includes(dj.id))
    .map((dj) => djEntity(dj, locale));
  // A post permalink does not identify its author. Only use a known matched account.
  const author =
    sourceAccountUrl &&
    (venue.instagramUrl === sourceAccountUrl
      ? location
      : performers.find((person) => person.sameAs.includes(sourceAccountUrl)));
  const source = {
    "@type": "CreativeWork",
    "@id": event.sourceUrl,
    url: event.sourceUrl,
    about: { "@id": id },
    ...(author ? { author: { "@id": author["@id"] } } : {}),
  };
  const webpage = page(path, localizedTitle(event, locale), locale, {
    description,
    mainEntity: id,
    crumbs: cityCrumbs(venue.city, locale),
  });
  return graph(
    { ...webpage.node, isBasedOn: { "@id": event.sourceUrl } },
    ...(webpage.breadcrumb ? [webpage.breadcrumb] : []),
    {
      "@type": "MusicEvent",
      "@id": id,
      name: localizedTitle(event, locale),
      description: localizedDescription(event, locale),
      url: absoluteUrl(path, locale),
      startDate: event.startsAt,
      ...(event.endsAt ? { endDate: event.endsAt } : {}),
      eventStatus: eventStatus(event),
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: { "@id": location["@id"] },
      performer: performers.map((person) => ({ "@id": person["@id"] })),
      ...(genres.length ? { genre: genres } : {}),
      ...(event.imageUrl ? { image: event.imageUrl } : {}),
      ...(event.ticketUrl && event.status !== "cancelled"
        ? { offers: { "@type": "Offer", url: event.ticketUrl } }
        : {}),
      ...(event.websiteUrl ? { sameAs: event.websiteUrl } : {}),
      subjectOf: { "@id": event.sourceUrl },
      mainEntityOfPage: { "@id": `${absoluteUrl(path, locale)}#webpage` },
    },
    location,
    ...performers,
    source,
  );
}

// Prevent source text containing </script> from breaking out of an application/ld+json tag.
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
