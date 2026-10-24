---
name: collection
paths:
  backend: [src/core/, src/db/, src/mcp/, drizzle/, tests/sources.test.ts]
  collector:
    [
      src/collector/,
      scripts/collect.ts,
      scripts/instagram-login.ts,
      tests/collector.test.ts,
    ]
  operations: [src/ops/, src/app/ops/, tests/ops.test.ts]
exports: [venue source controls, local Instagram collection, OCR post packages]
consumes: [ingestion, local Tesseract, Playwright, stdio MCP]
bar:
  reference: Existing Instagram flyer and original venue profile
  property: Only enabled venue profiles produce packages; agents receive faithful caption and per-image OCR with working source context, and failures are retryable.
---

# Venue collection and operator surface

User authorized adapting the original scraper's capture flow. Original code/data remain read-only; no hardcoded credentials, history files, implicit LLM extraction, Sheets, or insecure browser flags carry over. Use Playwright (already installed) and local Tesseract. No new hosted OCR provider is needed.

## Source control contract

Venue collection configuration is separate from public venue models. Default disabled. One canonical Instagram profile per venue, taken from `venues.instagramUrl`. Changes to that profile must invalidate prior source config/run revisions. Enabling requires a profile. Existing event ingestion must not silently enable scraping.

`VenueSource` returned by tools: `{ venueId, slug, name, city, instagramUrl: string|null, enabled: boolean, revision: number, lastStartedAt: string|null, lastSucceededAt: string|null, lastError: string|null, lastPostCount: number }`.

MCP tools (Zod-validated):

- `upsert_venue`: `{ venue: VenueInput }` creates/updates a standalone venue, using current identity rules. Required to bootstrap before events exist. Does not enable collection.
- `list_venue_sources`: `{ enabledOnly?: boolean }` → `{ sources: VenueSource[] }`.
- `set_venue_source`: `{ venueId, enabled, expectedRevision }` → `VenueSource`. Revision check prevents stale operator changes. Updates increment revision.
- `set_venue_profile`: `{ venueId, instagramUrl: string|null, expectedRevision }` → `VenueSource`. Explicit correction by stable venue ID; reject another venue's profile. A changed profile disables collection, increments the revision, and clears previous run timestamps/error/count. An unchanged profile is a no-op. Ordinary entity upsert continues to protect identity.
- `enqueue_collected_package`: `{ venueId, expectedRevision, package: PostPackage }` → existing package result. Transactionally reject disabled/reconfigured source or mismatching account URL. Call the same queue write logic as ordinary enqueue; no duplicate queues.
- `record_source_run`: `{ venueId, expectedRevision, startedAt, finishedAt, postsQueued, error: string|null }` → `VenueSource`. Record useful outcome only for matching revision; late outcomes cannot overwrite newer runs. No fabricated success when a collector failed.
- `refresh_package`: `{ packageId, package: PostPackage }` explicitly replaces corrected/newer captured material and requeues atomically. Same canonical source/account; newer capturedAt required. Reject while a live processing lease exists, revoke expired claims, clear completion state; preserve the five most recent previous payloads in database history. Existing published events remain. This is correction, not a review gate.

Source setting and queue acceptance must share row locking, so switching off blocks later submissions. A collector already fetching a post may finish that browser request, but the disabled source cannot enqueue it. Operations do not delete existing events or queued data. Source registration never enables collection or scheduling implicitly. `npm run collect` is an explicit sequential run; production scheduling requires installation of the timer described below.

## Collector

`npm run instagram:login`: open visible browser with dedicated persistent state directory under ignored `.local/instagram/`; user completes login/checkpoint in provider UI. No copied password/cookie defaults, browser-security disable flags or password logging.

Optional `--import-cookies <path>` imports an explicitly supplied JSON cookie
array restricted to Instagram domains into that dedicated session. Expired
cookies are excluded; imported access is still checked by collection.

`npm run collect`: get every enabled source through MCP; capture all active stories, then the six latest posts/reels. OCR each still image, including carousel frames, and submit through `enqueue_collected_package`. Keep canonical source permalinks and labeled OCR text with one-based slide numbers for stills and sampled seconds for video frames. Transient image downloads and sampled frames are deleted after OCR; packages may keep refreshable public post/reel cover URLs but never image files, story CDN URLs or sampled frame URLs. Do not select captured frames as event images. Story inventory comes from attributable data on the authenticated Instagram page, including seen stories. Videos in stories, posts, reels and carousel slides add representative OCR frames at the start, 1 second, 2 seconds, midpoint and near the end (clamped and deduplicated for short clips); this is explicitly labeled as sampling, not full video transcription. No audio/video hosting.

Production collection runs on the OVH worker `51.195.109.173` at 00:00, 03:00,
18:00 and 21:00 Europe/Berlin, with up to 12 minutes of jitter and no catch-up.
Every Berlin local day has a deterministic, varying 6–10 hour Instagram rest
window centered on 12:30 (start 07:30–09:30, end 15:30–17:30). Scheduled and
manual collection skip starts during rest. An active run pauses between sources
and individual stories/posts; the supervisor ends the whole process group at
the boundary or after 20 minutes without progress. There is no venue-count or
whole-run duration cap. A shared lock prevents collector and cover-refresh
overlap; systemd cgroup cleanup prevents orphaned Chromium children. A persistent
authenticated browser profile is reused on disk, but Chromium is restarted
between venues to bound memory. Sources and content stay sequential, ten
seconds between venues and five seconds before post/story navigation. Sources
with the oldest `lastStartedAt` run first; null timestamps take priority.
Runs that cannot record status log that limitation.

Inspect the latest six posts per venue and all active stories available to the
authenticated account. Prefer attributed provider timestamps for post order; use
the non-pinned profile grid when timestamps are absent. Select the six before
skipping known items, rather than walking older history to find six unseen posts.
Acknowledged sent packages remain known across source revisions when the account
matches; a changed account never inherits the old account's history. Skip known
items before navigation/download/OCR; sent files retain durable collection history. No separate CLI limit override. Missing or inaccessible
provider content must be reported rather than presented as complete coverage.

Login/checkpoint, HTTP 401/403/429, Instagram subresource HTTP 429, and recognized
rate-limit/activity restriction messages stop the entire run after recording the
source failure. A private atomic collector-state file stores a 24-hour cooldown;
all subsequent runs honor it before making provider requests. No immediate retry
or automatic login/challenge bypass. Ordinary per-story/post failures retain successful packages and allow the other
items and the post branch to run; the source records an aggregate partial-failure
error before moving to the next venue after the normal ten-second gap. Timer scheduling is
low traffic pacing, not a guarantee against provider limits. Credentials and cookies
stay in the dedicated persistent browser state, never in logs or source packages.

Original captions come from media data with the exact source shortcode and an
attributable owner or declared collaborator. Explicitly empty provider captions
are valid; missing evidence is an extraction failure. Scoped DOM fallback waits
up to five seconds for caption hydration and excludes nested replies. Metadata
fallback also requires the exact source permalink and posting account. Conflicting
attributable caption data fails explicitly rather than choosing arbitrary text.

Capture fails explicitly on login/challenge/private/unavailable profile and ambiguous post scope rather than returning false empty success. Bound individual navigation, image sizes, carousel frame counts and OCR operations; do not impose a whole-run duration or venue/story count cap. Restart the authenticated persistent browser between venues so a long walk cannot accumulate Chromium memory. A manual `--venue=<slug>` run may inspect and collect one enabled source without changing its enabled state or the nightly all-source traversal. Do not mix profile avatars/recommended-post images with flyer content. Raw caption and OCR are untrusted source data; infer no event year, venue address, lineup, or genres.

Download images only from validated HTTPS Instagram media hosts; do not follow redirects into arbitrary/local networks. Use scoped session cookies only inside browser requests to Instagram. Prepared packages remain on ignored local disk until MCP acknowledges; retry is idempotent. Disabled/stale source cannot be bypassed by the spool. Persist source revision with prepared work. Logs avoid credentials, cookies and raw signed media URLs.

The worker reads and writes venue source state and OCR packages through the
origin's existing forced-command SSH MCP connection, restricted to the OVH
worker address. The origin retains Postgres, queue and public site; it has no
scheduled Chromium jobs. Worker-local browser state, spool and cooldown are
backed up privately at noon during the rest window, excluding regenerable
browser caches. The origin's own backup no longer covers new collector state.

Tests cover injected pacing, complete-source traversal, Berlin night/DST boundaries, durable access cooldown, pre-navigation sent-post skipping, HTTP/text rate-limit failures, enabled/disabled/changed revision, real Tesseract fixture OCR, retry after enqueue failure, carousel images and isolation from unrelated media, bounded failure, and actual MCP submission. A legacy downloaded flyer may be used locally for OCR verification without publishing inferred event data.

## Operator surface

`/ops/sources` is a small authenticated operator page, separate from discovery. One configured `EVRYVIBE_OPERATOR_PASSWORD` protects it (HTTP Basic, username `operator`); absent configuration denies access. It lists venue/profile, enabled switch, recent success/error and queued count. Add a venue through a complete validated form when needed. No tenant/account/role system.

All operations use the stdio MCP tools; no duplicate direct database write path. Native server forms with precise errors; revalidate after toggles; POST actions verify auth and request origin. Operator credentials never go in URLs or client bundles. Read-only public visitors never see scraping controls. Read local installed Next docs before implementing server routes/actions.

## Acceptance and Gauntlet

1. Register a venue with Instagram profile; it starts disabled.
2. Turn on, run bounded collection, inspect real OCR in the queue and run status.
3. Turn off or change profile during collection; pending submission fails cleanly.
4. OCR/network/enqueue failure preserves retryable work and an actionable error.
5. Agent claims OCR package and publishes through existing transactional flow.
6. Independent critics inspect actual collector artifacts, protected operator interactions and the complete public discovery/event/venue/DJ surfaces at desktop and mobile sizes.

## Observed live collection

On 2026-09-21 at 13:39 UTC, the real post
`https://www.instagram.com/p/Dc_YFudiJy6/` yielded one image, 1,282 caption
characters and 1,010 OCR characters, and was queued in an isolated test database.
Zero public events were created, and the source was disabled after verification.
Sanitized evidence is in ignored `.local/collection-verification.json`. This
checks collection/OCR/queue submission, not live embed playback or a production
catalog. The runbook is `docs/collection.md`; production scheduling and origin
verification are recorded in `docs/deployment.md`.

A later read-only VPS verification on 21 September 2026 used the existing saved
session and captured all three active stories for the same venue: one image and
two videos, each video with three representative OCR frames. Latest-profile
discovery returned six recent posts despite two pinned entries. No production
queue/catalogue records were created. Sanitized artifacts are retained privately
in `/srv/evryvibe/shared/story-probe/`.

Media references are deterministic source-scoped IDs: `ig:<shortcode>:slide:<one-based-slide>:image` identifies a still or reel thumbnail; sampled OCR frames use `ig:<shortcode>:slide:<slide>:frame:<seconds>`. Stories use `ig:story:<numeric-id>` as the prefix. The `/p/` and `/reel/` routes for one shortcode have identical IDs, and refreshing signed CDN URLs preserves them. Post package parsing adds IDs to older image candidates and rejects supplied IDs that disagree with the source/slide. Collector OCR labels identify their exact media ID, including story posters and sampled frames. Queue reads also label legacy OCR where its slide/frame provenance was explicitly captured; unlabeled historical OCR remains unassigned. `complete_package` accepts `imageMediaId` in event inputs, resolves its URL from that package, and rejects IDs belonging to another source/frame. Existing URL input remains supported.

Cover refresh also refreshes the matching package candidate URL cache by source/slide, preserving media IDs, caption, OCR, timestamps and queue state. Later ID-only edits resolve the fresh signed URL.

## Extra Instagram enrichment disabled (21 October 2026)

Normal collection continues to supply source URLs, OCR, `imageCandidates` and
media IDs. Publication and corrections use that stored provenance. Public cover
images use the existing crawl-supplied URL after consent; unavailable images keep
the existing artwork/source/embed fallback. No server-render path refetches them.

The separate cover-refresh command is retired, including `--force`: it returns
a disabled result without network or database access. The OVH
`evryvibe-worker-covers.timer` is disabled; the origin refresh timer was already
disabled. Normal collector and backup schedules remain unchanged. A posterless
reel no longer triggers an extra `/embed/` request during collection; its video
OCR remains valid and its missing cover stays unknown. Do not re-enable extra
enrichment or add fallback Instagram fetches.
