import { describe, expect, it } from "vitest";
import type { Catalog, Dj, Event, Venue } from "../src/core/model";
import {
  addVote,
  bestSoundIndex,
  buildReels,
  likedNights,
  parseSound,
  rankListening,
  rankReels,
  readReelState,
  statedBpm,
  statedKey,
  tasteMatch,
  tasteOf,
  type ReelVote,
} from "../src/core/reels";
import { demoCatalog } from "../src/db/demo";

const baseVenue = demoCatalog.venues[0];
const baseDj = demoCatalog.djs[0];
const baseEvent = demoCatalog.events[0];
if (!baseVenue || !baseDj || !baseEvent)
  throw new Error("Demo catalog needs a venue, DJ and event");

const now = Date.parse("2026-10-26T12:00:00Z");
const uuid = (kind: number, n: number) =>
  `${kind}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const venue = (n: number, city: string): Venue => ({
  ...baseVenue,
  id: uuid(1, n),
  slug: `venue-${n}`,
  city,
  country: "Germany",
  timezone: "Europe/Berlin",
});
const dj = (n: number, genres: string[], soundcloud = true): Dj => ({
  ...baseDj,
  id: uuid(2, n),
  slug: `dj-${n}`,
  name: `DJ ${n}`,
  genres,
  soundcloudUrl: soundcloud ? `https://soundcloud.com/dj-${n}` : null,
});
let counter = 0;
const night = (
  where: Venue,
  djs: Dj[],
  days: number,
  over: Partial<Event> = {},
): Event => {
  counter += 1;
  return {
    ...baseEvent,
    id: uuid(3, counter),
    slug: `night-${counter}`,
    title: `Night ${counter}`,
    venueId: where.id,
    djIds: djs.map((entry) => entry.id),
    startsAt: new Date(now + days * 86_400_000).toISOString(),
    endsAt: null,
    genres: [],
    status: "scheduled",
    ...over,
  };
};

const koeln = venue(1, "Köln");
const berlin = venue(2, "Berlin");
const nowhere = venue(3, "Atlantis");
const hard = dj(1, ["Hard Techno"]);
const house = dj(2, ["Deep House"]);
const dub = dj(3, ["Dub Techno"]);
const silent = dj(4, ["Techno"], false);
const far = dj(5, ["Techno"]);
const lost = dj(6, ["Techno"]);
const catalog: Catalog = {
  mode: "demo",
  venues: [koeln, berlin, nowhere],
  djs: [hard, house, dub, silent, far, lost],
  events: [
    night(koeln, [hard, house], 3),
    night(koeln, [dub, silent], 5),
    night(berlin, [far], 4),
    night(nowhere, [lost], 6),
    night(koeln, [hard], 120),
    night(koeln, [house], -3),
    night(koeln, [house], 7, { status: "cancelled" }),
  ],
};
const reels = buildReels(catalog, now);
const vote = (djId: string, value: 1 | -1, genres: string[]): ReelVote => ({
  djId,
  value,
  genres,
  sound: null,
  at: now,
});

describe("buildReels", () => {
  it("keeps DJs with a SoundCloud profile and a scheduled night in the next 90 days", () => {
    expect(reels.map((reel) => reel.dj.name).sort()).toEqual([
      "DJ 1",
      "DJ 2",
      "DJ 3",
      "DJ 5",
      "DJ 6",
    ]);
    const hardReel = reels.find((reel) => reel.dj.id === hard.id);
    // The night 120 days out is beyond the window; the lineup names the other DJ.
    expect(hardReel?.events).toHaveLength(1);
    expect(hardReel?.events[0]?.lineup).toEqual(["DJ 2"]);
    const houseReel = reels.find((reel) => reel.dj.id === house.id);
    // Past and cancelled nights never make a reel.
    expect(houseReel?.events).toHaveLength(1);
  });
});

describe("rankReels", () => {
  it("filters by distance and leaves unknown places out of a radius", () => {
    const near = rankReels(
      reels,
      { origin: "de:koeln", radiusKm: 50 },
      [],
      1,
      now,
    );
    expect(near.reels.map((reel) => reel.dj.id).sort()).toEqual(
      [hard.id, house.id, dub.id].sort(),
    );
    expect(near.unlocated).toBe(1);
    expect(near.reels[0]?.events[0]?.distanceKm).toBe(0);
    const everywhere = rankReels(
      reels,
      { origin: "", radiusKm: null },
      [],
      1,
      now,
    );
    expect(everywhere.reels).toHaveLength(5);
    expect(everywhere.unlocated).toBe(0);
  });

  it("puts liked genres first and disliked DJs last", () => {
    const settings = { origin: "de:koeln", radiusKm: 50 };
    const liked = rankReels(
      reels,
      settings,
      [vote(dub.id, 1, ["Dub Techno"])],
      1,
      now,
    );
    expect(liked.reels[0]?.dj.id).toBe(dub.id);
    const disliked = rankReels(
      reels,
      settings,
      [vote(hard.id, -1, ["Hard Techno"])],
      1,
      now,
    );
    expect(disliked.reels.at(-1)?.dj.id).toBe(hard.id);
    expect(disliked.reels).toHaveLength(3);
  });

  it("learns from a liked sound's genres, not just the DJ", () => {
    // Liking a dub techno track by the hard techno DJ lifts the dub techno DJ
    // above the house DJ.
    const votes = [vote(hard.id, 1, ["Hard Techno", "Dub Techno"])];
    const ranked = rankReels(
      reels,
      { origin: "de:koeln", radiusKm: 50 },
      votes,
      1,
      now,
    ).reels.map((reel) => reel.dj.id);
    expect(ranked.indexOf(dub.id)).toBeLessThan(ranked.indexOf(house.id));
  });

  it("prefers DJs whose night is soon", () => {
    const later = dj(7, ["Techno"]);
    const sooner = dj(8, ["Techno"]);
    const soon = buildReels(
      {
        mode: "demo",
        venues: [koeln],
        djs: [later, sooner],
        events: [night(koeln, [later], 40), night(koeln, [sooner], 2)],
      },
      now,
    );
    for (const seed of [1, 2, 3])
      expect(
        rankReels(soon, { origin: "", radiusKm: null }, [], seed, now).reels[0]
          ?.dj.id,
      ).toBe(sooner.id);
  });

  it("collects the nights of liked DJs", () => {
    const ranked = rankReels(
      reels,
      { origin: "", radiusKm: null },
      [vote(hard.id, 1, []), vote(far.id, 1, [])],
      1,
      now,
    ).reels;
    expect(
      likedNights(ranked, [vote(hard.id, 1, []), vote(far.id, 1, [])]).map(
        ({ dj: artist }) => artist.id,
      ),
    ).toEqual([hard.id, far.id]);
  });
});

describe("sounds", () => {
  it("reads genres and tags from SoundCloud's widget payload", () => {
    const sound = parseSound({
      title: "Untitled",
      permalink_url: "https://soundcloud.com/someone/untitled",
      genre: "Dance - Techno",
      tag_list: 'Techno "deep techno" hypnotic dark',
      artwork_url: "https://i1.sndcdn.com/artworks-abc-large.jpg",
      duration: 354507,
    });
    expect(sound?.genres).toEqual(["Techno", "Deep Techno", "Hypnotic Techno"]);
    expect(sound?.tags).toEqual(["dance", "dark"]);
    expect(sound?.artworkUrl).toBe(
      "https://i1.sndcdn.com/artworks-abc-t500x500.jpg",
    );
    expect(
      parseSound({ title: "x", permalink_url: "https://evil.example/x" }),
    ).toBeNull();
  });

  it("only trusts keys and tempos the uploader states", () => {
    expect(statedKey("Peak [8A] 132 BPM")).toBe("8A");
    expect(statedKey("Key: 5a")).toBe("5A");
    expect(statedKey("Worakls – By The Brook in C minor")).toBe("5A");
    expect(statedKey("Tanz in C-Moll")).toBe("5A");
    // Ordinary words that look like keys.
    expect(statedKey("Karla Blum @ KitKat am 03.02.")).toBeNull();
    expect(statedKey("I Am Here")).toBeNull();
    expect(statedKey("Forced 2B Criminal")).toBeNull();
    expect(statedBpm("Peak [8A] 132 BPM")).toBe(132);
    expect(statedBpm("Set 2026")).toBeNull();
  });

  it("starts with the upload that fits the visitor best", () => {
    const sound = (genre: string) =>
      parseSound({
        title: genre,
        permalink_url: `https://soundcloud.com/a/${genre.replace(/\s/g, "-")}`,
        genre,
      });
    const sounds = [sound("Deep House"), null, sound("Dub Techno")];
    expect(bestSoundIndex(sounds, tasteOf([]))).toBe(0);
    expect(
      bestSoundIndex(sounds, tasteOf([vote(dub.id, 1, ["Dub Techno"])])),
    ).toBe(2);
  });
});

describe("stored state", () => {
  it("drops malformed entries and keeps one vote per sound", () => {
    const good = vote(hard.id, 1, ["Hard Techno"]);
    const state = readReelState({
      version: 1,
      settings: { origin: "de:koeln", radiusKm: 50 },
      votes: [good, { djId: 7 }, { ...good, value: -1, at: now - 1 }],
    });
    expect(state.settings).toEqual({ origin: "de:koeln", radiusKm: 50 });
    expect(state.votes).toEqual([good]);
    expect(readReelState("nonsense")).toEqual({ settings: null, votes: [] });
    expect(addVote([good], { ...good, value: -1 })).toHaveLength(1);
  });
});

describe("the same taste on the night map", () => {
  it("marks nights with a liked DJ and nights whose genres lean liked", () => {
    const taste = tasteOf([vote(hard.id, 1, ["Hard Techno"])]);
    expect(tasteMatch({ djIds: [hard.id], genres: [] }, taste)).toBe("liked");
    expect(
      tasteMatch({ djIds: [far.id], genres: ["Hard Techno"] }, taste),
    ).toBe("close");
    // One like is not enough to call a sibling genre of its family "close".
    expect(
      tasteMatch({ djIds: [far.id], genres: ["Schranz"] }, taste),
    ).toBeNull();
    expect(tasteMatch({ djIds: [house.id], genres: [] }, taste)).toBeNull();
  });

  it("orders DJs to listen to by taste, then by how soon they play, without disliked DJs", () => {
    const entry = (dj: typeof hard, genres: string[], days: number) => ({
      dj: {
        id: dj.id,
        slug: dj.slug,
        name: dj.name,
        soundcloudUrl: dj.soundcloudUrl ?? "",
      },
      genres,
      startsAt: new Date(now + days * 86_400_000).toISOString(),
    });
    const candidates = [
      entry(house, ["Deep House"], 2),
      entry(hard, ["Hard Techno"], 30),
      entry(dub, ["Dub Techno"], 20),
      entry(far, ["Techno"], 1),
    ];
    // No votes yet: the night this week comes first.
    expect(
      rankListening(candidates, [], now).map((item) => item.dj.id),
    ).toEqual([far.id, house.id, dub.id, hard.id]);
    const ranked = rankListening(
      candidates,
      [vote(hard.id, 1, ["Hard Techno"]), vote(house.id, -1, ["Deep House"])],
      now,
    ).map((item) => item.dj.id);
    expect(ranked[0]).toBe(hard.id);
    expect(ranked).not.toContain(house.id);
  });
});
