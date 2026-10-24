---
name: listen
paths:
  owned:
    [
      src/core/listen.ts,
      src/core/musical-key.ts,
      src/core/listen-locations.ts,
      src/components/listen-feed.tsx,
      src/components/listen-player.tsx,
      src/app/listen/,
      tests/listen.test.ts,
      tests/musical-key.test.ts,
      tests/browser/listen.spec.ts,
    ]
exports: [buildListenCards, rankListenCards, ListenFeed, ListenPlayer]
consumes: [core.model, core.cities, core.genres, db.catalog, media-consent]
verification:
  typecheck: npm run check
  lint: npm run lint
  unit: npx vitest run tests/listen.test.ts tests/musical-key.test.ts
  build: npm run build
  browser: npx playwright test tests/browser/listen.spec.ts
bar:
  property: Choose a starting city and radius, hear one artist at a time, give feedback, and reach upcoming events in range without an account.
---

# Listen to find a night

The user brief of 24 October 2026 explicitly adds a personal listening feed to
the existing event catalogue. `/listen` and `/en/listen` use canonical DJs,
their verified SoundCloud profile players and upcoming scheduled events.
The home page and navigation offer a direct entry. Existing catalogue pages
remain available. The feed is the primary new experience; key reference is
an optional secondary detail, not an onboarding gate.

- Start city, radius and next 7/30/90 days filter events before ranking.
  Initial “everywhere” state is explicit. The first version measures approximate
  straight-line distance between sourced city centres, not route length or
  venue distance. Unknown cities never pass an active radius filter and are
  counted in a visible notice. Match country as well as city.
- Each card represents a canonical DJ and their actual matching events. One
  SoundCloud player is mounted at a time. Next/swipe is neutral; Like/Dislike
  are explicit and reversible. Returning to the previous card enables review.
- Feedback uses the active SoundCloud sound when the widget identifies it,
  otherwise the artist. A sound change clears the previous sound state before
  reading new metadata. Late responses from a previous player cannot change
  the new card. No SoundCloud-account likes are written.
- Preferences and bounded feedback are stored on this device, with a reset
  action. Parse stored JSON with Zod; malformed or unavailable storage must
  not break discovery. Preserve session feedback when writes fail, including
  soft navigation. Reconcile another tab's changes and resets when returning
  to the feed. Filters become interactive after storage hydration. No account
  or server-side listening history.
- Rank by explicit artist/genre preferences; keep unknown/new genres in the
  candidate pool. Distance and date constrain the pool, not musical affinity.
  Do not invent match percentages or call a genre heuristic audio analysis.
- SoundCloud consent remains the shared provider consent. No widget/script
  requests before acceptance. Withdrawal removes the iframe and event
  listeners. The plain profile link always works independently. A failure
  and a blocked autoplay leave an explicit play/open-on-SoundCloud route.
  The feed requests autoplay after consent; other catalogue players keep
  autoplay off. Mobile browsers may require a fresh tap on Play.
- The official widget may return track BPM/key metadata. Only show validated,
  recognizable values. No audio download or inferred key for an artist/event.
  Full mixes may contain multiple keys. Missing metadata stays unknown.
- Provide an ordered 1A/1B–12A/12B key reference with exact note names and
  basic harmonic neighbours. Harmonic compatibility does not imply taste or
  guarantee a transition. No automatic mixing is implemented.
- DE/EN, light/dark, 320px/mobile and desktop, keyboard controls, reduced
  motion, and honest empty/demo states remain required. Without JavaScript
  offer ordinary catalogue links rather than inert controls.

## Parallel contracts

`src/core/listen-locations.ts` exports `ListenLocation` with `id`, `name`,
`country` (ISO alpha-2), `latitude`, `longitude`, `sourceUrl`; readonly
`LISTEN_LOCATIONS`; and `listenLocation(city, country)` returning a matching
location or undefined. IDs use `de:berlin` form. These are sourced city
centres, never evidence for a venue's coordinates.

`src/core/musical-key.ts` exports `CamelotKey`, `CAMELOT_KEYS` (ordered
objects with `key`, `nameDe`, `nameEn`), `parseMusicalKey(unknown)` returning
CamelotKey|null, and `compatibleKeys(CamelotKey)`.

`src/core/listen.ts` exports:

```ts
type SoundMetadata = {
  id: string;
  title: string;
  permalinkUrl: string;
  bpm: number | null;
  key: CamelotKey | null;
};
type ListenSettings = { origin: string; radiusKm: number; days: 7 | 30 | 90 };
type ListenFeedback = {
  artistId: string;
  value: 1 | -1;
  genres: string[];
  sound: SoundMetadata | null;
  updatedAt: number;
};
type ListenEvent = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  city: string;
  country: string;
  venueName: string;
  ticketUrl: string | null;
};
type ListenCard = {
  artist: { id: string; slug: string; name: string; soundcloudUrl: string };
  genres: string[];
  events: ListenEvent[];
};
type RankedListenCard = Omit<ListenCard, "events"> & {
  events: (ListenEvent & { distanceKm: number | null })[];
  score: number;
  reason: "artist" | "genre" | "discover";
};
```

Functions: `buildListenCards(catalog, now): ListenCard[]`,
`rankListenCards(cards, settings, feedback, now): { cards: RankedListenCard[];
unlocatedEventCount: number }`, `parseSoundMetadata(unknown): SoundMetadata|null`,
`readListenState(unknown): { settings: ListenSettings; feedback: ListenFeedback[] }`,
`upsertFeedback(previous, entry): ListenFeedback[]`; constants
`DEFAULT_LISTEN_SETTINGS` and `LISTEN_STORAGE_KEY`. `readListenState` consumes
parsed JSON, not a JSON string. Store version 1; feedback bounded to 300 entries.

`ListenFeed` props: `{ cards: ListenCard[]; locale: Locale; now: number }`.
It imports `ListenPlayer` with props `{ url: string; name: string;
locale: Locale; onSound: (sound: SoundMetadata|null) => void }`.
The page owns catalogue read, request clock and translation of event titles.

## Sources and limits

- https://developers.soundcloud.com/docs/api/html5-widget
- https://github.com/soundcloud/api/releases/tag/2026-08-14
- https://help.soundcloud.com/hc/en-us/articles/115003566828-The-Visual-embedded-player
- https://mixedinkey.com/camelot-wheel/

The REST API exposes optional BPM/key fields, but this slice uses only fields
actually returned by the consented widget. It does not configure a REST API
application or promise key coverage. Mobile embeds may require tapping Play.
City-centre sources are recorded in the location module. Audio playback against
third-party production media is separate from local UI tests using stubs.
