import { describe, expect, it } from "vitest";
import { catalogCities } from "../src/core/cities";
import {
  compareEntries,
  directoryEntries,
  directoryFacets,
  filterDirectory,
  upcomingGenreEvents,
  type DirectoryEntry,
} from "../src/core/dj-directory";
import { canonicalGenre } from "../src/core/genres";
import type { Dj, Event, Venue } from "../src/core/model";
import { demoCatalog } from "../src/db/demo";

const baseVenue = demoCatalog.venues[0];
const baseDj = demoCatalog.djs[0];
const baseEvent = demoCatalog.events[0];
if (!baseVenue || !baseDj || !baseEvent)
  throw new Error("Demo catalog needs a venue, DJ and event");

const uuid = (kind: number, n: number) =>
  `${kind}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const venue = (n: number, city: string): Venue => ({
  ...baseVenue,
  id: uuid(1, n),
  slug: `venue-${n}`,
  city,
});
const dj = (n: number, name: string, over: Partial<Dj> = {}): Dj => ({
  ...baseDj,
  id: uuid(2, n),
  slug: `dj-${n}`,
  name,
  genres: [],
  soundcloudUrl: null,
  ...over,
});
const day = (offset: number) =>
  new Date(now + offset * 86_400_000).toISOString();
let counter = 0;
const night = (
  venueRecord: Venue,
  djs: Dj[],
  offsetDays: number,
  over: Partial<Event> = {},
): Event => {
  counter += 1;
  return {
    ...baseEvent,
    id: uuid(3, counter),
    slug: `night-${counter}`,
    venueId: venueRecord.id,
    djIds: djs.map((entry) => entry.id),
    startsAt: day(offsetDays),
    endsAt: null,
    genres: [],
    status: "scheduled",
    ...over,
  };
};

const now = Date.parse("2026-10-15T12:00:00Z");
const berlin = venue(1, "Berlin");
const hamburg = venue(2, "Hamburg");
const koeln = venue(3, "Köln");
const koelnAlt = venue(4, "Koeln");
const venues = [berlin, hamburg, koeln, koelnAlt];
const city = (slug: string) => {
  const found = catalogCities(venues).find((entry) => entry.slug === slug);
  if (!found) throw new Error(`No city ${slug}`);
  return found;
};
const genre = (name: string) => {
  const found = canonicalGenre(name);
  if (!found) throw new Error(`No genre ${name}`);
  return found;
};
const entryFor = (entries: DirectoryEntry[], name: string) => {
  const found = entries.find((entry) => entry.dj.name === name);
  if (!found) throw new Error(`No entry ${name}`);
  return found;
};
const names = (entries: DirectoryEntry[]) =>
  entries.map((entry) => entry.dj.name);

describe("listing", () => {
  it("lists a DJ only with a scheduled night, counting a repeated slot once", () => {
    const listed = dj(1, "Listed");
    const cancelledOnly = dj(2, "Cancelled Only");
    const none = dj(3, "No Nights");
    const events = [
      night(berlin, [listed, listed], 3),
      night(berlin, [cancelledOnly], 4, { status: "cancelled" }),
    ];
    const entries = directoryEntries(
      { djs: [listed, cancelledOnly, none], events, venues },
      now,
    );
    expect(names(entries)).toEqual(["Listed"]);
    expect(entries[0]?.upcomingNights).toBe(1);
    expect(entries[0]?.pastNights).toBe(0);
  });

  it("ignores cancelled nights for a DJ who also has a scheduled one", () => {
    const a = dj(1, "A");
    const events = [
      night(berlin, [a], 2),
      night(berlin, [a], 3, { status: "cancelled" }),
    ];
    const [entry] = directoryEntries({ djs: [a], events, venues }, now);
    expect(entry?.upcomingNights).toBe(1);
  });
});

describe("past and upcoming", () => {
  const a = dj(1, "A");
  const past1 = night(berlin, [a], -20);
  const past2 = night(berlin, [a], -5);
  const soon = night(berlin, [a], 2);
  const later = night(berlin, [a], 9);
  // Unsorted on purpose: next and last must not depend on catalogue order.
  const events = [later, past2, soon, past1];

  it("splits counts and picks the next and last night", () => {
    const [entry] = directoryEntries({ djs: [a], events, venues }, now);
    expect(entry?.pastNights).toBe(2);
    expect(entry?.upcomingNights).toBe(2);
    expect(entry?.next?.id).toBe(soon.id);
    expect(entry?.last?.id).toBe(past2.id);
  });

  it("uses endsAt when present, so a running night is upcoming", () => {
    const running = night(berlin, [a], -0.25, {
      endsAt: day(0.25),
    });
    const ended = night(berlin, [a], -1, { endsAt: day(-0.5) });
    const [entry] = directoryEntries(
      { djs: [a], events: [running, ended], venues },
      now,
    );
    expect(entry?.upcomingNights).toBe(1);
    expect(entry?.pastNights).toBe(1);
    expect(entry?.next?.id).toBe(running.id);
    expect(entry?.last?.id).toBe(ended.id);
  });

  it("reports null next and last when there are none", () => {
    const [onlyPast] = directoryEntries(
      { djs: [a], events: [past1], venues },
      now,
    );
    expect(onlyPast?.next).toBeNull();
    expect(onlyPast?.last?.id).toBe(past1.id);
    const [onlyUpcoming] = directoryEntries(
      { djs: [a], events: [soon], venues },
      now,
    );
    expect(onlyUpcoming?.last).toBeNull();
    expect(onlyUpcoming?.next?.id).toBe(soon.id);
  });
});

describe("city tallies", () => {
  it("merges spellings sharing a slug and orders by most nights", () => {
    const a = dj(1, "A");
    const events = [
      night(berlin, [a], 2),
      night(koeln, [a], -3),
      night(koelnAlt, [a], 4),
      night(hamburg, [a], -9),
      night(koelnAlt, [a], -12),
    ];
    const [entry] = directoryEntries({ djs: [a], events, venues }, now);
    expect(
      entry?.cities.map((tally) => [
        tally.city.slug,
        tally.past,
        tally.upcoming,
      ]),
    ).toEqual([
      ["koeln", 2, 1],
      ["berlin", 0, 1],
      ["hamburg", 1, 0],
    ]);
  });
});

describe("genres", () => {
  it("prefers canonicalised profile genres and drops unknown spellings", () => {
    const a = dj(1, "A", { genres: ["Driving Techno", "Polka", "House"] });
    const events = [night(berlin, [a], 2, { genres: ["Hard Techno"] })];
    const [entry] = directoryEntries({ djs: [a], events, venues }, now);
    expect(entry?.genres.map((item) => item.slug)).toEqual([
      genre("Peak Time Techno").slug,
      genre("House").slug,
    ]);
    expect(entry?.genresFromEvents).toBe(false);
  });

  it("derives up to three genres from nights, most frequent first, ties in first-seen order", () => {
    const a = dj(1, "A");
    const events = [
      night(berlin, [a], -4, { genres: ["House", "Polka", "Techno"] }),
      night(berlin, [a], 2, { genres: ["Hard Techno", "Techno"] }),
      night(berlin, [a], 3, { genres: ["Driving Techno", "Acid Techno"] }),
      night(berlin, [a], 5, { genres: ["Peak Time", "Hard Techno"] }),
    ];
    const [entry] = directoryEntries({ djs: [a], events, venues }, now);
    // Peak Time Techno 2, Hard Techno 2, Techno 2, House 1, Acid Techno 1.
    // Start order: House(-4), Techno(-4), Hard Techno(2), Peak Time(3).
    expect(entry?.genres.map((item) => item.slug)).toEqual([
      genre("Techno").slug,
      genre("Hard Techno").slug,
      genre("Peak Time Techno").slug,
    ]);
    expect(entry?.genresFromEvents).toBe(true);
  });

  it("falls back to derived genres when profile genres are all unknown", () => {
    const a = dj(1, "A", { genres: ["Polka"] });
    const events = [night(berlin, [a], 2, { genres: ["House"] })];
    const [entry] = directoryEntries({ djs: [a], events, venues }, now);
    expect(entry?.genres.map((item) => item.slug)).toEqual([
      genre("House").slug,
    ]);
    expect(entry?.genresFromEvents).toBe(true);
  });

  it("has no genres and no derived flag when nothing is known", () => {
    const a = dj(1, "A");
    const events = [night(berlin, [a], 2, { genres: ["Polka"] })];
    const [entry] = directoryEntries({ djs: [a], events, venues }, now);
    expect(entry?.genres).toEqual([]);
    expect(entry?.genresFromEvents).toBe(false);
  });
});

describe("ranking", () => {
  it("ranks SoundCloud, then nights, then an upcoming night, then name", () => {
    const sc = "https://soundcloud.com/evryvibe-demo-x";
    const scFew = dj(1, "Zed", { soundcloudUrl: sc });
    const scMany = dj(2, "Yan", { soundcloudUrl: sc });
    const plainMany = dj(3, "Xia");
    const pastOnly = dj(4, "Wim");
    const upcomingOnly = dj(5, "Vic");
    const alphaA = dj(6, "Abe");
    const alphaB = dj(7, "Ben");
    const events = [
      night(berlin, [scFew], 1),
      night(berlin, [scMany], 1),
      night(berlin, [scMany], 2),
      night(berlin, [plainMany], 1),
      night(berlin, [plainMany], 2),
      night(berlin, [plainMany], 3),
      night(berlin, [pastOnly], -1),
      night(berlin, [upcomingOnly], 1),
      night(berlin, [alphaA], 5),
      night(berlin, [alphaB], 5),
    ];
    const djs = [
      scFew,
      scMany,
      plainMany,
      pastOnly,
      upcomingOnly,
      alphaA,
      alphaB,
    ];
    const entries = directoryEntries({ djs, events, venues }, now);
    // Plain one-night DJs: upcoming first (Abe, Ben, Vic by name), past last.
    expect(names(entries)).toEqual([
      "Yan",
      "Zed",
      "Xia",
      "Abe",
      "Ben",
      "Vic",
      "Wim",
    ]);
    const [a, b] = [entryFor(entries, "Yan"), entryFor(entries, "Zed")];
    expect(compareEntries(a, b)).toBeLessThan(0);
  });
});

describe("filterDirectory", () => {
  const house = dj(1, "House Head", { genres: ["House"] });
  const hard = dj(2, "Hard Head", { genres: ["Hard Techno", "Techno"] });
  const both = dj(3, "Both Heads", { genres: ["Techno", "House"] });
  const pastKoeln = dj(4, "Past Cologne", { genres: ["Techno"] });
  const upKoeln = dj(5, "Up Cologne", { genres: ["House"] });
  const events = [
    night(berlin, [house, both], 2),
    night(hamburg, [hard], 3),
    night(koeln, [pastKoeln], -10),
    night(koelnAlt, [upKoeln, both], 6),
  ];
  const entries = directoryEntries(
    { djs: [house, hard, both, pastKoeln, upKoeln], events, venues },
    now,
  );
  const list = (filter: Parameters<typeof filterDirectory>[1]) =>
    names(filterDirectory(entries, filter)).sort();

  it("returns everyone without filters", () => {
    expect(list({})).toHaveLength(5);
  });

  it("filters by genre", () => {
    expect(list({ genre: genre("Hard Techno") })).toEqual(["Hard Head"]);
    expect(list({ genre: genre("House") })).toEqual([
      "Both Heads",
      "House Head",
      "Up Cologne",
    ]);
  });

  it("filters by family", () => {
    expect(list({ family: "hard-techno" })).toEqual(["Hard Head"]);
    expect(list({ family: "techno" })).toEqual([
      "Both Heads",
      "Hard Head",
      "Past Cologne",
    ]);
  });

  it("filters by city, matching past-only and upcoming-only gigs", () => {
    expect(list({ city: city("koeln") })).toEqual([
      "Both Heads",
      "Past Cologne",
      "Up Cologne",
    ]);
    expect(list({ city: city("hamburg") })).toEqual(["Hard Head"]);
  });

  it("combines filters", () => {
    expect(list({ city: city("koeln"), family: "techno" })).toEqual([
      "Both Heads",
      "Past Cologne",
    ]);
    expect(
      list({ city: city("koeln"), genre: genre("House"), family: "house" }),
    ).toEqual(["Both Heads", "Up Cologne"]);
    expect(list({ city: city("hamburg"), genre: genre("House") })).toEqual([]);
  });

  it("ranks by nights in the filtered city", () => {
    const many = dj(10, "Many Elsewhere");
    const local = dj(11, "Local Three");
    const catalogEvents = [
      night(berlin, [many], 1),
      ...Array.from({ length: 9 }, (_, i) => night(hamburg, [many], 10 + i)),
      night(hamburg, [many], -3),
      night(berlin, [local], 2),
      night(berlin, [local], 3),
      night(berlin, [local], -2),
    ];
    const all = directoryEntries(
      { djs: [many, local], events: catalogEvents, venues },
      now,
    );
    // Overall, the DJ with 11 nights ranks first.
    expect(names(all)).toEqual(["Many Elsewhere", "Local Three"]);
    expect(names(filterDirectory(all, { city: city("berlin") }))).toEqual([
      "Local Three",
      "Many Elsewhere",
    ]);
  });

  it("ranks DJs who played the filtered city above DJs only booked there", () => {
    const booked = dj(12, "Booked Three");
    const played = dj(13, "Played Once");
    const catalogEvents = [
      night(berlin, [booked], 1),
      night(berlin, [booked], 2),
      night(berlin, [booked], 3),
      night(berlin, [played], -5),
    ];
    const all = directoryEntries(
      { djs: [booked, played], events: catalogEvents, venues },
      now,
    );
    expect(names(all)).toEqual(["Booked Three", "Played Once"]);
    expect(names(filterDirectory(all, { city: city("berlin") }))).toEqual([
      "Played Once",
      "Booked Three",
    ]);
  });
});

describe("directoryFacets", () => {
  const a = dj(1, "A", { genres: ["Techno", "House"] });
  const b = dj(2, "B", { genres: ["Hard Techno"] });
  const c = dj(3, "C", { genres: ["House"] });
  const events = [
    night(berlin, [a], 2),
    night(hamburg, [a, b], -4),
    night(hamburg, [c], 3),
  ];
  const entries = directoryEntries({ djs: [a, b, c], events, venues }, now);

  it("counts every facet without filters and orders them", () => {
    const facets = directoryFacets(entries, {});
    expect(
      facets.families.map((entry) => [entry.item.slug, entry.count]),
    ).toEqual([
      ["techno", 1],
      ["hard-techno", 1],
      ["house", 2],
    ]);
    expect(
      facets.genres.map((entry) => [entry.item.name, entry.count]),
    ).toEqual([
      ["House", 2],
      ["Hard Techno", 1],
      ["Techno", 1],
    ]);
    expect(
      facets.cities.map((entry) => [entry.item.slug, entry.count]),
    ).toEqual([
      ["hamburg", 3],
      ["berlin", 1],
    ]);
  });

  it("counts each facet against the other filters, not its own", () => {
    const facets = directoryFacets(entries, {
      genre: genre("House"),
      city: city("berlin"),
    });
    // Genre facet ignores the genre filter: only A plays Berlin.
    expect(facets.genres.map((entry) => entry.item.name).sort()).toEqual([
      "House",
      "Techno",
    ]);
    // City facet ignores the city filter: A and C are House DJs.
    expect(
      facets.cities.map((entry) => [entry.item.slug, entry.count]),
    ).toEqual([
      ["hamburg", 2],
      ["berlin", 1],
    ]);
    // Family facet ignores genre and family but honours the city.
    expect(
      facets.families.map((entry) => [entry.item.slug, entry.count]),
    ).toEqual([
      ["techno", 1],
      ["house", 1],
    ]);
  });

  it("omits zero counts", () => {
    const facets = directoryFacets(entries, { family: "hard-techno" });
    // Only B matches, and B has not played Berlin.
    expect(facets.cities.map((entry) => entry.item.slug)).toEqual(["hamburg"]);
    expect(facets.genres.map((entry) => entry.item.name)).toEqual([
      "Hard Techno",
    ]);
    for (const entry of [
      ...facets.families,
      ...facets.genres,
      ...facets.cities,
    ])
      expect(entry.count).toBeGreaterThan(0);
  });
});

describe("upcomingGenreEvents", () => {
  it("matches alias spellings and excludes past and cancelled nights", () => {
    const later = night(berlin, [], 8, { genres: ["Driving Techno"] });
    const soon = night(berlin, [], 2, { genres: ["Peak Time", "House"] });
    const past = night(berlin, [], -2, { genres: ["Peak Time Techno"] });
    const cancelled = night(berlin, [], 3, {
      genres: ["Peak Time Techno"],
      status: "cancelled",
    });
    const other = night(berlin, [], 4, { genres: ["House"] });
    const listed = upcomingGenreEvents(
      { events: [later, past, cancelled, other, soon], venues: [berlin] },
      genre("Peak Time Techno"),
      now,
    );
    expect(listed.map((event) => event.id)).toEqual([soon.id, later.id]);
  });
});
