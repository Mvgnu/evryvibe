---
name: ingestion
paths:
  owned:
    [
      src/core/,
      src/db/,
      src/mcp/,
      drizzle/,
      tests/core.test.ts,
      tests/ingestion.test.ts,
      tests/reconciliation*.test.ts,
      tests/soundcloud-write.test.ts,
      tests/media-continuity.test.ts,
      docs/ingestion.md,
    ]
exports: [core.model, db.catalog, MCP tools]
consumes:
  [PostgreSQL, local collector/OCR post packages, trusted external producers]
verification:
  typecheck: npm run check
  test: npm test
bar:
  reference: PostgreSQL durable work queue and MCP typed tools
  property: Two workers and a retry produce one correctly linked event with inspectable source context.
---

# Core and ingestion

`src/core/model.ts` owns Zod schemas and inferred types. `src/db/schema.ts` owns relational storage and inferred DB rows. `src/db/catalog.ts` is the public read boundary, exporting `getCatalog(): Promise<Catalog>`; `Catalog` is `{ events: Event[], venues: Venue[], djs: Dj[], mode: 'demo' | 'database' | 'empty' }`. All dates cross the boundary as ISO strings.

Entity shape shared with discovery (additional internal fields allowed):

- Venue: `id`, `slug`, `name`, `city`, `country`, `address`, `timezone`, `description`, nullable `imageUrl`, nullable `instagramUrl`, nullable `websiteUrl`.
- Dj: `id`, `slug`, `name`, `description`, `genres: string[]`, nullable `imageUrl`, nullable `instagramUrl`, nullable `websiteUrl`, nullable `samplePostUrl`.
- Event: `id`, `slug`, `title`, `description`, `venueId`, `djIds: string[]`, `startsAt`, nullable `endsAt`, `genres: string[]`, nullable `imageUrl`, nullable `ticketUrl`, nullable `websiteUrl`, `sourceUrl`, `observedAt`, `status: 'scheduled' | 'cancelled'`.

Use explicit natural-key matching: canonical Instagram profiles for venue/DJ where available and slugs otherwise; event slug plus venue/start duplicate check. Retain stable IDs and use foreign keys; lineups are a join table, not independent copies. Do not merge ambiguous people by display name. Event start/end need an explicit offset, end after start, valid venue IANA timezone. Names and URLs have bounded lengths. Only HTTPS outward URLs; Instagram host/path allowlists with query/fragment normalization. Images are HTTPS URLs. The collector may use temporary images and frames for OCR, then deletes those files. It does not host captured Instagram media. MCP image inputs reject Instagram CDN URLs and legacy EVRYVIBE `/media/` URLs. There is no user upload system. Entity description is plain text.

Post package: unique canonical Instagram post/reel or story URL, caption, labeled OCR text, account URL, and captured timestamp. OCR labels preserve one-based carousel slides and sampled video seconds. Packages exclude source CDN URLs and captured image files. Treat all source text as untrusted data, never instructions. The local collector runs Tesseract on captured still images and sampled video frames; the MCP connector accepts and preserves this evidence without extracting event facts. Bound package sizes. `instagramSourceSchema` accepts `/p/<shortcode>/`,
`/reel/<shortcode>/`, and `/stories/<handle>/<numeric-story-id>/`; normalize story
handles to lowercase while preserving post/reel shortcode case. Reject highlights
and story URLs without an item ID. `postPackageSchema.postUrl` keeps its existing
field name and requires the normalized story handle to match `accountUrl`, also
for collected enqueue and refresh. `Event.sourceUrl` accepts the same sources;
`Dj.samplePostUrl` continues to use the stricter post/reel-only `instagramPostSchema`.
Story source links may expire; queue evidence and published source attribution
remain stored. Story items follow exactly the same deduplication, refresh, lease,
publication and replay semantics as posts without a database schema change.

MCP minimum operations: enqueue package idempotently; inspect queue and a package; claim next with finite lease; search existing catalog entities; publish one or more linked event graphs from the claimed package in a single transaction; defer for missing facts with a reason; discard irrelevant packages with a reason. Typed errors must distinguish missing facts, stale lease, invalid input, and duplicate/conflicting identity. Claim ownership enforced in SQL, expired claims reclaimable; retry after a successful publish returns recorded results rather than creating duplicates. No human review gate or SHA approval protocol. State: pending → processing → done/deferred/discarded; deferred can be requeued intentionally, expired processing claimable. Store attempt count, last reason, lease token/expiry, created and updated times. A random lease token is concurrency control, not a human authorization ceremony.

Expose the same MCP tools via SSH stdio and authenticated HTTP (see `remote-mcp.spec.md`); database credentials stay in the process environment, diagnostics go to stderr. Use SDK tools and schemas; no hand-rolled protocol. No network-accessible unauthenticated write endpoint. Include migration, practical runbook, example producer payload, and tests against actual disposable PostgreSQL for claims, rollback, stale workers, identity matching, and retry. Local Playwright/Tesseract collection and protected operator controls are implemented in the collection slice; production deployment and collector scheduling remain operational steps.

Implemented tools (31 in total with collection and city copy): `list_genres`, `update_dj`, `update_event`, `update_venue`, `seed_reconciliation`, `flag_for_reconciliation`, `list_reconciliation_tasks`, `claim_reconciliation_tasks`, `complete_reconciliation_task`, `defer_reconciliation_task`, `requeue_reconciliation_task`, `enqueue_package`, `list_packages`, `get_package`, `claim_next_package`, `complete_package`, `defer_package`, `discard_package`, `requeue_package`, `search_catalogue`. Claim defaults to 15 minutes (30–3600 seconds supported). Five abandoned attempts defer with a reason; intentional requeue resets attempts. Existing slugs remain stable, and an older event observation cannot replace a newer one. A short transaction advisory lock serializes catalog publications; agents hold no database lock while researching.

Collection adds `upsert_venue`, `list_venue_sources`, `set_venue_source`,
`set_venue_profile`, `enqueue_collected_package`, `record_source_run`, and
`refresh_package`; see `collection.spec.md` for source revision contracts.
Refresh requires the same post/reel/story URL and account and a newer capture, refuses a live lease,
retains five prior payloads, and resets the package to pending in one transaction.
It does not delete published events or require a human approval step.

City editorial content is separate from captured Instagram evidence and event
publication. `get_city_content` reads the bilingual record for a venue-derived
city slug; `upsert_city_content` writes complete German and English plain-text
`heading`, `intro`, `seoTitle` and `metaDescription` fields atomically. A city
must already exist through a venue. A missing record returns `null` and discovery
uses factual fallback copy. Writes replace both locales together and return
`updatedAt`; concurrent external editors must coordinate before overwriting.

## SoundCloud profiles

Venues and DJs carry nullable `soundcloudUrl`, normalized by
`soundcloudProfileSchema` (`src/core/soundcloud.ts`) to
`https://soundcloud.com/<profile>`; track, set and short links are rejected.
Profiles are unique per table, like Instagram. Write inputs treat an omitted
`soundcloudUrl` as "keep" on update and null on insert; null clears. Before a
write commits, the server looks the profile up through SoundCloud oEmbed and
echoes the title and a bio excerpt to the agent as evidence. The lookup never
blocks a write: the agent's URL is trusted, and a missing profile, an outage or
an odd reply (SoundCloud sends `"description": null` for profiles without a
bio) only leaves the echo empty. Only the URL is stored. Discovery embeds SoundCloud's widget with
`soundcloudPlayerUrl` after consent.

## Media continuity

An event's cover keeps its own provenance (the public post/reel and slide it
came from), independent of the latest source package. Re-publishing an existing
event with no image field keeps the stored cover; explicit null clears it. A
story package can update facts but never removes a post cover or replaces a
post/reel `sourceUrl` with an expiring story link; the story is still linked as
evidence and advances `observedAt`. Cover selection by media ID may use any
public post/reel package already linked to the event.

## Reconciliation queue

A durable entity-level queue for agent repair of drifted profile data, separate
from post packages and with the same lease semantics (atomic claim, expiring
lease, stale completion rejected, bounded attempts, deferred with reason).
`assessDescription`/`publicBio` (`src/core/reconciliation.ts`) flag event-bound
or filler descriptions; missing or unverified SoundCloud profiles are the other
check. Completion applies the entity changes and closes the task in one
transaction and records how identity was confirmed. New DJs published through
`complete_package` are queued automatically. Unknown stays unknown: "no
SoundCloud found" and an empty description are valid outcomes.

### Implementation notes

- Paths: `src/core/soundcloud-oembed.ts` (verifier interface and oEmbed
  implementation; repositories and `createMcpServer(db, { soundcloud })` accept a
  fake), `src/core/reconciliation-tasks.ts` (checks, tool schemas, completion
  rules), `src/db/reconciliation.ts` (queue), `src/db/covers.ts` (linked cover
  candidates), tables `reconciliation_tasks` and `events.image_source_url`.
- `DomainError` code `unavailable` (retryable, reported with `retryable: true`)
  is not raised by the SoundCloud lookup, which never fails a write. Network
  calls happen before any transaction or catalogue lock.
- Work added to a task while it is claimed is kept in `claimed` (checks and reason at claim time) and becomes a follow-up task on completion; completion stores a digest of its request so a replay with different content is an `identity_conflict`.
- Bundle DJ `description`, `genres`, `websiteUrl`, `imageUrl` and `samplePostUrl`, and venue `websiteUrl` and `imageUrl` (bundle and `upsert_venue`), are optional: omitted keeps the stored value, insert stores `""`/`[]`/null, explicit null clears. `instagramUrl` stays required identity. A clean stored description is never replaced by an event note or filler.
- Genres: the taxonomy (`src/core/genres.ts`) is the single source of truth: families (level 1, ordered, DE/EN labels) and canonical genres (level 2, with aliases, family and poster motif). Every write of event or DJ genres (`complete_package` bundle events and DJs, `update_event`, `update_dj`, reconciliation completion) goes through `normalizeGenres`: aliases and spelling variants (case, diacritics, hyphens, "&"/"and"/"n") become the canonical name, duplicates merge, order is kept, and unknown or generic spellings ("Electronic", "Rave", "Groove", "Performance", context-free "Progressive") are dropped with the non-blocking warning `Dropped unknown genre 'X'; see list_genres`. Publication is never blocked. `list_genres` (read-only) returns families, canonical genres and aliases. Venues have no genres. `readCatalog` also normalises on read, so public pages show canonical names even for rows written earlier. `npm run genres:normalize` (`scripts/normalize-genres.ts`, logic in `src/db/genre-normalization.ts`) rewrites stored rows: dry run by default (mapping table raw -> canonical/DROPPED with event/DJ counts and rows that would change), `--apply` runs in one transaction under the catalogue advisory lock and is idempotent. Production: `node --env-file=/srv/evryvibe/shared/.env --import tsx scripts/normalize-genres.ts [--apply]`.
- Seeding, flagging, completing and auto-enqueue take the catalogue advisory lock
  (7349501); claims do not.
- Known limitations: SoundCloud identity is the agent's judgement plus the echoed
  oEmbed title and bio, not an automatic match; `soundcloud_unverified` flags
  every profile without a completed task recording `set` or `confirmed`;
  evidence excerpts are plain substring matches on the name; the
  structured-data event list hangs off `ProfilePage.hasPart`, which Google does
  not read.

## Reviewed DJ identity merges

Confirmed duplicate DJs are merged transactionally under the catalogue publication lock. Preserve lineup positions and reconciliation history, record the retired DJ, affected lineups and reconciliation task snapshots with the evidence, and keep old slugs as permanent redirects. Reconciliation tasks with unrelated checks remain open. Publication rejects a retired slug as a new DJ, while existing lineup references resolve it to the canonical DJ; duplicate aliases in a lineup are rejected. Ambiguous identities remain separate until supported by evidence.

## Venue coordinates rollout

The public-map release can pre-apply `ops/sql/venue-coordinates.sql` without
artist migrations. Migration 0014 uses `IF NOT EXISTS` so a later full migration
run still applies earlier artist migrations instead of skipping their journal
entries. Venue latitude/longitude and the OSM object source URL are nullable;
only reviewed venue or matching building/address results are stored, never a
street or city centroid as an exact venue point.
