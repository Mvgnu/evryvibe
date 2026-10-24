import { describe, expect, it } from "vitest";
import { demoCatalog } from "../src/db/demo";
import { djSchema, eventSchema, venueSchema } from "../src/core/model";
import {
  cityStructuredData,
  cityMonthStructuredData,
  citiesStructuredData,
  djDirectoryStructuredData,
  djStructuredData,
  genreStructuredData,
  genresStructuredData,
  eventStructuredData,
  homeStructuredData,
  pageStructuredData,
  serializeJsonLd,
  venueStructuredData,
} from "../src/core/structured-data";
import { catalogCities, findCity } from "../src/core/cities";

const event = eventSchema.parse(demoCatalog.events[0]);
const venue = venueSchema.parse(
  demoCatalog.venues.find((entry) => entry.id === event.venueId),
);

describe("truthful structured discovery data", () => {
  it("does not confuse source observation with page modification or invent missing rich-result facts", () => {
    const data = eventStructuredData({ ...event, imageUrl: null }, venue, []);
    expect(nodeOfType(data, "WebPage")).not.toHaveProperty("dateModified");
    for (const unknown of ["organizer", "image", "price", "availability"])
      expect(nodeOfType(data, "MusicEvent")).not.toHaveProperty(unknown);
  });

  it("connects a monthly genre collection to its self canonical and stable city entity", () => {
    const city = catalogCities([venue])[0];
    if (!city) throw new Error("Fixture venue must have a city");
    const path = `/cities/${city.slug}/2026-10?genre=Techno`;
    const data = cityMonthStructuredData(city, [event], "2026-10", "en", {
      path,
    });
    expect(nodeOfType(data, "CollectionPage")).toMatchObject({
      "@id": `https://evryvibe.com/en${path}#webpage`,
      url: `https://evryvibe.com/en${path}`,
      about: { "@id": `https://evryvibe.com/cities/${city.slug}#city` },
    });
    expect(nodeOfType(data, "CollectionPage")).not.toHaveProperty(
      "dateModified",
    );
    expect(nodeOfType(data, "ItemList")).toMatchObject({
      "@id": `https://evryvibe.com/en${path}#events`,
    });
    expect(nodeOfType(data, "BreadcrumbList")).toMatchObject({
      "@id": `https://evryvibe.com/en${path}#breadcrumb`,
      itemListElement: expect.arrayContaining([
        expect.objectContaining({ item: `https://evryvibe.com/en${path}` }),
      ]),
    });
    expect(
      nodeOfType(cityStructuredData(city, [event]), "CollectionPage"),
    ).not.toHaveProperty("dateModified");
    expect(nodeOfType(data, "ItemList")?.itemListElement).toEqual([
      expect.objectContaining({
        url: `https://evryvibe.com/en/events/${event.slug}`,
      }),
    ]);
    const { declared, refs } = ids(data);
    for (const ref of refs) expect(declared.has(ref)).toBe(true);
  });

  it("connects event, location, artists, source and translated webpage without inventing prices", () => {
    const translatedEvent = {
      ...event,
      translations: {
        en: { title: "English title", description: "English description" },
      },
    };
    const data = eventStructuredData(
      translatedEvent,
      venue,
      demoCatalog.djs,
      "en",
    );
    const serialized = serializeJsonLd(data);
    expect(serialized).toContain('"@type":"MusicEvent"');
    expect(serialized).toContain('"name":"English title"');
    expect(serialized).toContain('"inLanguage":"en"');
    expect(serialized).toContain(
      `https://evryvibe.com/en/events/${event.slug}`,
    );
    expect(serialized).toContain('"@type":["MusicVenue","LocalBusiness"]');
    expect(serialized).not.toContain('"price"');
    expect(serialized).not.toContain('"isAccessibleForFree"');
    expect(serialized).not.toContain('"author"');
  });

  it("credits a verified posting venue but not an unknown source account", () => {
    const matchedVenue = {
      ...venue,
      instagramUrl: "https://www.instagram.com/verified/",
    };
    const data = eventStructuredData(
      { ...event, sourceAccountUrl: matchedVenue.instagramUrl },
      matchedVenue,
      [],
      "de",
    );
    expect(serializeJsonLd(data)).toContain(
      `"author":{"@id":"https://evryvibe.com/venues/${venue.slug}#venue"}`,
    );
    expect(
      serializeJsonLd(
        eventStructuredData(
          { ...event, sourceAccountUrl: "https://www.instagram.com/unknown/" },
          matchedVenue,
          [],
        ),
      ),
    ).not.toContain('"author"');
  });

  it("links known scheduled ticket offers without inventing price, stock or sale start", () => {
    const scheduled = eventStructuredData(
      { ...event, ticketUrl: "https://tickets.example/event" },
      venue,
      [],
    );
    expect(nodeOfType(scheduled, "MusicEvent")?.offers).toEqual({
      "@type": "Offer",
      url: "https://tickets.example/event",
    });
    const cancelled = eventStructuredData(
      {
        ...event,
        status: "cancelled",
        ticketUrl: "https://tickets.example/event",
      },
      venue,
      [],
    );
    expect(nodeOfType(cancelled, "MusicEvent")).not.toHaveProperty("offers");
  });

  it("models artists as people and venues with their known physical address", () => {
    expect(
      serializeJsonLd(djStructuredData(djSchema.parse(demoCatalog.djs[0]))),
    ).toContain('"jobTitle":"DJ"');
    expect(serializeJsonLd(venueStructuredData(venue))).toContain(
      '"@type":"PostalAddress"',
    );
  });

  it("cannot break out of a script tag with untrusted source descriptions", () => {
    const dangerous = {
      description: '</script><script>alert("x")</script>&\u2028',
    };
    const serialized = serializeJsonLd(dangerous);
    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain("&");
    expect(JSON.parse(serialized)).toEqual(dangerous);
  });
});

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Collects declared nodes (objects with an @id and other fields) and bare
// {"@id"} references anywhere in the graph.
function ids(
  value: unknown,
  declared = new Set<string>(),
  refs = new Set<string>(),
) {
  if (Array.isArray(value)) for (const item of value) ids(item, declared, refs);
  else if (isNode(value)) {
    const id = value["@id"];
    if (typeof id === "string")
      (Object.keys(value).length === 1 ? refs : declared).add(id);
    for (const child of Object.values(value)) ids(child, declared, refs);
  }
  return { declared, refs };
}
function expectResolvable(data: { "@graph": unknown[] }) {
  const { declared, refs } = ids(data["@graph"]);
  expect([...refs].filter((ref) => !declared.has(ref))).toEqual([]);
}
const nodeOfType = (data: { "@graph": unknown[] }, type: string) =>
  data["@graph"].filter(isNode).find((node) => node["@type"] === type);

describe("page-level structured data", () => {
  const venues = demoCatalog.venues;
  const upcoming = demoCatalog.events;

  it("lists upcoming events on the home page and omits the list for demo data", () => {
    const home = homeStructuredData(upcoming, "en", "Find a night");
    expect(nodeOfType(home, "CollectionPage")).toMatchObject({
      url: "https://evryvibe.com/en",
      description: "Find a night",
      mainEntity: { "@id": "https://evryvibe.com/en#events" },
    });
    const list = nodeOfType(home, "ItemList");
    expect(list?.numberOfItems).toBe(upcoming.length);
    expect(serializeJsonLd(list)).toContain(
      `"url":"https://evryvibe.com/en/events/${upcoming[0]?.slug}"`,
    );
    expect(nodeOfType(home, "BreadcrumbList")).toBeUndefined();
    expectResolvable(home);

    const demo = homeStructuredData([], "de");
    expect(nodeOfType(demo, "ItemList")).toBeUndefined();
    expect(nodeOfType(demo, "CollectionPage")).not.toHaveProperty("mainEntity");
  });

  it("caps long listings instead of emitting every event", () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
      ...event,
      slug: `night-${index}`,
    }));
    expect(
      nodeOfType(homeStructuredData(many), "ItemList")?.numberOfItems,
    ).toBe(50);
  });

  it("describes a city page as a collection about that city with a breadcrumb", () => {
    const city = findCity(venues, "muenchen");
    if (!city) throw new Error("Expected München");
    const data = cityStructuredData(city, upcoming.slice(0, 2), "en", {
      name: "Club nights in München",
    });
    expect(nodeOfType(data, "CollectionPage")).toMatchObject({
      url: "https://evryvibe.com/en/cities/muenchen",
      about: { "@id": "https://evryvibe.com/cities/muenchen#city" },
    });
    expect(nodeOfType(data, "City")).toMatchObject({ name: "München" });
    const crumbs = nodeOfType(data, "BreadcrumbList")?.itemListElement;
    expect(serializeJsonLd(crumbs)).toContain(
      '"item":"https://evryvibe.com/en/cities"',
    );
    // The city crumb reads the same here as in event and venue trails.
    expect(serializeJsonLd(crumbs)).toContain(
      '"position":3,"name":"München","item":"https://evryvibe.com/en/cities/muenchen"',
    );
    expectResolvable(data);

    const index = citiesStructuredData(catalogCities(venues), "de");
    expect(nodeOfType(index, "ItemList")?.numberOfItems).toBe(4);
    expectResolvable(index);
  });

  it("links event, venue and DJ pages into resolvable graphs with breadcrumbs", () => {
    const eventData = eventStructuredData(event, venue, demoCatalog.djs, "de");
    const trail = serializeJsonLd(nodeOfType(eventData, "BreadcrumbList"));
    expect(trail).toContain('"item":"https://evryvibe.com/cities/berlin"');
    expect(trail).toContain(
      `"item":"https://evryvibe.com/events/${event.slug}"`,
    );
    expect(nodeOfType(eventData, "MusicEvent")?.genre).toEqual(event.genres);
    expectResolvable(eventData);

    const atVenue = upcoming.filter((entry) => entry.venueId === venue.id);
    const venueData = venueStructuredData(venue, "de", atVenue);
    const place = venueData["@graph"]
      .filter(isNode)
      .find(
        (node) =>
          node["@id"] === `https://evryvibe.com/venues/${venue.slug}#venue`,
      );
    expect(place).not.toHaveProperty("event");
    expect(nodeOfType(venueData, "ItemList")?.numberOfItems).toBe(
      atVenue.length,
    );
    expect(nodeOfType(venueData, "WebPage")).toMatchObject({
      mainEntity: { "@id": `https://evryvibe.com/venues/${venue.slug}#venue` },
      hasPart: { "@id": `https://evryvibe.com/venues/${venue.slug}#events` },
    });
    expect(nodeOfType(venueData, "MusicEvent")).toBeUndefined();
    expectResolvable(venueData);

    const dj = djSchema.parse(demoCatalog.djs[0]);
    const djEvents = upcoming.filter((entry) => entry.djIds.includes(dj.id));
    const profile = djStructuredData(dj, "en", djEvents);
    // Google only accepts a Person or Organization as ProfilePage.mainEntity;
    // the event list must hang off the page instead.
    expect(nodeOfType(profile, "ProfilePage")).toMatchObject({
      mainEntity: { "@id": `https://evryvibe.com/djs/${dj.slug}#person` },
      hasPart: { "@id": `https://evryvibe.com/en/djs/${dj.slug}#events` },
    });
    expect(nodeOfType(profile, "Person")).not.toHaveProperty("performerIn");
    expect(nodeOfType(profile, "ItemList")?.numberOfItems).toBe(
      djEvents.length,
    );
    expect(nodeOfType(profile, "MusicEvent")).toBeUndefined();
    expectResolvable(profile);
  });

  it("keeps ProfilePage.mainEntity to the entity alone and lists SoundCloud in sameAs", () => {
    const dj = {
      ...djSchema.parse(demoCatalog.djs[0]),
      soundcloudUrl: "https://soundcloud.com/some-dj",
    };
    const withSoundcloud = {
      ...venue,
      soundcloudUrl: "https://soundcloud.com/some-club",
    };
    const upcomingEvents = demoCatalog.events
      .map((entry) => eventSchema.parse(entry))
      .slice(0, 2);
    for (const data of [
      djStructuredData(dj, "de", upcomingEvents),
      venueStructuredData(withSoundcloud, "de", upcomingEvents),
    ]) {
      const page = data["@graph"]
        .filter(isNode)
        .find(
          (node) =>
            node["@type"] === "ProfilePage" || node["@type"] === "WebPage",
        );
      expect(Array.isArray(page?.mainEntity)).toBe(false);
      const target = data["@graph"]
        .filter(isNode)
        .find(
          (node) =>
            isNode(page?.mainEntity) && node["@id"] === page.mainEntity["@id"],
        );
      expect(["Person", ["MusicVenue", "LocalBusiness"]]).toContainEqual(
        target?.["@type"],
      );
      expectResolvable(data);
    }
    expect(nodeOfType(djStructuredData(dj, "de"), "Person")?.sameAs).toContain(
      "https://soundcloud.com/some-dj",
    );
    expect(
      venueStructuredData(withSoundcloud, "de")
        ["@graph"].filter(isNode)
        .find((node) => Array.isArray(node["@type"]))?.sameAs,
    ).toContain("https://soundcloud.com/some-club");
  });

  it("describes people only with their public bio", () => {
    const base = djSchema.parse(demoCatalog.djs[0]);
    const note = {
      ...base,
      description: `${base.name} steht am Samstag bei der Nacht im Line-up.`,
      translations: {},
    };
    expect(
      nodeOfType(djStructuredData(note, "de"), "Person"),
    ).not.toHaveProperty("description");
    const bio = {
      ...base,
      description:
        "Spielt seit Jahren hypnotischen Techno zwischen Dub und Industrial.",
    };
    expect(nodeOfType(djStructuredData(bio, "de"), "Person")).toHaveProperty(
      "description",
      bio.description,
    );
  });

  it("types contact pages and nests the takedown page under contact", () => {
    expect(
      nodeOfType(
        pageStructuredData("/kontakt", "Kontakt", "de", {
          type: "ContactPage",
        }),
        "ContactPage",
      ),
    ).toBeDefined();
    const takedown = pageStructuredData("/takedown", "Content removal", "en", {
      crumbs: [{ name: "Contact", path: "/kontakt" }],
    });
    expect(
      serializeJsonLd(nodeOfType(takedown, "BreadcrumbList")?.itemListElement),
    ).toContain(
      '"position":2,"name":"Contact","item":"https://evryvibe.com/en/kontakt"',
    );
  });

  it("lists directory DJs as the same Person entities their pages describe", () => {
    const djs = Array.from({ length: 60 }, (_, index) => ({
      slug: `dj-${index}`,
      name: `DJ ${index}`,
    }));
    const data = djDirectoryStructuredData(djs, "en", {
      name: "Techno DJs",
      description: "Techno DJs with gigs",
    });
    expect(nodeOfType(data, "CollectionPage")).toMatchObject({
      url: "https://evryvibe.com/en/djs",
      mainEntity: { "@id": "https://evryvibe.com/en/djs#djs" },
    });
    const list = nodeOfType(data, "ItemList");
    expect(list?.numberOfItems).toBe(50);
    // The order (SoundCloud first) is not a ranking, so none is claimed.
    expect(list).not.toHaveProperty("itemListOrder");
    expect(serializeJsonLd(list)).toContain(
      '{"@type":"ListItem","position":1,"item":{"@type":"Person","@id":"https://evryvibe.com/djs/dj-0#person","name":"DJ 0","url":"https://evryvibe.com/en/djs/dj-0"}}',
    );
    expect(
      serializeJsonLd(nodeOfType(data, "BreadcrumbList")?.itemListElement),
    ).toContain(
      '"position":2,"name":"DJs","item":"https://evryvibe.com/en/djs"',
    );
    expectResolvable(data);

    const demo = djDirectoryStructuredData([], "de", { name: "Techno-DJs" });
    expect(nodeOfType(demo, "ItemList")).toBeUndefined();
    expect(nodeOfType(demo, "CollectionPage")).not.toHaveProperty("mainEntity");
  });

  it("describes a genre page by its DJs with its nights as URL-only events", () => {
    const genre = { slug: "hard-techno", name: "Hard Techno" };
    const data = genreStructuredData(
      genre,
      [{ slug: "mira-phase", name: "Mira Phase" }],
      upcoming.slice(0, 2),
      "de",
      { name: "Hard-Techno-DJs und -Partys" },
    );
    expect(nodeOfType(data, "CollectionPage")).toMatchObject({
      url: "https://evryvibe.com/genres/hard-techno",
      mainEntity: { "@id": "https://evryvibe.com/genres/hard-techno#djs" },
      hasPart: { "@id": "https://evryvibe.com/genres/hard-techno#events" },
    });
    expect(nodeOfType(data, "MusicEvent")).toBeUndefined();
    const trail = serializeJsonLd(
      nodeOfType(data, "BreadcrumbList")?.itemListElement,
    );
    expect(trail).toContain(
      '"position":2,"name":"Genres","item":"https://evryvibe.com/genres"',
    );
    expect(trail).toContain(
      '"position":3,"name":"Hard Techno","item":"https://evryvibe.com/genres/hard-techno"',
    );
    expectResolvable(data);

    const nightsOnly = genreStructuredData(
      genre,
      [],
      upcoming.slice(0, 1),
      "en",
      {
        name: "Hard Techno DJs and parties",
      },
    );
    expect(nodeOfType(nightsOnly, "CollectionPage")).toMatchObject({
      mainEntity: {
        "@id": "https://evryvibe.com/en/genres/hard-techno#events",
      },
    });
    expect(nodeOfType(nightsOnly, "CollectionPage")).not.toHaveProperty(
      "hasPart",
    );
    expectResolvable(nightsOnly);

    const index = genresStructuredData([genre], "en", {
      name: "Techno DJs by genre",
    });
    expect(nodeOfType(index, "ItemList")?.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Hard Techno",
        url: "https://evryvibe.com/en/genres/hard-techno",
      },
    ]);
    expectResolvable(index);
  });
});
