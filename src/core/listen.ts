import { z } from "zod";
import { isUpcoming } from "./cities";
import { canonicalGenre, genreKey, normalizeGenres } from "./genres";
import {
  LISTEN_LOCATIONS,
  listenLocation,
  type ListenLocation,
} from "./listen-locations";
import { camelotKeySchema, parseMusicalKey } from "./musical-key";
import {
  httpsUrlSchema,
  instantSchema,
  timezoneSchema,
  type Catalog,
} from "./model";
import { posterSeed } from "./sound";
import { soundcloudProfileSchema } from "./soundcloud";

const DAY_MS = 86_400_000;
const MAX_FEEDBACK = 300;
const textSchema = z.string().trim().min(1).max(200);
const soundIdSchema = z.union([
  z
    .string()
    .trim()
    .regex(/^(?:soundcloud:tracks:)?[1-9]\d{0,29}$/),
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String),
]);
const soundPermalinkSchema = z
  .string()
  .trim()
  .max(1000)
  .transform((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Use a SoundCloud sound permalink",
      });
      return z.NEVER;
    }
    const path = /^\/([a-z0-9_-]{1,100})\/([a-z0-9_-]{1,250})\/?$/i.exec(
      url.pathname,
    );
    const artist = path?.[1];
    const sound = path?.[2];
    const profile = artist
      ? soundcloudProfileSchema.safeParse(`https://soundcloud.com/${artist}`)
      : null;
    if (
      url.protocol !== "https:" ||
      url.hostname !== "soundcloud.com" ||
      url.username ||
      url.password ||
      url.port ||
      !profile?.success ||
      !sound ||
      [
        "sets",
        "tracks",
        "albums",
        "reposts",
        "likes",
        "popular-tracks",
        "comments",
      ].includes(sound.toLowerCase())
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Use https://soundcloud.com/<artist>/<sound>",
      });
      return z.NEVER;
    }
    return `${profile.data}/${sound}`;
  });
const bpmSchema = z.number().positive().max(400);

export const soundMetadataSchema = z
  .object({
    id: soundIdSchema,
    title: z.string().trim().min(1).max(500),
    permalinkUrl: soundPermalinkSchema,
    bpm: bpmSchema.nullable(),
    key: camelotKeySchema.nullable(),
  })
  .strict();
export type SoundMetadata = z.infer<typeof soundMetadataSchema>;

const widgetSoundSchema = z.object({
  id: z.unknown().optional(),
  urn: z.unknown().optional(),
  title: z.unknown(),
  permalink_url: z.unknown().optional(),
  permalinkUrl: z.unknown().optional(),
  bpm: z.unknown().optional(),
  key_signature: z.unknown().optional(),
  key: z.unknown().optional(),
});

/** Read only metadata actually supplied by the consented SoundCloud widget. */
export function parseSoundMetadata(value: unknown): SoundMetadata | null {
  const payload = widgetSoundSchema.safeParse(value);
  if (!payload.success) return null;
  const sound = payload.data;
  const urn = soundIdSchema.safeParse(sound.urn);
  const id = urn.success ? urn : soundIdSchema.safeParse(sound.id);
  if (!id.success) return null;
  const rawBpm =
    typeof sound.bpm === "string" &&
    /^\d{1,3}(?:\.\d+)?$/.test(sound.bpm.trim())
      ? Number(sound.bpm.trim())
      : sound.bpm;
  const bpm = bpmSchema.safeParse(rawBpm);
  const parsed = soundMetadataSchema.safeParse({
    id: id.data,
    title: sound.title,
    permalinkUrl: sound.permalink_url ?? sound.permalinkUrl,
    bpm: bpm.success ? bpm.data : null,
    key: parseMusicalKey(sound.key_signature) ?? parseMusicalKey(sound.key),
  });
  return parsed.success ? parsed.data : null;
}

export const listenSettingsSchema = z
  .object({
    origin: z.string().trim().max(100),
    radiusKm: z.number().min(1).max(20_000),
    days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  })
  .strict();
export type ListenSettings = z.infer<typeof listenSettingsSchema>;
export const DEFAULT_LISTEN_SETTINGS: ListenSettings = Object.freeze({
  origin: "",
  radiusKm: 100,
  days: 30,
});
export const LISTEN_STORAGE_KEY = "evryvibe.listen.v1";

export const listenFeedbackSchema = z
  .object({
    artistId: textSchema,
    value: z.union([z.literal(1), z.literal(-1)]),
    // An artist without profile genres may inherit the distinct canonical
    // genres of many eligible events, more than the per-event limit of 20.
    genres: z.array(textSchema).max(200),
    sound: soundMetadataSchema.nullable(),
    updatedAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type ListenFeedback = z.infer<typeof listenFeedbackSchema>;

export const listenEventSchema = z
  .object({
    id: textSchema,
    slug: textSchema,
    title: textSchema,
    startsAt: instantSchema,
    endsAt: instantSchema.nullable(),
    timezone: timezoneSchema,
    city: textSchema,
    country: textSchema,
    venueName: textSchema,
    ticketUrl: httpsUrlSchema.nullable(),
  })
  .strict()
  .refine(
    (event) =>
      !event.endsAt || Date.parse(event.endsAt) > Date.parse(event.startsAt),
    {
      message: "Event end must follow start",
      path: ["endsAt"],
    },
  );
export type ListenEvent = z.infer<typeof listenEventSchema>;
export const listenCardSchema = z
  .object({
    artist: z
      .object({
        id: textSchema,
        slug: textSchema,
        name: textSchema,
        soundcloudUrl: soundcloudProfileSchema,
      })
      .strict(),
    genres: z.array(textSchema),
    events: z.array(listenEventSchema),
  })
  .strict();
export type ListenCard = z.infer<typeof listenCardSchema>;
export type RankedListenCard = Omit<ListenCard, "events"> & {
  events: (ListenEvent & { distanceKm: number | null })[];
  score: number;
  reason: "artist" | "genre" | "discover";
};

function feedbackKey(entry: ListenFeedback): string {
  // Legacy numeric IDs and new URNs identify the same sound, including when
  // it appears in another artist's profile. A repeat vote cannot accumulate.
  return entry.sound
    ? `sound:${entry.sound.id.startsWith("soundcloud:tracks:") ? entry.sound.id : `soundcloud:tracks:${entry.sound.id}`}`
    : `artist:${entry.artistId}`;
}

function normalizedFeedback(entries: readonly unknown[]): ListenFeedback[] {
  const newest = new Map<string, ListenFeedback>();
  for (const value of entries) {
    const parsed = listenFeedbackSchema.safeParse(value);
    if (!parsed.success) continue;
    const entry = parsed.data;
    const key = feedbackKey(entry);
    const previous = newest.get(key);
    if (!previous || entry.updatedAt >= previous.updatedAt) {
      newest.set(key, {
        ...entry,
        genres: [
          ...new Set(
            entry.genres.map((genre) => canonicalGenre(genre)?.name ?? genre),
          ),
        ],
      });
    }
  }
  return [...newest.values()]
    .sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        feedbackKey(a).localeCompare(feedbackKey(b), "en"),
    )
    .slice(0, MAX_FEEDBACK);
}

export function upsertFeedback(
  previous: readonly ListenFeedback[],
  entry: ListenFeedback,
): ListenFeedback[] {
  return normalizedFeedback([...previous, entry]);
}

export const listenStateSchema = z
  .object({
    version: z.literal(1),
    settings: listenSettingsSchema,
    feedback: z.array(listenFeedbackSchema).max(MAX_FEEDBACK),
  })
  .strict();
const storedEnvelopeSchema = z
  .object({
    version: z.literal(1),
    settings: z.unknown(),
    feedback: z.array(z.unknown()).max(10_000),
  })
  .strict();

/** Receives parsed JSON; a bad entry cannot turn a sound vote into an artist vote. */
export function readListenState(value: unknown): {
  settings: ListenSettings;
  feedback: ListenFeedback[];
} {
  const envelope = storedEnvelopeSchema.safeParse(value);
  if (!envelope.success)
    return { settings: { ...DEFAULT_LISTEN_SETTINGS }, feedback: [] };
  const settings = listenSettingsSchema.safeParse(envelope.data.settings);
  return {
    settings: settings.success ? settings.data : { ...DEFAULT_LISTEN_SETTINGS },
    feedback: normalizedFeedback(envelope.data.feedback),
  };
}

function inTimeWindow(event: ListenEvent, now: number, days: number): boolean {
  return (
    Date.parse(event.startsAt) <= now + days * DAY_MS &&
    isUpcoming(event, now, event.timezone)
  );
}

/** One verified profile per canonical artist, joined only to usable upcoming nights. */
export function buildListenCards(catalog: Catalog, now: number): ListenCard[] {
  if (!Number.isFinite(now)) return [];
  const venues = new Map(catalog.venues.map((venue) => [venue.id, venue]));
  const eventsByArtist = new Map<string, Map<string, ListenEvent>>();
  const eventGenresByArtist = new Map<string, string[]>();
  for (const event of catalog.events) {
    const venue = venues.get(event.venueId);
    if (!venue || event.status !== "scheduled") continue;
    const parsed = listenEventSchema.safeParse({
      id: event.id,
      slug: event.slug,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: venue.timezone,
      city: venue.city,
      country: venue.country,
      venueName: venue.name,
      ticketUrl: event.ticketUrl,
    });
    if (!parsed.success || !inTimeWindow(parsed.data, now, 90)) continue;
    for (const artistId of new Set(event.djIds)) {
      const events =
        eventsByArtist.get(artistId) ?? new Map<string, ListenEvent>();
      events.set(event.id, parsed.data);
      eventsByArtist.set(artistId, events);
      eventGenresByArtist.set(artistId, [
        ...(eventGenresByArtist.get(artistId) ?? []),
        ...event.genres,
      ]);
    }
  }
  const cards = new Map<string, ListenCard>();
  for (const artist of catalog.djs) {
    const profile = soundcloudProfileSchema.safeParse(artist.soundcloudUrl);
    const events = eventsByArtist.get(artist.id);
    if (!profile.success || !events?.size) continue;
    const artistGenres = normalizeGenres(artist.genres).genres;
    cards.set(artist.id, {
      artist: {
        id: artist.id,
        slug: artist.slug,
        name: artist.name,
        soundcloudUrl: profile.data,
      },
      genres: artistGenres.length
        ? artistGenres
        : normalizeGenres(eventGenresByArtist.get(artist.id) ?? []).genres,
      events: [...events.values()].sort(
        (a, b) =>
          Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
          a.id.localeCompare(b.id, "en"),
      ),
    });
  }
  return [...cards.values()].sort((a, b) =>
    a.artist.id.localeCompare(b.artist.id, "en"),
  );
}

function distanceKm(from: ListenLocation, to: ListenLocation): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitude = radians(to.latitude - from.latitude);
  const longitude = radians(to.longitude - from.longitude);
  const chord =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(longitude / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, chord))));
}

function preferenceSignals(feedback: ListenFeedback[]) {
  const byArtist = new Map<string, ListenFeedback[]>();
  const genreVotes = new Map<string, Map<string, number>>();
  for (const entry of feedback) {
    byArtist.set(entry.artistId, [
      ...(byArtist.get(entry.artistId) ?? []),
      entry,
    ]);
    for (const genre of entry.genres) {
      const key = genreKey(genre);
      const voters = genreVotes.get(key) ?? new Map<string, number>();
      // The newest vote per artist and genre counts once, even after many
      // liked sounds by that artist. Feedback is already newest first.
      if (!voters.has(entry.artistId)) voters.set(entry.artistId, entry.value);
      genreVotes.set(key, voters);
    }
  }
  const genreScores = new Map<string, number>();
  const familyScores = new Map<string, number>();
  for (const [key, voters] of genreVotes) {
    const score = Math.max(
      -1.5,
      Math.min(
        3,
        [...voters.values()].reduce(
          (sum, value) => sum + (value === 1 ? 2 : -0.5),
          0,
        ),
      ),
    );
    genreScores.set(key, score);
    const genre = canonicalGenre(key);
    if (genre && score > 0)
      familyScores.set(
        genre.family,
        Math.max(familyScores.get(genre.family) ?? 0, score / 2),
      );
  }
  return { byArtist, genreScores, familyScores };
}

function diversityGroups(card: ListenCard): string[] {
  return [
    ...new Set(
      card.genres.map(
        (genre) => canonicalGenre(genre)?.family ?? genreKey(genre),
      ),
    ),
  ];
}

/** Geography and time constrain the pool; only explicit feedback informs musical affinity. */
export function rankListenCards(
  cards: readonly ListenCard[],
  settings: ListenSettings,
  feedback: readonly ListenFeedback[],
  now: number,
): { cards: RankedListenCard[]; unlocatedEventCount: number } {
  const parsedSettings = listenSettingsSchema.safeParse(settings);
  if (!parsedSettings.success || !Number.isFinite(now))
    return { cards: [], unlocatedEventCount: 0 };
  const selection = parsedSettings.data;
  const origin = LISTEN_LOCATIONS.find(
    (location) => location.id === selection.origin,
  );
  // A stale or malformed nonempty origin must never silently mean everywhere.
  if (selection.origin && !origin) return { cards: [], unlocatedEventCount: 0 };
  const unlocated = new Set<string>();
  const eligible: Omit<RankedListenCard, "score" | "reason">[] = [];
  for (const card of cards) {
    const events = new Map<
      string,
      ListenEvent & { distanceKm: number | null }
    >();
    for (const rawEvent of card.events) {
      const parsed = listenEventSchema.safeParse(rawEvent);
      if (!parsed.success || !inTimeWindow(parsed.data, now, selection.days))
        continue;
      const event = parsed.data;
      const location = listenLocation(event.city, event.country);
      if (!location) unlocated.add(event.id);
      const distance = origin && location ? distanceKm(origin, location) : null;
      if (origin && (distance === null || distance > selection.radiusKm))
        continue;
      events.set(event.id, { ...event, distanceKm: distance });
    }
    if (events.size)
      eligible.push({
        artist: { ...card.artist },
        genres: [...card.genres],
        events: [...events.values()].sort(
          (a, b) =>
            Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
            a.id.localeCompare(b.id, "en"),
        ),
      });
  }
  const { byArtist, genreScores, familyScores } = preferenceSignals(
    normalizedFeedback(feedback),
  );
  const ranked: RankedListenCard[] = eligible.map((card) => {
    const history = byArtist.get(card.artist.id) ?? [];
    const direct = history.find((entry) => entry.sound === null);
    const samples = history.filter((entry) => entry.sound !== null);
    const sampleAverage = samples.length
      ? samples.reduce((sum, entry) => sum + entry.value, 0) / samples.length
      : 0;
    // One disliked sound is a small negative signal, never an artist ban.
    const artistScore = direct
      ? direct.value * 8
      : sampleAverage * (sampleAverage > 0 ? 4 : 1.5);
    const genreSignals = card.genres.map((genre) => {
      const exact = genreScores.get(genreKey(genre));
      const family = canonicalGenre(genre)?.family;
      return exact ?? (family ? (familyScores.get(family) ?? 0) : 0);
    });
    const genreScore =
      Math.max(0, ...genreSignals) + Math.min(0, ...genreSignals);
    const reason =
      artistScore > 0 ? "artist" : genreScore > 0 ? "genre" : "discover";
    return {
      ...card,
      score: artistScore + genreScore + (history.length ? 0 : 0.25),
      reason,
    };
  });
  const stableOrder = (a: RankedListenCard, b: RankedListenCard) =>
    b.score - a.score ||
    posterSeed(a.artist.id) - posterSeed(b.artist.id) ||
    a.artist.id.localeCompare(b.artist.id, "en");
  ranked.sort(stableOrder);
  const result: RankedListenCard[] = [];
  while (ranked.length) {
    const previousGroups = new Set(result.slice(-2).flatMap(diversityGroups));
    // Every fourth place makes room for an unheard/new genre. No candidate
    // is removed, and a disliked artist is not promoted by this exploration.
    const explore = result.length % 4 === 3;
    const discoveries = explore
      ? ranked.filter(
          (card) => !byArtist.has(card.artist.id) && card.reason === "discover",
        )
      : [];
    const pool = discoveries.length ? discoveries : ranked;
    let next = pool[0];
    if (!next) break;
    const adjustedScore = (card: RankedListenCard) =>
      card.score -
      (diversityGroups(card).some((group) => previousGroups.has(group))
        ? 1
        : 0);
    for (const candidate of pool) {
      if (adjustedScore(candidate) > adjustedScore(next)) next = candidate;
    }
    result.push(next);
    ranked.splice(ranked.indexOf(next), 1);
  }
  return { cards: result, unlocatedEventCount: unlocated.size };
}
