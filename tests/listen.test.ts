import { describe, expect, it } from "vitest";
import type { Catalog, Dj, Event, Venue } from "../src/core/model";
import { canonicalGenres } from "../src/core/genres";
import {
  DEFAULT_LISTEN_SETTINGS,
  LISTEN_STORAGE_KEY,
  buildListenCards,
  listenStateSchema,
  parseSoundMetadata,
  rankListenCards,
  readListenState,
  upsertFeedback,
  type ListenCard,
  type ListenEvent,
  type ListenFeedback,
  type ListenSettings,
  type SoundMetadata,
} from "../src/core/listen";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const DAY = 86_400_000;
const id = (group: number, number: number) =>
  `${group}0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const at = (days: number) => new Date(NOW + days * DAY).toISOString();

function venue(number = 1, overrides: Partial<Venue> = {}): Venue {
  return {
    id: id(1, number),
    slug: `venue-${number}`,
    name: `Venue ${number}`,
    city: "Berlin",
    country: "DE",
    address: "Test fixture",
    timezone: "Europe/Berlin",
    description: "Test fixture",
    imageUrl: null,
    instagramUrl: null,
    websiteUrl: null,
    soundcloudUrl: null,
    ...overrides,
  };
}
function artist(number = 1, overrides: Partial<Dj> = {}): Dj {
  return {
    id: id(2, number),
    slug: `artist-${number}`,
    name: `Artist ${number}`,
    description: "Test fixture",
    genres: ["Techno"],
    imageUrl: null,
    instagramUrl: null,
    websiteUrl: null,
    samplePostUrl: null,
    soundcloudUrl: `https://soundcloud.com/artist-${number}`,
    ...overrides,
  };
}
function event(number = 1, overrides: Partial<Event> = {}): Event {
  return {
    id: id(3, number),
    slug: `night-${number}`,
    title: `Night ${number}`,
    description: "Test fixture",
    venueId: id(1, 1),
    djIds: [id(2, 1)],
    startsAt: at(1),
    endsAt: at(1.25),
    genres: ["House"],
    imageUrl: null,
    ticketUrl: null,
    websiteUrl: null,
    sourceUrl: `https://www.instagram.com/p/FIXTURE${number}/`,
    observedAt: at(-1),
    status: "scheduled",
    ...overrides,
  };
}
function catalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    mode: "database",
    venues: [venue()],
    djs: [artist()],
    events: [event()],
    ...overrides,
  };
}
function listing(
  number = 1,
  overrides: Partial<ListenEvent> = {},
): ListenEvent {
  return {
    id: id(3, number),
    slug: `night-${number}`,
    title: `Night ${number}`,
    startsAt: at(1),
    endsAt: at(1.25),
    timezone: "Europe/Berlin",
    city: "Berlin",
    country: "DE",
    venueName: "Fixture Venue",
    ticketUrl: null,
    ...overrides,
  };
}
function card(number = 1, overrides: Partial<ListenCard> = {}): ListenCard {
  return {
    artist: {
      id: id(2, number),
      slug: `artist-${number}`,
      name: `Artist ${number}`,
      soundcloudUrl: `https://soundcloud.com/artist-${number}`,
    },
    genres: ["Techno"],
    events: [listing(number)],
    ...overrides,
  };
}
function sound(
  number = 1,
  overrides: Partial<SoundMetadata> = {},
): SoundMetadata {
  return {
    id: String(number),
    title: `Sound ${number}`,
    permalinkUrl: `https://soundcloud.com/artist-${number}/sound-${number}`,
    bpm: null,
    key: null,
    ...overrides,
  };
}
function vote(
  number = 1,
  overrides: Partial<ListenFeedback> = {},
): ListenFeedback {
  return {
    artistId: id(2, number),
    value: 1,
    genres: ["Techno"],
    sound: null,
    updatedAt: NOW,
    ...overrides,
  };
}
const berlin: ListenSettings = { origin: "de:berlin", radiusKm: 100, days: 30 };

describe("SoundCloud metadata boundary", () => {
  const raw = {
    id: 123,
    title: "  Fixture sound  ",
    permalink_url:
      "https://soundcloud.com/test-artist/test-sound?utm_source=widget#play",
  };

  it("normalizes IDs and permalinks and reads only explicit recognizable optional values", () => {
    expect(
      parseSoundMetadata({
        ...raw,
        bpm: "128.5",
        key_signature: "A minor",
        ignored: "extra widget field",
      }),
    ).toEqual({
      id: "123",
      title: "Fixture sound",
      permalinkUrl: "https://soundcloud.com/test-artist/test-sound",
      bpm: 128.5,
      key: "8A",
    });
    expect(
      parseSoundMetadata({
        ...raw,
        urn: "soundcloud:tracks:987",
        bpm: 140,
        key_signature: "B-Dur",
      }),
    ).toMatchObject({ id: "soundcloud:tracks:987", bpm: 140, key: "6B" });
    expect(parseSoundMetadata({ ...raw, id: "123", key: "11A" })?.key).toBe(
      "11A",
    );
  });

  it("keeps sound identity while absent or unrecognizable BPM/key remain null", () => {
    for (const extra of [
      {},
      { bpm: null, key_signature: null },
      { bpm: -10, key_signature: "B" },
      { bpm: 401, key_signature: 8 },
      { bpm: "128 BPM", key_signature: "A dorian" },
      { bpm: Number.NaN, key_signature: {} },
      { bpm: Number.POSITIVE_INFINITY, key_signature: "13A" },
    ])
      expect(parseSoundMetadata({ ...raw, ...extra })).toMatchObject({
        id: "123",
        bpm: null,
        key: null,
      });
  });

  it.each([
    "javascript:alert(1)",
    "https://evil.test/test/sound",
    "https://soundcloud.com.evil.test/test/sound",
    "https://user:pass@soundcloud.com/test/sound",
    "http://soundcloud.com/test/sound",
    "https://soundcloud.com:444/test/sound",
    "https://soundcloud.com/test",
    "https://soundcloud.com/test/sets/set-name",
    "https://soundcloud.com/test/sets",
    "https://soundcloud.com/discover/sound",
    "https://soundcloud.com/test//sound",
  ])("rejects an unsafe or non-sound permalink %s", (permalink_url) => {
    expect(parseSoundMetadata({ ...raw, permalink_url })).toBeNull();
  });

  it("rejects incomplete identity, invalid IDs, and arbitrary payloads without throwing", () => {
    for (const value of [
      null,
      undefined,
      [],
      "text",
      {},
      { ...raw, title: " " },
      { ...raw, permalink_url: undefined },
      ...[
        0,
        -1,
        1.2,
        Number.MAX_SAFE_INTEGER + 1,
        "track",
        "soundcloud:users:123",
        "soundcloud:playlists:123",
      ].map((id) => ({ ...raw, id })),
    ])
      expect(parseSoundMetadata(value)).toBeNull();
  });
});

describe("local listening state", () => {
  it("accepts only the versioned object and falls back safely for corrupt storage", () => {
    expect(LISTEN_STORAGE_KEY).toBeTruthy();
    const defaults = { settings: DEFAULT_LISTEN_SETTINGS, feedback: [] };
    for (const value of [
      null,
      undefined,
      [],
      "{broken",
      JSON.stringify({ version: 1, settings: berlin, feedback: [] }),
      { version: 2, settings: berlin, feedback: [] },
    ]) {
      expect(readListenState(value)).toEqual(defaults);
    }
    expect(
      readListenState({ version: 1, settings: berlin, feedback: [vote()] }),
    ).toEqual({ settings: berlin, feedback: [vote()] });
  });

  it("drops malformed entries without converting a bad sound vote into artist feedback", () => {
    const state = readListenState({
      version: 1,
      settings: { origin: "de:berlin", radiusKm: -100, days: 14 },
      feedback: [
        vote(),
        { ...vote(2), value: 0 },
        {
          ...vote(3),
          sound: { ...sound(), permalinkUrl: "javascript:alert(1)" },
        },
        null,
      ],
    });
    expect(state.settings).toEqual(DEFAULT_LISTEN_SETTINGS);
    expect(state.feedback).toEqual([vote()]);
  });

  it("updates a vote instead of accumulating likes and never lets an older response overwrite it", () => {
    const previous = [vote()];
    const disliked = vote(1, { value: -1, updatedAt: NOW + 1 });
    const next = upsertFeedback(previous, disliked);
    expect(next).toEqual([disliked]);
    expect(upsertFeedback(next, vote())).toEqual([disliked]);
    expect(upsertFeedback(next, disliked)).toEqual([disliked]);
    expect(previous).toEqual([vote()]);
  });

  it("keeps distinct sounds and artist feedback scoped, with legacy IDs matching new URNs", () => {
    let state = upsertFeedback([], vote(1, { sound: sound(1) }));
    state = upsertFeedback(
      state,
      vote(2, {
        sound: sound(1, { id: "soundcloud:tracks:1" }),
        value: -1,
        updatedAt: NOW + 1,
      }),
    );
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ artistId: id(2, 2), value: -1 });
    state = upsertFeedback(state, vote(2, { sound: sound(2) }));
    state = upsertFeedback(state, vote(2));
    expect(state).toHaveLength(3);
  });

  it("restores only the newest 300 entries and has a bounded persisted schema", () => {
    const feedback = Array.from({ length: 350 }, (_, index) =>
      vote(index + 1, { updatedAt: NOW + index }),
    );
    const state = readListenState({ version: 1, settings: berlin, feedback });
    expect(state.feedback).toHaveLength(300);
    expect(state.feedback[0]?.updatedAt).toBe(NOW + 349);
    expect(state.feedback.at(-1)?.updatedAt).toBe(NOW + 50);
    expect(listenStateSchema.safeParse({ version: 1, ...state }).success).toBe(
      true,
    );
    expect(
      listenStateSchema.safeParse({ version: 1, settings: berlin, feedback })
        .success,
    ).toBe(false);
    expect(
      upsertFeedback(state.feedback, vote(351, { updatedAt: NOW + 350 })),
    ).toHaveLength(300);
  });
});

describe("catalogue to listening cards", () => {
  it("requires a valid artist profile and an actual upcoming scheduled event within 90 days", () => {
    const data = catalog({
      djs: [
        artist(),
        artist(2, { soundcloudUrl: null }),
        artist(3, { soundcloudUrl: "https://evil.test/profile" }),
        artist(4),
      ],
      events: [
        event(1, { djIds: [id(2, 1), id(2, 2), id(2, 3), id(2, 99)] }),
        event(2, { status: "cancelled" }),
        event(3, { startsAt: at(-2), endsAt: at(-1) }),
        event(4, { startsAt: at(91), endsAt: at(91.25) }),
        event(5, { venueId: id(1, 999) }),
        event(6, { djIds: [id(2, 4)], startsAt: at(-2), endsAt: at(-1) }),
      ],
    });
    const cards = buildListenCards(data, NOW);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.artist.id).toBe(id(2, 1));
    expect(cards[0]?.events.map(({ id }) => id)).toEqual([id(3, 1)]);
  });

  it("includes running overnight events and respects the venue's 9am fallback across DST", () => {
    const data = catalog({
      events: [
        event(1, { startsAt: "2026-10-24T23:00:00+02:00", endsAt: null }),
      ],
    });
    expect(
      buildListenCards(data, Date.parse("2026-10-25T08:59:59+01:00")),
    ).toHaveLength(1);
    expect(
      buildListenCards(data, Date.parse("2026-10-25T09:00:00+01:00")),
    ).toEqual([]);
    const running = catalog({
      events: [event(1, { startsAt: at(-0.1), endsAt: at(0.1) })],
    });
    expect(buildListenCards(running, NOW)).toHaveLength(1);
    expect(buildListenCards(running, NOW + DAY * 0.1)).toEqual([]);
  });

  it("uses canonical artist genres, with a fallback only to eligible event genres", () => {
    const data = catalog({
      djs: [
        artist(1, { genres: ["Driving Techno", "Peak Time Techno"] }),
        artist(2, { genres: [] }),
        artist(3, { genres: [] }),
      ],
      events: [
        event(1, {
          djIds: [id(2, 1), id(2, 2)],
          genres: ["DnB", "Drum and Bass", "not a genre"],
        }),
        event(2, { djIds: [id(2, 2)], genres: ["House"], status: "cancelled" }),
        event(3, { djIds: [id(2, 3)], genres: [] }),
      ],
    });
    const cards = buildListenCards(data, NOW);
    expect(cards.find(({ artist }) => artist.id === id(2, 1))?.genres).toEqual([
      "Peak Time Techno",
    ]);
    expect(cards.find(({ artist }) => artist.id === id(2, 2))?.genres).toEqual([
      "Drum & Bass",
    ]);
    expect(cards.find(({ artist }) => artist.id === id(2, 3))?.genres).toEqual(
      [],
    );
  });

  it("deduplicates lineup/events, orders events by time, and leaves the input untouched", () => {
    const later = event(2, { startsAt: at(5), endsAt: at(5.2) });
    const earlier = event(1, { djIds: [id(2, 1), id(2, 1)] });
    const data = catalog({ events: [later, earlier, earlier] });
    const before = structuredClone(data);
    expect(buildListenCards(data, NOW)[0]?.events.map(({ id }) => id)).toEqual([
      id(3, 1),
      id(3, 2),
    ]);
    expect(data).toEqual(before);
  });

  it("can save feedback for an artist inheriting more than 20 distinct event genres", () => {
    const genres = canonicalGenres.slice(0, 25).map(({ name }) => name);
    const data = catalog({
      djs: [artist(1, { genres: [] })],
      events: [
        event(1, { genres: genres.slice(0, 20) }),
        event(2, { genres: genres.slice(20) }),
      ],
    });
    const built = buildListenCards(data, NOW)[0];
    expect(built?.genres).toEqual(genres);
    expect(
      upsertFeedback([], vote(1, { genres: built?.genres ?? [] }))[0]?.genres,
    ).toEqual(genres);
  });
});

describe("geography and time before musical ranking", () => {
  it("filters each event, even for a favourite artist, before ranking", () => {
    const cards = [
      card(1, { events: [listing(1, { city: "Hamburg" })] }),
      card(2),
    ];
    expect(
      rankListenCards(cards, berlin, [vote(1)], NOW).cards.map(
        ({ artist }) => artist.id,
      ),
    ).toEqual([id(2, 2)]);
    expect(
      rankListenCards(cards, { ...berlin, radiusKm: 500 }, [vote(1)], NOW)
        .cards[0]?.artist.id,
    ).toBe(id(2, 1));
    const mixed = rankListenCards(
      [
        card(1, {
          events: [
            listing(1),
            listing(2, { city: "Hamburg" }),
            listing(3, { startsAt: at(31), endsAt: at(31.1) }),
          ],
        }),
      ],
      berlin,
      [],
      NOW,
    );
    expect(mixed.cards[0]?.events.map(({ id }) => id)).toEqual([id(3, 1)]);
    expect(mixed.cards[0]?.events[0]?.distanceKm).toBe(0);
  });

  it("counts distinct unknown events in the time window and never puts them inside the radius", () => {
    const unknown = listing(99, { city: "Unknown City" });
    const wrongCountry = listing(98, { city: "Berlin", country: "US" });
    const cards = [
      card(1, { events: [listing(1), unknown, wrongCountry] }),
      card(2, { events: [unknown] }),
      card(3, {
        events: [
          listing(97, {
            city: "Unknown City",
            startsAt: at(40),
            endsAt: at(40.2),
          }),
        ],
      }),
    ];
    const nearby = rankListenCards(cards, berlin, [], NOW);
    expect(nearby.unlocatedEventCount).toBe(2);
    expect(nearby.cards).toHaveLength(1);
    expect(nearby.cards[0]?.events).toHaveLength(1);
    const everywhere = rankListenCards(cards, DEFAULT_LISTEN_SETTINGS, [], NOW);
    expect(everywhere.cards).toHaveLength(2);
    expect(
      everywhere.cards
        .flatMap(({ events }) => events)
        .find(({ id }) => id === unknown.id)?.distanceKm,
    ).toBeNull();
  });

  it("uses both country and city and recognizes known localized names", () => {
    const cards = [
      card(1, {
        events: [listing(1, { city: "Muenchen", country: "Germany" })],
      }),
    ];
    expect(
      rankListenCards(
        cards,
        { ...berlin, origin: "de:muenchen", radiusKm: 25 },
        [],
        NOW,
      ).cards[0]?.events[0]?.distanceKm,
    ).toBe(0);
  });

  it("does not turn an invalid nonempty origin or radius into an everywhere search", () => {
    expect(
      rankListenCards([card()], { ...berlin, origin: "de:invented" }, [], NOW)
        .cards,
    ).toEqual([]);
    expect(
      rankListenCards([card()], { ...berlin, radiusKm: -1 }, [], NOW).cards,
    ).toEqual([]);
    const restored = readListenState({
      version: 1,
      settings: { ...berlin, origin: "de:removed" },
      feedback: [],
    });
    expect(restored.settings.origin).toBe("de:removed");
    expect(rankListenCards([card()], restored.settings, [], NOW).cards).toEqual(
      [],
    );
  });

  it("rechecks time on ranking, including running events, seven-day boundary, and open-ended cutoffs", () => {
    const cards = [
      card(1, {
        events: [
          listing(1, { startsAt: at(-0.1), endsAt: at(0.1) }),
          listing(2, { startsAt: at(-1), endsAt: at(-0.5) }),
          listing(3, { startsAt: at(7), endsAt: at(7.1) }),
          listing(4, {
            startsAt: at(7).replace("12:00:00", "12:00:01"),
            endsAt: at(7.1),
          }),
          listing(5, { startsAt: at(-2), endsAt: null }),
        ],
      }),
    ];
    expect(
      rankListenCards(
        cards,
        { ...berlin, days: 7 },
        [],
        NOW,
      ).cards[0]?.events.map(({ id }) => id),
    ).toEqual([id(3, 1), id(3, 3)]);
  });
});

describe("explicit preference ranking", () => {
  it("ranks a liked artist, then shared and related genres without inventing match percentages", () => {
    const cards = [
      card(1, { genres: ["House"] }),
      card(2, { genres: ["Techno"] }),
      card(3, { genres: ["Hypnotic Techno"] }),
      card(4, { genres: ["Ambient"] }),
    ];
    const feedback = [
      vote(1, { genres: ["House"] }),
      vote(20, { genres: ["Techno"] }),
    ];
    const result = rankListenCards(
      cards,
      DEFAULT_LISTEN_SETTINGS,
      feedback,
      NOW,
    ).cards;
    expect(result[0]?.artist.id).toBe(id(2, 1));
    expect(result.find(({ artist }) => artist.id === id(2, 1))?.reason).toBe(
      "artist",
    );
    expect(result.find(({ artist }) => artist.id === id(2, 2))?.reason).toBe(
      "genre",
    );
    expect(result.find(({ artist }) => artist.id === id(2, 3))?.reason).toBe(
      "genre",
    );
    expect(result.find(({ artist }) => artist.id === id(2, 4))?.reason).toBe(
      "discover",
    );
    expect(result.every(({ score }) => Number.isFinite(score))).toBe(true);
  });

  it("downranks a disliked sample without banning the artist, and artist feedback can reverse it", () => {
    const cards = [card(1), card(2)];
    const feedback = [vote(1, { value: -1, sound: sound(1) })];
    const result = rankListenCards(
      cards,
      DEFAULT_LISTEN_SETTINGS,
      feedback,
      NOW,
    ).cards;
    expect(result).toHaveLength(2);
    expect(result[0]?.artist.id).toBe(id(2, 2));
    const explicit = upsertFeedback(feedback, vote(1, { updatedAt: NOW + 1 }));
    expect(
      rankListenCards(cards, DEFAULT_LISTEN_SETTINGS, explicit, NOW).cards[0]
        ?.artist.id,
    ).toBe(id(2, 1));
  });

  it("does not inflate preferences from repeated votes or one artist's many liked sounds", () => {
    const cards = [card(1), card(2, { genres: ["House"] })];
    const one = [vote(30, { sound: sound(1) })];
    const many = Array.from({ length: 30 }, (_, index) =>
      vote(30, { sound: sound(index + 1) }),
    );
    expect(rankListenCards(cards, DEFAULT_LISTEN_SETTINGS, one, NOW)).toEqual(
      rankListenCards(cards, DEFAULT_LISTEN_SETTINGS, many, NOW),
    );
    expect(
      rankListenCards(
        cards,
        DEFAULT_LISTEN_SETTINGS,
        [vote(), vote(), vote()],
        NOW,
      ),
    ).toEqual(rankListenCards(cards, DEFAULT_LISTEN_SETTINGS, [vote()], NOW));
  });

  it("makes deterministic room for new and unknown genres while retaining all candidates", () => {
    const preferred = Array.from({ length: 8 }, (_, index) => card(index + 1));
    const cards = [
      ...preferred,
      card(9, { genres: [] }),
      card(10, { genres: ["Future unfamiliar genre"] }),
      card(11, { genres: ["Ambient"] }),
    ];
    const feedback = [vote(40)];
    const result = rankListenCards(
      cards,
      DEFAULT_LISTEN_SETTINGS,
      feedback,
      NOW,
    );
    expect(result.cards).toHaveLength(cards.length);
    expect(result.cards[3]?.reason).toBe("discover");
    expect(result.cards.some(({ genres }) => genres.length === 0)).toBe(true);
    expect(
      result.cards.some(({ genres }) =>
        genres.includes("Future unfamiliar genre"),
      ),
    ).toBe(true);
    expect(
      rankListenCards(
        [...cards].reverse(),
        DEFAULT_LISTEN_SETTINGS,
        feedback,
        NOW,
      ),
    ).toEqual(result);
    const before = structuredClone(cards);
    rankListenCards(cards, DEFAULT_LISTEN_SETTINGS, feedback, NOW);
    expect(cards).toEqual(before);
  });

  it("does not turn distance or event timing into musical affinity", () => {
    const base = rankListenCards(
      [card()],
      { ...berlin, radiusKm: 500 },
      [vote(1)],
      NOW,
    ).cards[0];
    const moved = rankListenCards(
      [
        card(1, {
          events: [
            listing(1, { city: "Hamburg", startsAt: at(20), endsAt: at(20.1) }),
          ],
        }),
      ],
      { ...berlin, radiusKm: 500 },
      [vote(1)],
      NOW,
    ).cards[0];
    expect(moved?.score).toBe(base?.score);
    expect(moved?.reason).toBe(base?.reason);
  });
});
