---
name: reels
paths:
  owned:
    [
      src/core/reels.ts,
      src/core/locations.ts,
      src/core/musical-key.ts,
      src/components/reels-feed.tsx,
      src/components/soundcloud-widget.ts,
      src/components/soundcloud-player.tsx,
      src/components/reel-storage.ts,
      src/app/reels/,
      src/app/keys/,
      tests/reels.test.ts,
      tests/musical-key.test.ts,
    ]
exports:
  [
    buildReels,
    rankReels,
    rankListening,
    tasteMatch,
    parseSound,
    ReelsFeed,
    useSoundcloudPlayer,
    CAMELOT_KEYS,
  ]
consumes:
  [core.model, core.cities, core.genres, core.sound, db.catalog, media-consent]
verification:
  typecheck: npm run check
  lint: npm run lint
  unit: npx vitest run tests/reels.test.ts tests/musical-key.test.ts
  build: npm run build
bar:
  reference: TikTok's vertical feed, with a club night under every clip
  property: Say how far you travel, then scroll, hear and like DJs until a night near you is worth a ticket.
---

# Reels

Brief (Oct 2026): pick how far you will travel, then scroll through
SoundCloud like reels; likes and dislikes shape what comes next and which
nights you are shown. Keys that mix together are listed top to bottom.

## Flow

1. `/reels` (`/en/reels`) asks one question: from where (a listed city, or
   "Mein Standort", which picks the nearest listed city on the device) and how
   far (25 / 50 / 100 / 250 km / any). Each radius chip shows its DJ count;
   an empty choice explains that a larger radius helps. "Mein Standort" names
   the chosen city and its distance and refuses beyond 150 km. The live count
   shows DJs and nights in range. "Los geht's" saves the choice, accepts SoundCloud consent (the
   button discloses it) and starts the feed with that tap, so the first reel
   can play with sound. A returning visitor goes straight to the feed.
2. The feed is a full-height vertical scroll-snap list. One reel = one DJ with
   a verified SoundCloud profile and a scheduled night in range in the next
   90 days: artwork of the playing upload (SoundCloud CDN, after consent;
   generated motif otherwise), genres, DJ name, playing upload, then the
   night (date, title, venue · city · distance, lineup, Tickets lime, Event,
   "+N Nächte"). Right rail: Like, Nicht meins, Nächster Track. Tap artwork
   to play/pause, double-tap to like. Keys: ↑/↓ or j/k, l, d, n.
3. One SoundCloud widget sits under the feed and is reused (`widget.load`)
   for each reel. When a reel loads, the upload that best fits the visitor's
   taste plays first. A blocked autoplay shows "Tippen zum Abspielen";
   "Pausiert" only follows the visitor's own pause. A profile without public
   uploads says so after 9 s ("Keine öffentlichen Tracks"). Widget calls to a
   removed player are ignored, so leaving the feed or withdrawing consent
   never throws.
4. "Meine Nächte" lists every night of a liked DJ in range, soonest first,
   with tickets, and offers "Likes zurücksetzen".

## Ranking (`src/core/reels.ts`)

- Distance filters, taste orders. Distances are straight lines between
  GeoNames city centres (`locations.ts`); a night in a city that is not listed
  never passes an active radius.
- A vote stores the DJ, the canonical genres of the DJ and the playing
  upload, the upload's other tags and an uploader-stated key. Likes weigh 1,
  dislikes 0.6; genre, family, tag and DJ weights are clamped so one streak
  cannot take over.
- Reel score = DJ vote + best/worst genre affinity (+ half the family
  affinity) + 0.6 when the next night in range is within 7 days (0.3 within
  14). Every fourth place goes to a reel without any opinion yet;
  consecutive reels avoid the same night; disliked DJs sink to the end.
  Votes only reorder reels not seen yet.
- Upload score adds tag affinity and +1 for a stated key compatible with a
  liked key.

## On the night map

The home page's night map (`discovery.spec.md`, "Night map") is the second
place to listen, by place instead of by feed. It uses the same parts:

- `useSoundcloudPlayer` (`src/components/soundcloud-player.tsx`): the one
  reused widget, with the same autoplay, "best upload first" and guarded
  calls as the feed.
- `rankListening(candidates, votes, now)`: one entry per DJ (their soonest
  night on screen), ordered by `reelScore` plus how soon they play (+0.6
  within 7 days, +0.3 within 14); disliked DJs are left out.
- `tasteMatch(night, taste)`: "liked" when a liked DJ plays, "close" when
  the night's genres score above 0.5 in `genreAffinity`; the map rings liked
  nights and names the DJ on the card.
- `src/components/reel-storage.ts`: one reader and writer of
  `evryvibe.reels.v1`. A vote on the map is saved with the stored place
  unchanged, so a like there reorders Reels and the other way round. The
  stored place and radius frame the map on first load (without a city
  filter).

## Data and privacy

- Settings and up to 300 votes live in `localStorage` (`evryvibe.reels.v1`),
  parsed with Zod. Nothing is sent to the server or to a SoundCloud account.
  The position from "Mein Standort" is used once to pick a city and is not
  stored; the map's "In meiner Nähe" likewise only moves the map.
- The server stores no tracks. The widget's sound payload (title, link,
  genre, tags, artwork, description) is parsed in the browser.
- Consent: nothing from SoundCloud loads before acceptance; withdrawal
  unmounts the player and shows a "SoundCloud laden" bar.

## Keys

SoundCloud's widget payload has no key or BPM fields (checked on 475 uploads
of 20 booked DJs, Oct 2026: none; explicit keys in titles ≈ 0 %, BPM ≈ 2.5 %).
A reel shows a key or BPM only when the uploader states it ("[8A]", "Key: 5A",
"A minor", "C-Moll", "128 BPM"); "Am" and bare "2B" stay unknown. A stated
key links to `/keys`, the ordered 1A–12B list with note names and the three
neighbours that mix (−1, +1, relative major/minor). Key-based ranking will
only matter once a key source exists; inferring keys from audio is out of
scope.

## Known limitations

- Like is not a toggle; "Likes zurücksetzen" clears all votes.
- No up-front genre choice; about 9 % of reels have no known genre.
- The page ships every reel in its HTML (≈ 400 reels, ≈ 380 KB).

- iOS Safari may need a tap before each new reel plays; not verified on a
  device. Headless Chromium autoplays after the start tap and on swipes.
- The widget is light-themed in both site themes.
- Demo catalogue SoundCloud profiles are fictional and do not play.

## Public availability

Reels is currently disabled by `REELS_PAGE_ENABLED` in core/media-features.
The route returns404 and all public entry links/sitemap entries are suppressed.
The implementation remains in place for future review; this is not a deletion.
