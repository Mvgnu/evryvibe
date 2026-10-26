import { z } from "zod";
import { isUpcoming } from "./cities";
import { canonicalGenre, genreKey, normalizeGenres } from "./genres";
import { distanceKm, locationById, locationFor } from "./locations";
import {
  camelotKeySchema,
  compatibleKeys,
  parseMusicalKey,
} from "./musical-key";
import type { CamelotKey } from "./musical-key";
import type { Catalog } from "./model";
import { posterSeed } from "./sound";
import { soundcloudProfileSchema } from "./soundcloud";

// Reels: one DJ with a verified SoundCloud profile and an upcoming night per
// reel. SoundCloud's own widget plays the profile; the visitor's likes stay on
// their device and reorder what comes next. Nothing about tracks is stored on
// the server.

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 90;
const MAX_VOTES = 300;

export type ReelEvent = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  venueName: string;
  venueSlug: string;
  city: string;
  country: string;
  ticketUrl: string | null;
  /** Other known lineup names, in billing order. */
  lineup: string[];
};

export type Reel = {
  dj: { id: string; slug: string; name: string; soundcloudUrl: string };
  /** Canonical genres: the DJ profile's, else those of their nights. */
  genres: string[];
  events: ReelEvent[];
};

export type RankedReel = Omit<Reel, "events"> & {
  events: (ReelEvent & { distanceKm: number | null })[];
  score: number;
};

/** Every DJ with a SoundCloud profile and a scheduled night in the next 90 days. */
export function buildReels(catalog: Catalog, now: number): Reel[] {
  const venues = new Map(catalog.venues.map((venue) => [venue.id, venue]));
  const djs = new Map(catalog.djs.map((dj) => [dj.id, dj]));
  const byDj = new Map<string, { events: ReelEvent[]; genres: string[] }>();
  for (const event of catalog.events) {
    const venue = venues.get(event.venueId);
    if (
      !venue ||
      event.status !== "scheduled" ||
      Date.parse(event.startsAt) > now + WINDOW_DAYS * DAY_MS ||
      !isUpcoming(event, now, venue.timezone)
    )
      continue;
    const ids = [...new Set(event.djIds)];
    for (const djId of ids) {
      const entry = byDj.get(djId) ?? { events: [], genres: [] };
      entry.events.push({
        id: event.id,
        slug: event.slug,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: venue.timezone,
        venueName: venue.name,
        venueSlug: venue.slug,
        city: venue.city,
        country: venue.country,
        ticketUrl: event.ticketUrl,
        lineup: ids
          .filter((id) => id !== djId)
          .flatMap((id) => djs.get(id)?.name ?? []),
      });
      entry.genres.push(...event.genres);
      byDj.set(djId, entry);
    }
  }
  const reels: Reel[] = [];
  for (const [djId, entry] of byDj) {
    const dj = djs.get(djId);
    const profile = soundcloudProfileSchema.safeParse(dj?.soundcloudUrl);
    if (!dj || !profile.success) continue;
    const own = normalizeGenres(dj.genres).genres;
    reels.push({
      dj: {
        id: dj.id,
        slug: dj.slug,
        name: dj.name,
        soundcloudUrl: profile.data,
      },
      genres: own.length ? own : normalizeGenres(entry.genres).genres,
      events: entry.events.sort(
        (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
      ),
    });
  }
  return reels.sort((a, b) => a.dj.id.localeCompare(b.dj.id, "en"));
}

// ─── What the SoundCloud widget tells us about the sound that is playing ───

const widgetSoundSchema = z.object({
  title: z.string().min(1).max(500),
  permalink_url: z.string().max(1000),
  genre: z.string().max(200).nullish(),
  tag_list: z.string().max(2000).nullish(),
  description: z.string().max(20000).nullish(),
  artwork_url: z.string().max(1000).nullish(),
  duration: z.number().nonnegative().nullish(),
});

export type Sound = {
  title: string;
  url: string;
  artworkUrl: string | null;
  durationMs: number | null;
  /** Canonical genres named by the uploader's genre field and tags. */
  genres: string[];
  /** Comparison keys of the other tags ("dark", "hypnotic"). */
  tags: string[];
  /** Only when the uploader wrote it explicitly. */
  key: CamelotKey | null;
  bpm: number | null;
};

function soundcloudUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["soundcloud.com", "www.soundcloud.com"].includes(url.hostname)
      ? `https://soundcloud.com${url.pathname}`
      : null;
  } catch {
    return null;
  }
}

function artwork(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".sndcdn.com"))
      return null;
    // SoundCloud serves the same artwork at 500px under this name.
    url.pathname = url.pathname.replace(/-large(\.\w+)$/, "-t500x500$1");
    return url.toString();
  } catch {
    return null;
  }
}

/** SoundCloud tags: words, with "quoted phrases" kept together. */
export function splitTags(tagList: string): string[] {
  const tags: string[] = [];
  for (const match of tagList.matchAll(/"([^"]+)"|(\S+)/g)) {
    const tag = (match[1] ?? match[2] ?? "").trim();
    if (tag) tags.push(tag);
  }
  return tags;
}

/**
 * A key or tempo only when the uploader states it: "[8A]", "Key: 5A",
 * "A minor", "C-Moll", "128 BPM". "Am" or a bare "2B" stay unknown because
 * they are ordinary words in titles.
 */
export function statedKey(text: string): CamelotKey | null {
  const camelot = /(?:[[(]|\bkey[:\s]+)\s*((?:1[0-2]|[1-9])[ab])\b/i.exec(text);
  if (camelot?.[1]) return parseMusicalKey(camelot[1]);
  const english = /\b([A-G][#b♯♭]?)\s(minor|major)\b/.exec(text);
  if (english) return parseMusicalKey(`${english[1]} ${english[2]}`);
  const german = /\b([A-H](?:is|es|s)?)-(Moll|Dur)\b/.exec(text);
  if (german) return parseMusicalKey(`${german[1]}-${german[2]}`);
  return null;
}

export function statedBpm(text: string): number | null {
  const match = /\b(\d{2,3})\s?bpm\b/i.exec(text);
  const bpm = match?.[1] ? Number(match[1]) : NaN;
  return bpm >= 60 && bpm <= 220 ? bpm : null;
}

export function parseSound(value: unknown): Sound | null {
  const parsed = widgetSoundSchema.safeParse(value);
  if (!parsed.success) return null;
  const sound = parsed.data;
  const url = soundcloudUrl(sound.permalink_url);
  if (!url) return null;
  const terms = [
    ...(sound.genre ?? "").split(/\s+[-/]\s+|\s*\/\s*/),
    ...splitTags(sound.tag_list ?? ""),
  ].filter(Boolean);
  const genres = new Set<string>();
  const tags = new Set<string>();
  for (const term of terms) {
    const genre = canonicalGenre(term);
    if (genre) genres.add(genre.name);
    else {
      const key = genreKey(term);
      if (key.length >= 2 && key.length <= 40) tags.add(key);
    }
  }
  const text = `${sound.title}\n${sound.description ?? ""}`;
  return {
    title: sound.title,
    url,
    artworkUrl: artwork(sound.artwork_url),
    durationMs: sound.duration ?? null,
    genres: [...genres].slice(0, 20),
    tags: [...tags].slice(0, 20),
    key: statedKey(text),
    bpm: statedBpm(text),
  };
}

// ─── The visitor's settings and votes (stored on their device) ───

export const reelSettingsSchema = z
  .object({
    /** A location id from `src/core/locations.ts`, or "" for everywhere. */
    origin: z.string().max(100),
    /** null: any distance. */
    radiusKm: z.number().int().min(5).max(2000).nullable(),
  })
  .strict();
export type ReelSettings = z.infer<typeof reelSettingsSchema>;
export const RADIUS_CHOICES = [25, 50, 100, 250, null] as const;

const voteSchema = z
  .object({
    djId: z.string().min(1).max(100),
    value: z.union([z.literal(1), z.literal(-1)]),
    genres: z.array(z.string().min(1).max(100)).max(40),
    sound: z
      .object({
        url: z.string().min(1).max(1000),
        tags: z.array(z.string().min(1).max(40)).max(20),
        key: camelotKeySchema.nullable(),
      })
      .strict()
      .nullable(),
    at: z.number().int().nonnegative(),
  })
  .strict();
export type ReelVote = z.infer<typeof voteSchema>;

export type ReelState = { settings: ReelSettings | null; votes: ReelVote[] };
export const REEL_STORAGE_KEY = "evryvibe.reels.v1";

const voteKey = (vote: ReelVote) => vote.sound?.url ?? `dj:${vote.djId}`;

/** Newest vote per sound (or per DJ when no sound was known), at most 300. */
export function addVote(
  votes: readonly ReelVote[],
  vote: ReelVote,
): ReelVote[] {
  const key = voteKey(vote);
  return [vote, ...votes.filter((entry) => voteKey(entry) !== key)].slice(
    0,
    MAX_VOTES,
  );
}

/** Reads parsed JSON from storage; anything malformed is dropped, not fatal. */
export function readReelState(value: unknown): ReelState {
  const envelope = z
    .object({
      version: z.literal(1),
      settings: z.unknown(),
      votes: z.array(z.unknown()).max(MAX_VOTES * 4),
    })
    .safeParse(value);
  if (!envelope.success) return { settings: null, votes: [] };
  const settings = reelSettingsSchema.safeParse(envelope.data.settings);
  const votes = envelope.data.votes
    .flatMap((entry) => {
      const vote = voteSchema.safeParse(entry);
      return vote.success ? [vote.data] : [];
    })
    .sort((a, b) => b.at - a.at)
    .reduce<ReelVote[]>(
      (kept, vote) =>
        kept.some((entry) => voteKey(entry) === voteKey(vote))
          ? kept
          : [...kept, vote],
      [],
    )
    .slice(0, MAX_VOTES);
  return { settings: settings.success ? settings.data : null, votes };
}

// ─── Taste ───

export type Taste = {
  djs: Map<string, number>;
  genres: Map<string, number>;
  families: Map<string, number>;
  tags: Map<string, number>;
  keys: Set<CamelotKey>;
};

const clamp = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value));

/** Likes count fully, dislikes a little less: one bad track is not a ban. */
export function tasteOf(votes: readonly ReelVote[]): Taste {
  const djs = new Map<string, number>();
  const genres = new Map<string, number>();
  const tags = new Map<string, number>();
  const keys = new Set<CamelotKey>();
  const add = (map: Map<string, number>, key: string, amount: number) =>
    map.set(key, (map.get(key) ?? 0) + amount);
  for (const vote of votes) {
    const weight = vote.value === 1 ? 1 : -0.6;
    add(djs, vote.djId, vote.value);
    for (const genre of vote.genres) add(genres, genre, weight);
    for (const tag of vote.sound?.tags ?? []) add(tags, tag, weight);
    if (vote.value === 1 && vote.sound?.key) keys.add(vote.sound.key);
  }
  const families = new Map<string, number>();
  for (const [name, weight] of genres) {
    genres.set(name, clamp(weight, 4));
    const family = canonicalGenre(name)?.family;
    if (family) add(families, family, weight / 2);
  }
  for (const [family, weight] of families)
    families.set(family, clamp(weight, 3));
  for (const [tag, weight] of tags) tags.set(tag, clamp(weight, 2));
  return { djs, genres, families, tags, keys };
}

function genreAffinity(genres: readonly string[], taste: Taste): number {
  if (!genres.length) return 0;
  const exact = genres.map((genre) => taste.genres.get(genre) ?? 0);
  const family = genres.map((genre) => {
    const slug = canonicalGenre(genre)?.family;
    return slug ? (taste.families.get(slug) ?? 0) : 0;
  });
  return (
    Math.max(0, ...exact) +
    Math.min(0, ...exact) +
    0.5 * (Math.max(0, ...family) + Math.min(0, ...family))
  );
}

export function reelScore(reel: Pick<Reel, "dj" | "genres">, taste: Taste) {
  return (
    2.5 * clamp(taste.djs.get(reel.dj.id) ?? 0, 2) +
    genreAffinity(reel.genres, taste)
  );
}

/** How well one of a DJ's uploads fits: decides which upload plays first. */
export function soundScore(sound: Sound, taste: Taste): number {
  const tags = sound.tags.reduce(
    (sum, tag) => sum + 0.3 * (taste.tags.get(tag) ?? 0),
    0,
  );
  const key = sound.key;
  const harmonic =
    key && [...taste.keys].some((liked) => compatibleKeys(liked).includes(key))
      ? 1
      : 0;
  return genreAffinity(sound.genres, taste) + clamp(tags, 2) + harmonic;
}

/** Index of the best-fitting sound; the newest upload wins ties. */
export function bestSoundIndex(
  sounds: readonly (Sound | null)[],
  taste: Taste,
): number {
  let best = 0;
  let bestScore = -Infinity;
  sounds.forEach((sound, index) => {
    if (!sound) return;
    const score = soundScore(sound, taste);
    if (score > bestScore + 0.01) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

// ─── Ranking ───

/** Going out is about soon: a night this week counts, the next week a bit. */
function soonness(events: readonly ReelEvent[], now: number): number {
  const first = events[0];
  if (!first) return 0;
  const days = (Date.parse(first.startsAt) - now) / DAY_MS;
  return days <= 7 ? 0.6 : days <= 14 ? 0.3 : 0;
}

/** A stable per-visit shuffle so equal reels do not always come in id order. */
function jitter(seed: number, id: string): number {
  return ((posterSeed(`${seed}:${id}`) % 1000) / 1000) * 0.2;
}

/**
 * Distance filters the pool; taste and how soon the next night is order it. Every fourth place goes to a
 * reel the visitor has no opinion on yet, so the feed keeps discovering, and
 * consecutive reels avoid repeating the same night.
 * Disliked DJs sink to the end instead of disappearing.
 */
export function rankReels(
  reels: readonly Reel[],
  settings: ReelSettings,
  votes: readonly ReelVote[],
  seed: number,
  now: number,
): { reels: RankedReel[]; unlocated: number } {
  const origin = settings.origin ? locationById(settings.origin) : undefined;
  const radius = origin ? settings.radiusKm : null;
  const unlocated = new Set<string>();
  const taste = tasteOf(votes);
  const pool: RankedReel[] = [];
  for (const reel of reels) {
    const events = reel.events.flatMap((event) => {
      const place = locationFor(event.city, event.country);
      if (!place) unlocated.add(event.id);
      const distance =
        origin && place ? Math.round(distanceKm(origin, place)) : null;
      if (radius !== null && (distance === null || distance > radius))
        return [];
      return [{ ...event, distanceKm: distance }];
    });
    if (!events.length) continue;
    pool.push({
      ...reel,
      events,
      score: reelScore(reel, taste) + soonness(events, now),
    });
  }
  const order = (a: RankedReel, b: RankedReel) =>
    b.score + jitter(seed, b.dj.id) - (a.score + jitter(seed, a.dj.id));
  const disliked = (reel: RankedReel) => (taste.djs.get(reel.dj.id) ?? 0) < 0;
  const ranked = pool.filter((reel) => !disliked(reel)).sort(order);
  const result: RankedReel[] = [];
  while (ranked.length) {
    const explore =
      result.length % 4 === 3 && votes.length > 0
        ? ranked.findIndex(
            (reel) =>
              reelScore(reel, taste) === 0 && !taste.djs.has(reel.dj.id),
          )
        : -1;
    // Two DJs of the same night back to back feel like a repeat: take the
    // next nearly-as-good reel from another night instead.
    const previous = result.at(-1)?.events[0]?.id;
    const top = ranked[0]?.score ?? 0;
    const varied = ranked.findIndex(
      (reel, at) =>
        at < 8 && reel.score >= top - 0.75 && reel.events[0]?.id !== previous,
    );
    const pick = explore >= 0 ? explore : Math.max(varied, 0);
    const [next] = ranked.splice(pick, 1);
    if (next) result.push(next);
  }
  result.push(...pool.filter(disliked).sort(order));
  return {
    reels: result,
    unlocated: radius === null ? 0 : unlocated.size,
  };
}

/** The nights of every DJ the visitor likes, soonest first. */
export function likedNights(
  reels: readonly RankedReel[],
  votes: readonly ReelVote[],
): { event: RankedReel["events"][number]; dj: RankedReel["dj"] }[] {
  const taste = tasteOf(votes);
  const nights = new Map<
    string,
    { event: RankedReel["events"][number]; dj: RankedReel["dj"] }
  >();
  for (const reel of reels) {
    if ((taste.djs.get(reel.dj.id) ?? 0) <= 0) continue;
    for (const event of reel.events)
      if (!nights.has(event.id)) nights.set(event.id, { event, dj: reel.dj });
  }
  return [...nights.values()].sort(
    (a, b) => Date.parse(a.event.startsAt) - Date.parse(b.event.startsAt),
  );
}
