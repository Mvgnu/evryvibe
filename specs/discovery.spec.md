---
name: discovery
paths:
  owned: [src/app/, src/components/, public/, tests/browser/]
exports:
  [
    event discovery,
    city pages,
    event detail,
    venue detail,
    DJ detail,
    DJ directory,
    genre pages,
  ]
consumes:
  [
    core.model,
    core.cities,
    core.sound,
    core.soundcloud,
    core.reconciliation.publicBioFor,
    core.dj-directory,
    core.structured-data,
    core.night-map,
    core.reels.taste,
    db.catalog,
  ]
verification:
  typecheck: npm run check
  lint: npm run lint
  unit: npx vitest run tests/night-map.test.ts
  build: npm run build
  browser: npm run test:e2e
bar:
  reference: Resident Advisor event listings
  property: Date, place, lineup, and the route to tickets are legible at a glance on mobile.
---

# Discovery

## Design language: club programme

Dark-first, print-like techno. Pages read like a club programme and the
generated posters like its flyers: one system, not a site with pictures in it.

- Theme: dark is the default look. Light is an explicit visitor choice, stored
  locally. Both must stay fully usable.
- Tokens (defined once in `globals.css`): `--paper` ground, `--surface` and
  `--raised` panels, `--ink` text, `--muted` secondary text, `--line` hairlines,
  `--lime` (#d8ff00) the single brand accent, `--danger` for cancellation,
  `--gutter` side margin, `--font-display` (Barlow Condensed, heavy caps),
  `--font-body` (DM Sans), `--font-mono` (system monospace) for dates, times,
  counts and small labels.
- Dark palette: near-black ground (#0a0a0a range), off-white ink, grey hairlines.
  Light palette: cool off-white (not beige), black ink.
- Hard 1px rules, square corners, no drop shadows, no gradients as decoration.
  Lime marks the one primary action or the current state, not decoration.
- Hierarchy on every event surface: date (big, mono), title, lineup, place, then
  everything else. The lineup is shown wherever an event appears when it is known.
- Readable sizes: meaningful text never below 12px on mobile; small mono labels
  are 11px minimum. Tap targets are at least 44px.
- Plain labels: "Heute", "Wochenende", "Line-up", "Tickets", "Anhören". No
  slogans or filler ("Frequenz", "Hier spielt die Musik", "Sound in Bewegung").
- Fewer controls: a list row is one link; secondary actions are compact chips
  (`.chip-button`); filter chips sit in single rows that scroll sideways and
  never wrap into walls.

Posters are generated per event from its genre tags (the first canonical genre's
poster motif, one of nine artworks declared in the genre taxonomy, decides colour
and motif; the slug seeds variation) and show only known facts. They scale from
calendar-tile thumbnail to full flyer by container width and mark cancellation.
In listing rows the thumbnail is pure motif (the row already says when). Venue
and DJ headers carry a square motif tile in the same language instead of a
name-only poster.
The event motif covers the whole flyer, including dense posters. Original
event titles remain intact. A fine dark keyline on the white title lettering
keeps it readable where light motif shapes pass underneath, without hiding the
artwork.

Routes: `/` event discovery (the night map beside the programme, see "Night map"), `/reels` and `/keys` (see `reels.spec.md`), `/cities`, `/cities/[slug]`, `/events/[slug]`, `/venues/[slug]`, `/djs`, `/djs/[slug]`, `/genres`, `/genres/[slug]`. Other directory routes are added only when navigation needs them. Top navigation (Reels · Nächte · DJs · Städte) must lead to real destinations; on phones the header is one row, the wordmark leads home, "Reels" always stays and one more tab follows: "DJs" on DJ pages, otherwise "Städte" (below 360px only one tab: "DJs" or "Städte" on their own section, otherwise "Reels"). Reels, DJs, Genres and Keys are always in the footer. The home heading carries one lime "Reels" link (on phones it reads just "Reels" and keeps its full accessible name). `/map` and `/en/map` redirect to the localized home with the same query and `#karte`, which opens the map full screen. Use responsive layouts, keyboard focus, semantic controls, reduced-motion support, and descriptive page metadata.

City month routes `/cities/[slug]/YYYY-MM` exist only for a future month with
scheduled nights. The base city page reads bilingual city editorial fields
from PostgreSQL on each request. Programmatic H1, summary, events, counts and
venue/DJ lists lead the page; saved editorial heading and introduction render
in a separate section at the bottom. Editorial SEO title and meta description
still populate metadata. When no editorial record exists, the page remains
fully useful with factual data-derived copy. The city name/slug come from
actual venue records, and event cards, counts, genres and directories come
from the catalog. Genre pages remain programmatic and omit general editorial.
`?genre=` takes canonical genres (`cityGenre`); an alias spelling of a genre the
city has answers with a permanent redirect to the canonical URL (city and month
pages), so each genre page has one URL. Genre filters compose with month routes via `?genre=` and must filter every
visible count, card, directory row, metadata field and JSON-LD URL. Empty pages and
all query-string variants are noindex, follow. Do not claim a page modification date
from an Instagram observation timestamp.

Home filters (`src/components/discovery-filters.ts`): every filter is a GET
parameter, composable, applied by following a chip link (no submit except text
search), kept by the language switch, and server-rendered without JavaScript.

- `q` text search over title, description, venue, city, genres and lineup;
  longer than 200 characters is cut to 200.
- `when` = `today` | `tomorrow` | `weekend` (Fri–Sun; the current one from
  Friday on) | `week` (today + 6 days), or `date` = ISO local date, which
  replaces `when`. Days are the venue's local days. An event that started
  earlier and is still running counts for today. A date outside this year
  shows its year; a past date with nothing still running says it is in the
  past instead of showing an empty list.
- `city` = city slug (names and other spellings are accepted and normalised).
- `sound` = a genre family slug from the taxonomy (`src/core/genres.ts`):
  `techno`, `hard-techno`, `hard-dance`, `house`, `disco`, `trance`, `bass`,
  `electro-wave`, `ambient`, `global`. The Sound chip row lists the families
  with real counts (empty ones hidden) in taxonomy order. An event belongs to
  every family one of its canonical genres belongs to; unknown or dropped
  spellings belong to none. The old nine slugs keep working: `techno`,
  `house`, `trance`, `ambient` unchanged, `hard` -> `hard-techno`, `electro`
  -> `electro-wave`, `breaks` -> `bass`, `acid` -> `techno` + `genre=Acid
Techno`, `dub` -> `techno` + `genre=Dub Techno`.
- `genre` = one canonical genre name, offered as a second chip row (with
  counts) once a family is chosen. Any spelling or alias is accepted and
  canonicalised ("hardtechno", "Peak-Time Techno"); a genre names its own
  family, so `sound` follows it. An unknown genre is ignored with a notice.
- `limit` = how many listings to show (default 60, whole days only; any
  number is clamped to 1–2000); a server-rendered "Weitere Nächte anzeigen"
  link raises it, anchors to the first new row and counts the remaining
  scheduled nights like the header does.

Chips carry real counts of scheduled nights for the other active filters;
empty choices are hidden. The active choice is lime, toggles off on a second
tap, and is listed with a remove link in the active-filter bar ("Alle
löschen" for several). A malformed parameter is dropped with a notice naming
what was ignored while the valid ones keep working. Filtered home URLs keep the home canonical.

Listing: ascending upcoming events grouped by venue-local day (sticky day
heading; a side column on wide screens). Each row is one link (the title,
stretched over the row): time range (a run past the next morning names its
last day), poster thumbnail, title, up to four lineup names "+N", venue · city,
up to two genres, a "SoundCloud" cue when someone in the lineup has a profile,
and a prominent cancelled badge. The row layout follows its list's width
(container query), so the same rows serve home, city, venue and DJ pages;
venue and DJ pages show each row's date. Where a canonical public post/reel
has a valid original cover URL, the artwork may show that CDN image only after
Instagram consent, with the generated poster as fallback. Never show story
images. Long titles wrap without showing a raw route path. No invented prices,
attendance, or popularity.

City pages: cities come from venue records (`src/core/cities.ts`); spellings that
slugify alike merge, and names without Latin letters get no page. `/cities/[slug]`
leads with a compact hero (kicker, H1, one line of counts, a link to the home
filters preset to the city), one chip row of genres (a `genre` GET filter) and
one of month programmes, then the city's upcoming events grouped by venue-local
day, its venues with upcoming counts, the DJs booked there and other cities.
The factual programme summary and source freshness follow in "Über dieses
Programm", before any saved editorial copy. Counts and genres in titles and descriptions come from the data. A
cancelled listing stays visible but never counts as a night anywhere
(`isScheduled` in `src/core/cities.ts`); a day with only cancellations reads
"1 abgesagt", not "0 Nächte". A city
without upcoming events renders an honest empty state and is noindex. `/cities`
lists every city with real counts in compact rows. Unknown slugs 404. Mobile
reaches cities through the header and the home "Wo" chips.

Event page: local date/time with timezone, title, status, then venue
link/address beside or right under the title with the actions: "Tickets" is
the single lime action when a ticket URL exists (otherwise a plain "Noch kein
Ticketlink bekannt"); website, source (post link, or the source profile for a
story) and share are compact secondary chips. Then the linked lineup, the
poster, description and the source observation date. A public post/reel
announcement appears as a consent-controlled native embed; an expired story
never does. Each lineup row retains its internal DJ link and separately opens
the known Instagram profile in a new tab, with a localized artist-specific
accessible label; omit the external link when the profile is unknown. A row
whose DJ has a SoundCloud profile adds an "Anhören" toggle that opens that
DJ's player in place, one at a time.

Venue and DJ pages: name, sound (DJ genres) or address (venue), one row of
profile chips (Instagram · SoundCloud · Website; a website that is only a
SoundCloud URL is not repeated), then the SoundCloud player (the DJ's main
media), the description through `publicBioFor` (both languages judged
together; section hidden when empty; also the meta description fallback), upcoming nights as compact
rows, a collapsed past-events section linking to past event pages in reverse chronological order, and Instagram profile/post embeds last. Past event pages remain noindex, follow. A venue's programme leads its
page. DJ sample is an Instagram post/reel, never an uploaded player.

Post embeds: accept only canonical parsed Instagram post/reel URLs. Construct embed URLs from that value; never store or render arbitrary HTML. A shared DE/EN external-media dialog ("Instagram und SoundCloud laden?") appears on the first visit to any public page, even without an embed, and loads all post/profile iframes and selected original public post/reel CDN covers only after Instagram is accepted. Covers are requested directly from Instagram, never hosted locally; stories are excluded. Each provider's accepted or rejected choice persists in its own six-month SameSite=Lax cookie (`evryvibe-instagram-consent`, `evryvibe-soundcloud-consent`; Secure on HTTPS); existing localStorage Instagram choices migrate once. The dialog offers "Ablehnen", "Alle laden" and per-provider checkboxes with "Auswahl speichern"; it reappears while either provider is unset, so an earlier Instagram-only answer is asked once more for SoundCloud and never counts for it. An embed's own load button accepts only its provider. Rejection leaves readable placeholders or typographic artwork. Visitors can revisit both choices through "Einstellungen" in the header; withdrawal immediately unloads all iframes and covers of that provider. Without JavaScript nothing external can load, so the dialog is hidden and never blocks the page; controls that need JavaScript (settings, theme, share, the lineup player toggle) are hidden too, with plain links where they exist. No Meta resource request occurs before acceptance. Keep an ordinary Instagram link continuously and explain that Instagram may be unavailable. Only actual public posts can work; fixtures must not invent real posts.

Venue and DJ pages also offer a native Instagram profile preview when a canonical profile URL is present. It follows the shared Instagram choice and unloads on withdrawal. Keep the full-profile link visible above the iframe. Explain in German/English that Instagram controls the limited selection and may require sign-in or block embedding; do not promise a complete timeline. Existing DJ post samples follow the same choice. Both themes and mobile layouts must remain usable, including full placeholder text.

Share uses Web Share with copy-link fallback and visible success/failure. All filters, navigation, and CTAs work. No auth prerequisite. `EVRYVIBE_DEMO=1` enables visibly fictional preview content only outside production; no live DB fallback. Without DB/demo configuration show a deliberate empty state rather than crash.

SEO: Public page responses with any query parameter carry `X-Robots-Tag: noindex, follow`, including tracking parameters and city genre variants; unparameterized pages keep their normal indexing policy. Every public page has a localized title, description, self canonical and DE/EN/x-default alternates. Document and social titles use one EVRYVIBE suffix. Detail descriptions fall back to known entity facts when editorial copy is absent. Root metadata does not supply a homepage canonical to missing or operator routes. Native favicon ICO (16/32/48 px), SVG and Apple PNG (180 px) share the existing E mark. Every public page emits one JSON-LD graph (`src/core/structured-data.ts`) with Organization, WebSite (with search action), a typed page node and, below home, a BreadcrumbList (home › city › entity where a city exists). Home and city pages are CollectionPage with an ItemList of up to 50 upcoming event URLs; the city index lists cities; city pages are `about` a City. Event pages link WebPage to MusicEvent (with canonical genre names); venue pages describe the MusicVenue/LocalBusiness and DJ pages a ProfilePage for a Person. Their upcoming events appear as URL-only ItemLists, leaving the complete MusicEvent entity on each event page instead of publishing sparse duplicate Events. `/kontakt` is a ContactPage; `/takedown` sits under it in the breadcrumb. Every `@id` reference resolves within the page graph. Source authors are credited only for a known posting account matching the venue or a performing DJ. A known ticket URL appears as an Offer for scheduled events, but price, availability and sale start stay unknown until sourced. Missing organizer, event image, prices, coordinates, ratings and opening hours remain absent. Demo entity schema and demo event lists are suppressed and previews are noindex.

Contact routes `/kontakt` and `/takedown` (and `/en` alternatives) are linked from the footer and sitemap. Contact reasons use the supplied info@, magnus@ and legal@evryvibe.com addresses; complaints, privacy and takedown requests go to legal@. The takedown page gives practical reporting guidance and links to `/kontakt#legal`, without imposing identity-document gates or promising legal outcomes/deadlines. Both pages have localized metadata and WebPage schema.

## Listening (SoundCloud)

DJ and venue pages, and the event lineup, offer SoundCloud's own player for a
known `soundcloudUrl` (`soundcloudPlayerUrl`; a profile lists its latest
uploads and sets, nothing about tracks is stored). The player follows the
SoundCloud choice of the shared external-media consent: nothing is requested
from soundcloud.com before acceptance. Unset or rejected shows a short
explanation, a "SoundCloud-Player laden" button (accepts SoundCloud only) and
the plain "Auf SoundCloud anhören" profile link, which stays visible beside a
loaded player too. In a lineup the player opens per artist ("Anhören"), one
at a time; without JavaScript the toggle is replaced by the profile link.
Descriptions render through `publicBioFor`, so filler and event-bound
sentences never appear as a profile bio in either language.

Known limitations: SoundCloud's widget is a light-themed iframe in both site
themes. Genres are agent-written free text normalised to the taxonomy on write;
a spelling the taxonomy does not know is dropped (see `specs/ingestion.spec.md`)
and cannot be filtered, only found through text search.

## Keyword

The site targets techno. Programmatic H1s and default titles use "Techno-Partys"
/ "Techno parties": home "Techno-Partys", city "Techno-Partys in {Stadt}", month
"Techno-Partys in {Stadt} im {Monat}", cities index "Techno-Partys nach Stadt".
Genre-filtered variants name their genre ("Kommende Hard-Techno-Events in …"). German couples a multi-word genre with hyphens throughout (`compound` in `src/components/german-compound.ts`: "Hard-Techno-DJs", "UK-Garage-DJs", "Drum-&-Bass-Partys"); English keeps spaces ("Hard Techno DJs"); one-word genres are unchanged ("Techno-DJs").
Never fall back to generic "Clubnächte"/"Club Events". A saved city editorial
heading identical to the H1 is shown as "Mehr über Techno in {Stadt}".

## DJ directory

DJ discovery is derived from the catalogue (`src/core/dj-directory.ts`); there
is no separate table. A DJ is listed once they have a scheduled night, past or
upcoming; cancelled nights never count. Past events stay in the catalogue, so a
DJ's cities are the cities of the venues they played or will play.

- `directoryEntries(catalog, now)`: one entry per listed DJ with canonical
  genres (the profile's, else up to three of the most frequent on their nights,
  flagged `genresFromEvents`), city tallies (`past`, `upcoming`), night counts,
  next and last night.
- Ranking (`compareEntries`): a DJ with a SoundCloud profile first. With a city
  filter, DJs who have played there come before DJs only booked there (most
  nights played first). Then most nights (in the filtered city when set), then
  an upcoming night, then name.
- `filterDirectory` filters by genre, family and city ("has a gig in this
  city", past or upcoming); `directoryFacets` counts each facet against the
  other filters; `upcomingGenreEvents` lists upcoming nights tagged with a genre.

## DJ and genre pages

Built on the DJ directory contract above; view helpers live in
`src/components/dj-directory-view.ts`, rows in `src/components/dj-list.tsx`,
styles in `src/app/directory.css`.

- `/djs` "Techno-DJs" (EN "Techno DJs"): hero with DJ, SoundCloud and
  upcoming-gig counts; chip rows "Gigs in" (city), "Sound" (family) and, once
  a family is chosen, "Genre", all with `directoryFacets` counts and the home
  parameter conventions (`city=` slug, `sound=` family slug incl. the old
  slugs, `genre=` canonical name). A valid but non-canonical spelling
  (`genre=hardtechno`, `city=Köln`, `sound=acid`) answers 308 with the one
  canonical URL; a malformed one is dropped with a notice. A chosen genre
  links to its genre page. A "Nach Genre" chip row leads to genre pages.
- `/genres/[slug]` per canonical genre slug: H1 "{Genre}-DJs und -Partys"
  (EN "{Genre} DJs and parties"; German hyphenates multi-word genres, "Hard-Techno-DJs
  und -Partys"), just "{Genre}-DJs" without upcoming nights.
  An alias slug (`/genres/hardtechno`) answers 308; a family slug that is not
  a genre (`/genres/electro-wave`) answers 308 to `/djs?sound=…`, in the page
  and its metadata alike; an alias of a canonical genre wins over a family of
  the same name (`/genres/bass` is Bass Music and answers 308 to
  `/genres/bass-music`); unknown taxonomy genres 404. A recognized genre retains its honest empty200
  page when no DJs or upcoming nights remain, with noindex,follow; a city
  filter that empties a populated genre is also its empty state. `/genres` and `GenreLinks`
  (`listedGenreSlugs`) only link genres with listed DJs or upcoming nights. Family and genre slugs never collide because only genres have
  pages under `/genres/`; families are sections of `/genres` and the `sound`
  filter of `/djs`. The page lists the genre's DJs and its upcoming nights
  (`EventList`, first 8, then a link to the home filter), a "Gigs in" city
  filter (`city=`, applied to DJs and nights) and the family's other genres
  as navigation chips. Desktop puts the nights in a side column; phones get a
  jump link. A factual "Über diese Seite" paragraph closes the page.
- `/genres` "Techno-DJs nach Genre": families in taxonomy order with their
  genres that have DJs or upcoming nights, DJ and night counts, and a family
  link to `/djs?sound=…`.
- DJ rows are compact programme rows: motif tile, name (one link stretched
  over the row), up to two genres, "N Gigs · Köln, Stuttgart +1" (with a
  city: "N× in Berlin") and the next night ("Nächster Gig …") or, without
  one, the last ("Zuletzt …"). Counts include announced nights, so nothing
  says "played" for a booking that has not happened. The one action is
  "Anhören" for a DJ with SoundCloud: the line-up toggle (`ListenButton` /
  `ListenPanel`), one player at a time across the whole list, behind the
  SoundCloud consent; without JavaScript it is the profile link. DJs with
  SoundCloud come first and sit under their own heading ("Auf SoundCloud",
  then "Ohne SoundCloud"). On a genre or sound page a row lists the page's
  genre first, then fills up to two.
- The list shows 60 rows; a server-rendered "Weitere DJs anzeigen" link adds
  60 (`limit=`, anchored to the first new row) up to 180, after which the
  page asks for a city or sound. After the soft navigation focus moves to the
  first new row's name link (`FocusRow`); without JavaScript the hash scrolls
  to it.
- DJ and event pages link their genre tags to genre pages; a DJ page offers
  "Mehr {Genre}-DJs" for its first two directory genres, an event page for
  its first canonical genre. The DJ page back link leads to `/djs`.
- SEO: base pages self-canonical and indexable (sitemap lists `/djs`,
  `/genres` and every indexable genre page). A genre page with fewer than
  five DJs and no upcoming night is noindex and stays out of the sitemap.
  Filtered, longer and malformed variants (`city`, `sound`, `genre`,
  `limit`) canonicalize to the base page and are noindex,follow; demo pages
  are noindex. JSON-LD carries the base page URL, never a filtered or paged
  one. JSON-LD: CollectionPage whose `mainEntity` is an ItemList of
  `ListItem.item` Person nodes (`@id` `/djs/{slug}#person`, the DJ page's
  entity; at most 50, no `itemListOrder`, since the order is not a ranking).
  Genre pages add their upcoming nights as a URL-only event list
  (`hasPart`); `/genres` lists genre page URLs. Breadcrumbs: Startseite › DJs
  and Startseite › Genres › {Genre}. Demo catalogues emit no people or
  events.

Known limitations: a city chip counts DJs with any gig there, past or
announced; the directory has no separate "played" filter. Genre city
variants (`/genres/techno?city=berlin`) stay noindex until counts justify
their own pages.

## Event lifecycle (2026-10-22)

Existing event slugs retain HTTP 200 detail pages after expiry, with localized
self canonical/alternates and factual MusicEvent data. Archived details are
noindex,follow and excluded from the dynamic sitemap; unknown slugs remain 404.
No cleanup removes event rows or changes slugs on expiry.

An explicit end is authoritative: visibility stops at that instant (exclusive).
With no end, discovery retains the event until 09:00 on the next calendar day
in its venue IANA timezone, exclusive, including DST changes. This is a display
cutoff, never a sourced end time; omit endDate from schema and never call these
events running. Previous-day retained events match Today and keep their actual
start date in the existing day group, labelled Started yesterday/Beginn gestern.
All public upcoming counts, lists, metadata and sitemap use the same policy.

Acceptance: midnight, 08:59:59.999/09:00, Berlin DST transitions, another timezone,
explicit ends, missing endDate, archived/current robots, retained/unknown URLs,
and localized canonical/alternates. Dynamic pages stay uncached across expiry.

## Genre URL continuity (2026-10-22)

Historical `/genres/<genre>|<city>` scroll-state-shaped URLs (literal pipe or
percent encoded, both languages) permanently redirect to the recognized
canonical genre with its real catalogue city as `?city=`. A recognized genre
with a trailing empty pipe redirects to its base genre page. Genre/city
spelling aliases normalize in the same redirect. Unknown genres, unknown
cities and multiple delimiters remain404; no unrelated fallback is used.
Metadata and rendering share `src/app/genres/genre-routing.ts`. The scroll
effect receives an opaque JSON genre/city key, never a URL-shaped dependency.
Actual navigation uses href query strings. Sitemap/canonicals/hreflang/JSON-LD
keep their existing canonical genre policy; city variants stay noindex,follow.
Known empty taxonomy pages remain200/noindex after inventory expiry and stay
out of sitemap/navigation counts until the existing thresholds are met.

Acceptance: the four GSC examples, literal/%7C/DE/EN/aliases/trailing pipe,
malformed/unknown404, no redirect loops, correct destination city filter, no
URL-shaped pipe leak in HTML/RSC/links/schema/sitemap, known empty200/noindex
and preserved canonical/indexing thresholds. A URL-shaped serialized dependency
was observed in production; Google's exact discovery mechanism is unproven.


## Night map

The map is not a separate screen: the home page is one surface where the
map and the programme show the same nights. Code: `src/core/night-map.ts`
(positions and grouping), `src/components/night-map-data.ts` (server-side
card facts), `src/components/night-explorer.tsx` (layout, cards, player),
`src/components/night-map-view.tsx` (MapLibre, loaded lazily),
`src/lib/map-themes.ts` (the "Nachtkarte" theme), `src/app/night-map.css`.

Layout. Phones: the heading row (H1, count, "Reels"), then the map stage
filling the rest of the first screen, then search, filters and the list.
From 1000px: the programme (heading, search, filters, list) in a left column
and the stage sticky on the right under a sticky header. The stage is the
map with a strip of night cards under it. "Vollbild" opens the stage over the
whole viewport (the page behind is inert, `#karte` is set with
`replaceState`, Escape or "Liste" closes it) with a compact date and sound
chip row; those chips keep `#karte`. Without JavaScript the stage is hidden
and the programme works as before.

What is plotted. Exactly the scheduled nights of the current home filters
(`q`, `when`/`date`, `city`, `sound`, `genre`; `limit` only pages the list).
Cancelled listings stay in the list but are never a point or a count. A
venue with stored coordinates (`latitude`, `longitude`, confirmed through the
artist flow's OSM lookup) is a solid lime point at the club, labelled with
its name. Any other venue falls back to its city's GeoNames centre and is a
hollow ring labelled with the city, shared by all such venues of that city;
cards, the panel and the legend say "Lage ≈" / "Ungefähr: Stadtmitte". A
venue with neither stays off the map and the panel names it ("N Nächte ohne
Kartenposition (…) – in der Liste"). 0,0 or half coordinates count as
unknown. Points cluster up to zoom 10; a heat glow marks busy regions at low
zoom; tonight's points (venue-local today, or started yesterday and still on)
pulse (still under reduced motion).

Interaction. Tapping a point selects it: the card strip shows that place's
nights; an exact venue flies in with a tilted 3D view (zoom ≥ 15), an
approximate ring only frames the city. Tapping a cluster zooms into it,
tapping empty map clears the choice. Without a choice the strip lists the
nights inside the visible area, soonest first (at most 30 cards, then a link
to the list). Hovering a list row (fine pointers) rings its point; on touch
screens the card in front of the strip rings its point. A city filter change
frames its nights; other filter changes keep the view. On first load the map
frames all filtered nights, or, without a city filter, the visitor's stored
Reels place and radius. "In meiner Nähe" asks for the position once, never
stores or sends it, shows it as a ring and frames the closest points within
60 km, or says how far the closest one is. "Alle zeigen" frames everything.
Cards: big mono date and time ("Heute · 23:00"), title (one link to the
event, stretched over the card), up to three lineup names "+N", up to three
genres, venue · city with "Lage ≈" when approximate, distance once the
position is known ("≈" for city centres), a taste line, "Anhören" when a
lineup DJ has a verified SoundCloud profile and lime "Tickets" when a ticket
URL exists. Card titles are not headings.

Listening. One SoundCloud widget for the page (`useSoundcloudPlayer`, shared
with Reels, guarded against calls to a removed iframe). "Anhören · N DJs" in
the panel plays the DJs of the nights in view (or of the chosen place),
ordered by `rankListening`: the Reels taste first, then how soon they play,
disliked DJs left out. A card's "Anhören" plays that lineup in billing order,
then continues with the area. The player docks under the stage on wide
screens and at the bottom of the viewport on phones (the page gets matching
bottom padding) and stays while filters change. It shows the status, the DJ
(link to the DJ page), the playing upload, the DJ's night (tap to select it on
the map), "SoundCloud ↗", Like, Nicht meins, Nächster DJ and close. The
playing DJ's night gets a lime ring, its card says "Läuft: …" and the map
eases to it when it is off screen. A profile without public uploads is
skipped after a short notice. Likes and dislikes are written to the Reels
store (`evryvibe.reels.v1`, settings kept), so both surfaces learn together;
points with a liked DJ get a thin outer ring and their cards name the DJ.
Consent: nothing loads from SoundCloud before the SoundCloud choice is
accepted. Unset or rejected, "Anhören" opens the dock with the disclosure,
"SoundCloud laden und abspielen" (accepts SoundCloud only, then plays) and
the plain "Auf SoundCloud anhören" profile link. Withdrawal removes the
iframe.

Map rules (itstiles.com, `tilesserver/docs/`). MapLibre 5.24.0, pmtiles
4.3.0 and @protomaps/basemaps 5.7.2 stay pinned to itstiles' tested set; the
archive URL is resolved from the manifest at runtime; `src/lib/itstiles.ts`
and `ItstilesMap.tsx` stay copies of the guide. The theme hides POIs, house
numbers, shields and one-way arrows, sets place names in wide-tracked
capitals (Noto Sans Medium, the only hosted fonts besides Regular/Italic),
extrudes buildings from zoom 14 and keeps label contrast ≥ 4.5:1 on both
grounds (tested). Own layers are re-added after every style load; glow and
heat sit under the basemap labels, points, counts and labels above them (the
count claims its space so basemap names step aside). The attribution stays
expanded and visible: "itstiles.com · Protomaps © OpenStreetMap" plus
"GeoNames (CC BY 4.0)" for city centres. Map labels follow the page language.
The map is created after hydration when the browser is idle, uses
cooperative gestures inside the page and plain gestures full screen, and is
removed on unmount (one `.maplibregl-map` after navigating away and back).
Attribution strings must be first-party constants and popups are React,
never `setHTML` (lint rule; maplibre-gl ≤ 6.4.0 has GHSA-jrc7-96c5-q579 in
its attribution sanitizer).

Known limitations: most venues have no stored coordinates yet, so most
points are approximate city rings. Tiles come from one itstiles.com server
(no SLA); if it is down the stage shows "Karte lädt …" and the cards still
list the nights. SoundCloud's widget is light in both themes. Map interaction
is not keyboard-complete (the cards and the list are the accessible path).

The night-card panel reserves a fixed 132px on phones/tablets and 280px on
desktop in every selection and empty state. Mobile shows only the swipeable
cards, without the panel heading or area listening button; per-event listening
and ticket actions stay at least 44px and sit beside the card facts. Ticket/listening buttons and taste rows cannot resize the map canvas:
otherwise a viewport-edge venue can repeatedly enter/leave the visible bounds.
