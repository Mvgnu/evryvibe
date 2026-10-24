# EVRYVIBE origin deployment

Installed on **87.58.154.89**, release `/srv/evryvibe/releases/20261015-dj-directory`, active
through `/srv/evryvibe/current`. Public domain: **https://evryvibe.com**.
Cloudflare is authoritative and HTTPS is active as of 21 September 2026. Some
recursive resolvers may retain the previous parking records until their TTL expires.

## What is running

- `evryvibe-mcp.service`: authenticated HTTP MCP on IPv4 loopback port 3301,
  enabled on boot. Public OAuth PKCE, all 31 tools (since 13 October), source/queue reads and grant
  revocation verified through Cloudflare without catalogue writes.
- `evryvibe.service`: Next.js on IPv4 loopback port 3300, restart on failure,
  starts on boot. nginx routes only the EVRYVIBE hostnames to it.
- Dedicated Unix account, Postgres role/database `evryvibe`, migrations through
  `0010_reconciliation_claim_snapshot`, private environment outside releases. Real inventory is supplied and
  maintained through MCP; deployment checks must preserve it.
- German default, English `/en`, both themes, bilingual legal pages, canonicals,
  alternate-language links, sitemap and truthful entity/source structured data.
- `evryvibe-backup.timer`: daily protected origin/database backup. The origin's
  `evryvibe-collect.timer` and `evryvibe-cover-refresh.timer` are disabled.
- The OVH worker at `51.195.109.173` runs Chromium, OCR and cover refresh using
  the existing source controls and queue over forced-command SSH MCP. It keeps
  its own browser login, retry spool, cooldown and private daily backup; see
  the 25 September worker cutover below. No database credentials moved to OVH.
- `/api/health` checks database/schema readiness with a bounded timeout.
  nginx access logging is disabled; dedicated error logs and journal retain
  at most approximately 14 days. First-party Minilytics forwards public visit
  events to the registered `evryvibe` site on OVH; see [analytics](../specs/analytics.spec.md).

Next 16 normalizes rewrite origins from `127.0.0.1` to `localhost`. The service
therefore uses `--hostname localhost` and Node `--dns-result-order=ipv4first`:
this still binds only 127.0.0.1, but preserves the English rewrite header. Do not
replace it with `--hostname 127.0.0.1`. Both HTTP and HTTPS-forwarded language
requests were checked.

## Supply inventory through MCP

[Production MCP configuration](../ops/mcp/production.json) starts the connector
through `ssh -T evryvibe@87.58.154.89` using the existing authorized SSH key. The
account is restricted to the MCP command, with no interactive shell or forwarding.
Database credentials stay on the server. All 31 tools are available. See [ingestion](ingestion.md) for source registration, targeted corrections, media IDs, publication and city editorial copy.

ChatGPT account setup completed through the user's signed-in Chrome session on
21 September 2026: **EVRYVIBE** is installed, OAuth is connected to the primary
account, and 18 actions were discovered after the 23 September cover refresh. The current shared factory exposes 31 tools (13 October), including the city-content, `update_dj`, `update_venue`, `update_event` and reconciliation tools. The app ID is
`asdk_app_6ab1431a477081918a09b287438205da`. Default ChatGPT permission settings
remain in place. The local parking DNS cache expired and ordinary browser access
now succeeds without resolver overrides.

Remote transport is configured at `https://evryvibe.com/mcp` for ChatGPT.
`evryvibe-mcp.service` listens only on loopback port 3301; nginx exposes the
MCP and OAuth endpoints over HTTPS. ChatGPT uses OAuth dynamic registration,
PKCE, and the operator login. The existing SSH transport remains available.

The only remote scope is `evryvibe:operator`: it can inspect and manage collection
sources and packages, and create or update venues, DJs and events. The connector
has no SSH shell access and does not expose the database password. Access tokens
last one hour; refresh authorization lasts up to 30 days, then reconnect in
ChatGPT. OAuth state persists privately under `shared/.local/mcp/` and is backed
up with the other private state. A token can be revoked at `/oauth/revoke`;
revocation ends its entire refresh family.

Base descriptions are German; supply `translations.en.description`, plus
`translations.en.title` for event titles when needed. English translations are
optional. Omitted translations preserve stored values; `{}` clears them.

## Operator access and logs

Operator credentials are stored root-only at
`/srv/evryvibe/shared/operator-credentials.txt` and a private local copy at
`.local/deploy/operator-credentials.txt`. They are never committed. Plaintext
nginx `/ops` is disabled; use https://evryvibe.com/ops/sources. An SSH tunnel is
also available for origin maintenance:

```sh
ssh -N -L 3300:127.0.0.1:3300 root@87.58.154.89
# Then open http://localhost:3300/ops/sources using username operator.
```

```sh
ssh root@87.58.154.89 'systemctl status evryvibe --no-pager'
ssh root@87.58.154.89 'journalctl -u evryvibe-collect -n 30 --no-pager'
ssh root@87.58.154.89 'systemctl list-timers "evryvibe-*" --all'
curl --resolve evryvibe.com:80:87.58.154.89 http://evryvibe.com/api/health
```

## DNS and HTTPS activation

Cloudflare nameservers are `donald.ns.cloudflare.com` and
`hope.ns.cloudflare.com`. The proxied apex and www records reach origin
`87.58.154.89`. Cloudflare's public IPv6 proxy addresses are supported; the
origin itself uses IPv4. Preserve existing email/MX records. Mail forwarding
was not changed or tested.

Let's Encrypt issued a trusted certificate for apex and www, expiring
20 December 2026. Both Cloudflare HTTPS and direct-origin TLS were checked.
HTTP redirects to HTTPS, www redirects to apex, and both language routes pass.
`certbot.timer` is enabled; an actual renewal dry-run with deploy hooks passed.

The root-owned `/usr/local/sbin/evryvibe-enable-https` helper verifies random
ACME challenge content through every A/AAAA address reported by both public
resolvers before requesting a certificate. It supports proxied DNS without
assuming that Cloudflare's edge address equals the origin. Keep Cloudflare in
Full (strict) mode; Flexible would conflict with origin HTTPS redirects.

## Backup and deployment recovery

Daily backups in root-only `/var/backups/evryvibe` contain a custom-format database
dump, private environment and persistent collector state, excluding browser caches.
The collector now deletes temporary OCR frames after capture and does not
retain media candidates. The backup has no media-pruning step. The collector
lock still protects its private session and spool state during backup. Monitor
disk space and unresolved package counts.
Old successful snapshots are removed after seven days on daily runs. The first
backup was restored into a disposable database: all eight application tables and
zero production events verified. All temporary verification databases were removed.
These are same-server recovery copies; off-site disaster recovery is not configured.
The shared 40 GB server had approximately 0.9 GB free after clearing
regenerable EVRYVIBE browser/build caches on 23 September. Include disk space in capacity checks before larger imports or retaining
additional releases. Only regenerable EVRYVIBE caches were cleared; other apps,
production data, browser login state and rollback releases were preserved.

Build a new release directory, run checks and build, link its `.local` to shared
state, then atomically switch `current` and restart. Check `/api/health`,
German/English pages and MCP. Keep the previous release directory; do not
overwrite the live build. For migration `0003_retire_captured_images`, activate
the compatible new code and backup wrapper first, then stop collector timer,
collector service and any old SSH MCP writers. Take a fresh protected backup,
stop web and HTTP MCP, apply the migration, and restart/verify services. Legacy
private spool files must be scrubbed of capture URL fields before resuming
collection. A code-only symlink rollback after migration 0003 is incompatible
with old queue parsing; restore the pre-migration database and collector state
before starting the older code.
The previous release `/srv/evryvibe/releases/20260922-video-ocr` remains available.
Dependencies are unchanged and hardlinked between retained releases; do not
mutate them in place with an install. The current build used a bounded systemd
job (75% CPU, 2 GiB memory limit).
Run Next builds without Node `--env-file` CLI flags because Next forwards them
to workers where that flag is invalid; the build does not need production secrets.

## Verification

- 62 unit/database/MCP/OCR tests pass locally and on this Linux server against
  isolated disposable databases. Production records remained empty.
- 18 public browser tests and 2 production operator tests pass.
- Independent review checked 32 discovery/detail and 16 legal language/theme/
  viewport combinations, including language switching and keyboard navigation.
- Real server capture/OCR succeeded: one Instagram image, 1,282 caption
  characters and 1,005 OCR characters with `eng+deu`. It published nothing.
- nginx configuration, service boundaries, SSH MCP reads, backup restore, and
  German/English origin responses checked. Public HTTPS and certificate renewal
  dry-run passed through Cloudflare.

- Seven additional remote OAuth/MCP/browser tests pass locally and on Linux. The 18 public
  and two operator browser tests pass after the SVG change. Independent mobile
  WebKit review passed eight German/English light/dark home/event surfaces.
- Deployed SVG surfaces passed eight additional German/English light/dark
  mobile/desktop checks through Cloudflare with certificate verification enabled.
  Production inventory remained empty. SSH MCP also passed after the release.
- The actual ChatGPT OAuth flow completed after allowing its exact callback in
  the consent form CSP. A Chromium regression now covers the real form POST,
  callback navigation, PKCE redemption and blocking an untrusted redirect.
  Consent uses same-origin referrer policy to preserve the POST Origin check.
- ChatGPT refreshed all 16 actions successfully after the MCP service restart;
  the issued authorization persisted. A fresh private backup includes OAuth state.

## SEO and overnight collection update — 21 September 2026

The SEO/collection release adds multi-resolution ICO and Apple-touch icons derived
from the existing SVG brand. Public pages have localized titles/descriptions,
self canonicals and reciprocal language alternatives. Entity share metadata uses
its supplied artwork. Legal pages now have WebPage schema; entity graphs include
the shared WebSite node. Missing pages return 404/noindex without a false homepage
canonical. No production inventory was inserted for these checks.

The private, previously imported Instagram session was checked again on the VPS:
one actual post yielded 1,282 caption characters, one image and 1,005 OCR
characters with English/German Tesseract. No credentials were printed or new login
attempted. The final verification covers 92 integration/unit tests across the full suite
and a focused rerun after correcting a new browser-test fixture. It includes
persisted cooldown, full source traversal, DST-aware night starts, sent history
across source revisions and story-to-event publication through MCP.

Read-only VPS story capture also passed for all three active stories on the
verified venue: two video stories with three representative OCR frames each,
and one image story. Actual profile discovery returned six recent posts despite
pinned entries. Sanitized reports are in `shared/story-probe/`. Stories run first;
ordinary item failures are aggregated after attempting the remaining content.

Final release activation passed: web and MCP healthy, all four services/timers
enabled at boot, and the actual scheduled service exited successfully without
provider access during the daytime. Installed timer has `Persistent=no` and its
next run falls between 01:00 and 01:15 Berlin time. Linux passed 27 focused
collector/story/history/OAuth tests. Public OAuth PKCE and all 16 MCP tools passed
after restart; the temporary verification grant was revoked, with no catalogue
writes. A fresh private backup completed as `backup-20260921T154207-715114`.

Independent final product review passed eight story-event language/theme/viewport
combinations in the local production build, then verified the public Cloudflare
home/legal/404 metadata and all three icons (HTTP 200, MIME and browser decode).
The VPS has approximately 3.8 GB free. The unused intermediate SEO-only staging
release was removed; the preceding live HTTPS/MCP release remains for rollback.

## 22 September: video OCR and profile previews

Release `20260922-video-ocr` adds OCR frames at 0, 1 and 2 seconds, midpoint
and near the end of video posts/reels, carousel clips and stories. Short clips
clamp/deduplicate timestamps. Reels use the isolated same-shortcode `/p/` view
while preserving the original source URL. In-place video carousel replacement is
covered. Temporary screenshots are cleaned up; no video/audio files are hosted.
A read-only probe using the existing VPS Instagram session captured a real reel
with all five samples. Its OCR was sparse; this proves capture, not complete
event extraction. Synthetic clips prove the early flyer-text recovery.

Venue and DJ pages offer click-to-load native Instagram profile previews, separate
from DJ post samples. Instagram controls the displayed selection; a persistent
full-profile link handles unavailable or sign-in-required previews. German/English
privacy copy includes profile previews and selected video frames.

Typecheck, lint, formatting and production builds passed. Sixteen focused collector
tests passed locally; Linux passed fifteen with the database-only test skipped
(no production fixture writes). The final same-player carousel regression also
passed independently and on Linux. Independent review passed eight actual
database-backed mobile language/theme/profile combinations. All eight equivalent
checks passed on the public production venue/DJ pages after activation. Public
OAuth PKCE, all 16 MCP tools, source/queue reads and grant revocation passed.

The installed collector unit uses MemoryHigh=1G, MemoryMax=1536M and
MemorySwapMax=256M. Browser cache targets are 32 MiB disk and 64 MiB media.
The daytime scheduled entry point skipped provider access successfully. The next
nightly run is 23 September at approximately 01:10 Europe/Berlin; latest-six
posts, all available active stories, known-item skipping and ten-second pacing
remain unchanged. Earlier overnight private/unavailable/layout failures are not
claimed resolved wholesale; inspect source outcomes after the next full run.

## 22 September: contact and event lineup links

The contact/takedown release adds `/kontakt`, `/takedown` and their `/en`
alternatives, with localized metadata, WebPage schema, footer links and sitemap
entries. General questions/corrections use info@, direct enquiries use magnus@,
and privacy/complaints/removal requests use legal@evryvibe.com. The removal page
points to the contact section and explains useful details without a mandatory
identity-document workflow. These are mailto links; email delivery is outside
this application and was not exercised by browser checks.

Event lineup rows keep the internal DJ page link and separately offer the known
Instagram profile in a new tab. DJs without an Instagram URL have no fabricated
external destination. No data/schema/MCP/collector changes are involved.

Release `20260922-contact` passed typecheck, lint, formatting, local and VPS
production builds, and 18 existing public browser tests. Independent review
passed 16 contact/takedown language/theme/viewport combinations and eight
database-backed event-lineup combinations, including actual Instagram popup and
internal DJ navigation. Web, MCP and the nightly collection timer remain active.

After activation, the public contact/takedown URLs and an existing event lineup
passed DE/EN light/dark mobile checks. New sitemap entries, canonical URLs,
WebPage output, mailto destinations and the takedown contact anchor passed.

## 23 September: nightly walk and captured flyers

The 23 September walk started at 01:01 CEST and the system stopped it at 06:40
after unattended upgrades restarted the collector unit. Its first 88 packages
were queued by 01:34; 22 or more enabled sources were not reached. The backup
waited on the collector lock and did not cause the interruption. A narrow
`needrestart` override now defers automatic restart of this one collector service
while an active pass is running; the next timer start picks up updated libraries.
The source grid scan now has a bounded traversal and explicit incomplete error,
with source/story/post progress in the journal. A 5-second per-item pause and
10-second venue gap keep collection sequential while shortening the walk.
Allowed Instagram media-CDN 429 responses now trigger the global cooldown, even
if a later video capture times out.

Historical `20260923-media-walk` behavior, superseded by the embed-consent
release: the collector saved compressed WebP candidates for every captured carousel
still and sampled video frame, with slide number, sampled second and that image's
OCR in the package. The 17th MCP action, `preview_image_candidate`, displays a
private candidate for the authenticated operator. Its `/media/<id>.webp` URL
serves publicly only after selection as a published event, venue or DJ image.
Daily backup pruning retains selected images, unresolved queue items and unsent
collector spool work, then removes older unselected captures after seven days.
The queue remains agent-operated; this release does not auto-publish event facts.

The exact causes of the old Tesseract and video-seek failures were absent from
the previous logs. New bounded diagnostics will make repeats identifiable; a
successful next full night walk remains the runtime verification of duration
and Instagram layout handling.

Historical validation: release `20260923-media-walk` passed local and VPS TypeScript, lint, focused
collector/media tests and production builds. Local PostgreSQL MCP integration
verified private preview and public serving after publication; the VPS OAuth
smoke saw all 17 tools through Cloudflare and revoked its temporary grant.
ChatGPT’s connected EVRYVIBE plugin was refreshed in the signed-in Chrome
session and visibly lists `preview_image_candidate` among all 17 actions. The
new backup wrapper completed a production backup after pruning, and HTTPS
health/favicon/private-media checks passed. The next scheduled collection is
24 September around 01:12 CEST.

## 23 September embed-consent reversal

Release `20260923-embed-consent-copy` replaces captured Instagram images with
typographic event art and consent-controlled post/reel/profile embeds. Stories
remain OCR source evidence only; they are never embedded or served from CDN
links. The shared DE/EN consent banner loads embeds only after acceptance,
persists the choice, and unloads iframes on withdrawal. Public detail pages,
metadata and structured data omit the retired image URLs.

The first compatible code release was activated before migration 0003. The
installed backup wrapper was replaced, web/HTTP MCP and collector writers were
quiesced, and backup `backup-20260923T081210-852390` completed before the
migration. Migration 0003 cleared 47 event image links, four venue image links,
and capture URL fields from 121 queue records. All 121 private collector spool
files were scrubbed; zero image fields remain in event/venue/DJ records, queue
or history, and zero files exist in the legacy public-media directory. The
retired `/media/` route returns HTTP 404. This is a same-server backup; older
backup snapshots naturally age out under seven-day retention. A clean
post-migration backup `backup-20260923T082113-853896` also completed.

Local and VPS typecheck, lint and production builds passed. Focused collector
and metadata tests passed on both hosts; ten DE/EN, light/dark, desktop/mobile
consent browser checks passed locally, including a failed-storage withdrawal
regression. Public Tempest and story-sourced event pages return 200 with
WebPage schema, no raw Instagram CDN image or pre-consent iframe, and a legible
event fallback. The connected ChatGPT plugin was refreshed in the signed-in
Chrome session and visibly shows 16 actions without the image-preview action.
The next scheduled collector walk remains around 01:00–01:15 CEST on
24 September; its full real Instagram capture is the remaining runtime check.

## 23 September consent popup and public cover release

Release `20260923-instagram-covers` replaces the footer consent note with a
first-visit DE/EN dialog. It saves a six-month SameSite=Lax cookie, carries
forward existing localStorage choices, and offers a header settings control.
Post/reel embeds and selected original Instagram CDN covers load only after
acceptance; rejecting or withdrawing unloads them. Story images remain
excluded. Event cards and detail artwork use the cover when available, with
the typographic fallback if Instagram's signed URL fails. The privacy notice
and discovery spec describe this behavior.

Migration `0004_event_image_slide` stores the selected carousel slide for
future package publication and URL refresh. The collector retains source-scoped
CDN candidates in post/reel packages, with OCR labels to help choose the right
slide; story packages have no candidates. `list_post_covers` and
`refresh_post_images` are the two new MCP actions. ChatGPT's existing EVRYVIBE
connection was refreshed in the signed-in Chrome session and visibly lists all
18 actions. No new account authorization was needed.

The release passed local and VPS typecheck, lint and production builds. Local
tests passed (86 unit/integration-style tests and all 38 desktop/mobile browser
cases on the final serial run). An isolated VPS test database passed all 11
ingestion and two stdio MCP integration tests, including distinct carousel
slide preservation. A fresh protected backup
`backup-20260923T093028-862748` preceded migration 0004. Web, MCP and both
collection and cover-refresh timers are active.

The initial paced backfill populated 26 of 32 public post/reel events from
native Instagram embeds. Three Proton sources exposed no public embed media;
an authenticated collector fallback recovered their six events. Final database
count: 32/32 public post/reel events have a cover URL and zero story events
have one. A fresh mobile browser loaded a normal event cover and a previously
missing Proton cover at their natural image dimensions; no-choice and rejected
sessions made zero Instagram requests. The nightly refresh runs at 22:30
Europe/Berlin with ten seconds between sources and only revisits missing or
soon-expiring URLs. Its script-only authenticated fallback hotfix was applied
to the active release after the build, with before-copies in
`/srv/evryvibe/shared/hotfix-20260923/`; local typecheck, lint and focused
refresh tests passed before the retry. The queued historical public post/reel
packages are all already done or discarded, so no queue enrichment was added.

Release `20260923-consent-ssr` fixes a repeat-visit popup flash. Root layout
reads the validated consent cookie on the server and supplies the initial state
to the client provider. Typecheck, lint, production build and all 42
desktop/mobile browser cases passed locally; the isolated VPS build passed its
typecheck, lint and build. Fresh live-browser checks found no dialog insertion
for accepted or rejected cookies at page load, no Meta requests for unset or
rejected consent, and a loaded real poster plus native embed after acceptance.
The independent live gauntlet found no release blocker. The 32/32 post/reel
cover count and zero story-image count remained intact; both production timers
remain active.

## 25 September poster legibility release

Release `20260925-poster-legibility-final` gives event poster text a clear upper field
and keeps the graphic motif in a lower band. Bullet-separated artist names that
exactly match the lineup appear once in the poster lineup. Dense posters drop
the motif and compress spacing; cancellation uses its explicit banner without
striking through the title. The footer omits a city already at the end of the
venue name.

Local typecheck, lint, production build and 107 tests passed. The isolated VPS
release passed typecheck, lint and production build before activation. The live
KOWA SAMSTAG event returned HTTP 200 in German and English; rejected-consent
browser checks at 320, 390 and 430 px in both themes showed the full date,
title, lineup and venue inside the poster without clipping. Web, MCP and the
collector timer remained active. The previous release remains for rollback.

The user rejected this broader visual change. Release
`20260925-poster-original-keyline` restores the full-size original event motif,
original title, type scale, spacing, footer and cancellation treatment. Its only
poster difference from the earlier `20260924-collector-recycle` design is a
fine ground-colour keyline around event-title letters so white text remains
legible across light motif shapes. No entity data or queue state changed.
After explicit approval of a local 350/540px preview, the origin release passed
typecheck, lint and production build. The live KOWA SAMSTAG page returned 200;
mobile 390px and desktop 1280px browser captures showed the full-height motif,
unchanged event title, and title keyline. Web and MCP remained active, and the
origin collector and cover timers remained disabled after the OVH cutover.

## 25 September OVH Instagram worker cutover

The worker lives at `/home/ploi/evryvibe-worker/current` on `51.195.109.173`.
It has a minimal Node/Playwright bundle, Tesseract English/German and a
private authenticated Chromium profile migrated from the origin without
regenerable caches. The 334 acknowledged source packages and one pending retry
file were copied so known posts remain known. A dedicated key on OVH is
restricted on the origin to its source IP and `/usr/local/bin/evryvibe-mcp`;
the origin still owns all queue and catalogue data.

OVH systemd timers schedule collection at 00:00, 03:00, 18:00 and 21:00
Europe/Berlin with up to 12 minutes of jitter, cover refresh at 19:30, and a
private worker-state backup at 12:00. Every Berlin day has a varying 6–10 hour
rest period centered on 12:30 (start 07:30–09:30, end 15:30–17:30). Collection
and cover refresh share one lock: a second collection exits without launching
Chromium, while cover refresh waits up to three hours behind an active walk.
The supervisor stops their entire process group at rest or after 20 minutes
without source/item progress; systemd also uses
`KillMode=control-group`. Worker backups exclude Chromium caches and retain seven
days. The old origin collector and cover timers are disabled, while web, MCP
and origin backup continue.

On the first full walk, English/German OCR jobs timed out while unrelated OVH
processes were busy. The final release restricts Tesseract to one thread. We
stopped that first walk through systemd, verified its Chromium children exited,
and restarted from the shared spool on the corrected release. The full pass and
cover refresh still need their completion results checked.

Validation: the OVH worker opened and closed Playwright Chromium, listed the
40 enabled venue sources through origin MCP, then completed a real targeted
Kowalski run: four known stories were skipped, the six latest posts were
inspected, no duplicate package was queued, and no Chromium process remained.
The worker backup archive was created and inspected. A complete scheduled
40-source pass and cover-refresh run remain to be observed after their first
timer firings.

## 28 September collector captions

The OVH worker symlink now points to
`/home/ploi/evryvibe-worker/releases/20260928-caption-extraction`. This release
changes caption extraction and retains the worker runtime, browser state, spool,
source controls, cooldown, pacing, process supervision and timers. The previous
`20260925-remote-worker-final` release remains available for rollback. Typecheck,
changed-file lint, 30 focused collector checks, worker module imports and three
previously failing live-post captures passed. The fixed extractor reads exact
source/author media records and supports the observed metadata without like
counts and with account-prefixed permalinks. Captions cannot be replaced by
nested replies or unrelated records.

A one-off locked, supervised retry of affected sources validates ordinary OCR
and MCP submission. Its outcome is recorded in `docs/collection.md`.

## 5 October city discovery and editorial SEO

Release `20261005-city-seo-editorial` adds dynamic bilingual city editorial
copy, genre-specific city pages and real future-month programmes. The city
copy is writable through authenticated SSH and HTTP MCP with
`upsert_city_content`; `get_city_content` reads it back. No editorial copy was
seeded. A missing record uses a factual catalog-derived fallback, and event
counts, venue/DJ directories and month pages stay tied to published inventory.
Event titles include known date, venue and city. Language canonicals and
alternates, structured-data paths and monthly sitemap entries follow the real
page variants. `observedAt` remains a visible source-capture label, not a
claimed page-modification date or sitemap `lastmod`.

Before activation, protected backup `backup-20261005T161706-2163234` completed.
Migration `0005` only created `city_editorial`; after applying it the origin
retained 46 venue rows and 372 event rows, with zero editorial records. The
bounded origin build, web and HTTP MCP restarts, `/api/health`, public pages,
MCP authorization denial without a token, and authenticated SSH discovery of
all 20 tools passed. The former release remains available for rollback.
Release `20261005-city-genre-copy` adds the user-requested genre-specific
wording, including “Kommende Techno-Events in Stuttgart” in the German H1,
metadata, intro and filtered count labels. It changes no database records or
MCP contracts.

Release `20261005-city-editorial-analytics` keeps catalog-derived headings,
introductions and programme first and places any saved city editorial heading
and introduction after the directories. The existing ChatGPT EVRYVIBE
connection has refreshed all 20 MCP tools, including both city-content tools.
The release also mounts cookieless first-party Minilytics. Its browser has no
collector credential or persistent identifier; the origin forwards validated
public events to the OVH Minilytics site registered as `evryvibe` with
network-based 30-minute session assignment. The three `MINILYTICS_*` settings
live in the protected shared environment, outside the release directory.
Cloudflare client IP restoration is enabled only for the EVRYVIBE HTTPS vhost
using Cloudflare's published proxy ranges, and nginx validation passed.
The final title fix normalizes city SEO titles supplied through MCP so an
already branded title receives only one `EVRYVIBE` suffix.

## 5 October targeted corrections and media IDs

Release `20261005-targeted-media-ids` adds `update_dj` and `update_event` to
the authenticated MCP. Each takes a stable entity UUID and a strict, nonempty
`changes` object; omitted fields remain untouched. `search_catalogue` exposes
an event's source package IDs and selected `imageMediaId`. Source-scoped,
deterministic media IDs are attached to post/reel cover candidates and OCR
labels, including carousel stills and sampled video frames. Event publication
and corrections resolve `imageMediaId` within the linked source package;
`sampleMediaId` on DJ corrections resolves the canonical public post/reel.
The cover refresh worker updates signed URL caches by slide while retaining
media IDs and captured caption/OCR. Migration `0006` records explicit cover
clearing separately from a never-selected cover, so scheduled refresh can
continue filling the latter without resurrecting a deliberate clear.

The OVH worker release `20261005-media-ids` carries the same media-ID and OCR
label code as the origin. It uses the existing persistent browser state,
timer, supervisor, lock, and forced-command SSH MCP configuration.
Protected backup `backup-20261005T212807-2186159` completed before migration.
The additive migration left 389 event records intact. Local typecheck, lint,
168 ordinary tests, 19 targeted PostgreSQL tests and two real stdio MCP tests
passed; the production Next build passed locally and on the origin. Live web
health and public pages passed, the SSH MCP listed 22 tools, the two update
tools returned the expected `not_found` result for nonexistent IDs, and queue
reads exposed media IDs. The OVH worker imported its collector modules and
read the new cover inventory through forced-command SSH MCP. The existing
ChatGPT connection was refreshed in the UI and shows 16 write and six read
actions, including `update_dj` and `update_event`. The first scheduled live
capture on the new worker release remains to be observed.

## 13 October discovery rework, SoundCloud and reconciliation

Release `20261013-discovery-rework` reworks public discovery (one-row When /
Where / Sound filter chips that apply immediately, dense day-grouped listing
rows, Tickets as the single primary action, compact DJ/venue/city pages) and
adds SoundCloud profiles with the official widget behind a separate SoundCloud
consent. Bios render through `publicBioFor`, which hides filler and event-bound
agent text in both languages together. DJ/venue ProfilePage `mainEntity` is now
only the Person/venue (Google rejected the events ItemList there; it moved to
`hasPart`).

Ingestion: `soundcloudUrl` on DJs/venues, verified through SoundCloud oEmbed
before writing; `update_venue`; omitted event and DJ/venue fields keep stored
values; a story update no longer drops a post cover or post source link
(`events.image_source_url`); and the reconciliation queue (seed, flag, list,
claim batch, complete, defer, requeue). Migrations `0007`–`0010` are additive;
`0009` backfilled `image_source_url` for all 295 covers. `list_post_covers`
returned the same 825 rows and fields before and after activation, so the
OVH worker needs no redeploy.

Protected backup `backup-20261013T200401-3047019` completed before migration.
The release built and type-checked on the origin in a bounded unit (75% CPU,
2 GiB). Locally: typecheck, lint, Prettier, production build, 306 unit/
PostgreSQL/MCP tests and 58 browser tests passed; two independent reviews
(queue/MCP and discovery UI on a copy of production data) found gaps that were
fixed and rechecked. After activation: health, DE/EN pages, filter navigation,
zero Instagram/SoundCloud requests before consent, the DJ ProfilePage graph and
30 tools over SSH MCP passed. `seed_reconciliation {upcomingOnly:true}` queued
1,248 DJ/venue tasks (642 event-bound and 197 filler descriptions, 1,248
SoundCloud checks, 17 SoundCloud links stored as websites). No catalogue data
was changed by deployment. The ChatGPT connection must refresh its actions to
see the eight new tools and changed input shapes. Origin collector and cover
timers remain disabled; rollback is a symlink switch to
`20261005-targeted-media-ids` (schema is additive; re-run the `0009` backfill
after any rollback window).

## 13 October genre taxonomy and techno keyword

Release `20261013-genre-taxonomy` adds the canonical genre taxonomy
(`src/core/genres.ts`: 10 families, 106 genres with aliases), normalizes
genres on every MCP write (unknown ones are dropped with a warning) and adds
the read-only `list_genres` tool (31 tools). The home Sound filter uses the
families and their genres; old `sound=` links and alias spellings still
resolve. Programmatic H1s and default titles target "Techno-Partys" instead
of "Clubnächte"/"Club Events".

Protected backup `backup-20261013T204510-3051302` preceded activation.
`scripts/normalize-genres.ts --apply` rewrote 51 of 521 events and 146 of
2,670 DJs (89 slop tags such as "Electronic", "Groove", "Rave" dropped; 1 event
and 44 DJs are left without a genre). A second apply changed 0 rows. Distinct
stored genres went from 122 to 92. Before the build: typecheck, lint,
Prettier, 462 tests and 60 browser tests passed. Live H1s/titles, the alias 308
redirect, `list_genres` and the unchanged 825-row cover contract passed.

## 15 October SoundCloud lookup hotfix

Release `20261015-soundcloud-lookup` stops the SoundCloud oEmbed lookup from
failing writes. SoundCloud answers `"description": null` for profiles without
a bio; the parser only accepted a missing field, so every such profile failed
as a retryable `unavailable` and reconciliation tasks ran out of attempts. The
lookup now never blocks a write: the agent's profile URL is stored, and a
missing profile, an outage or an odd reply only leaves the echoed title and
bio empty. No schema change.

Protected backup `backup-20261015T152904-3337063` preceded activation. The 14
tasks deferred as "Five abandoned attempts" were returned to pending with
reset attempts (the effect of `requeue_reconciliation_task`). Before the
build: typecheck, lint and 463 tests passed. On the live code, profiles
without a bio resolve with their title and an unknown profile resolves empty.

## 15 October DJ directory and genre pages

Release `20261015-dj-directory` adds DJ discovery derived from the catalogue
(`src/core/dj-directory.ts`): `/djs` ("Techno-DJs"), `/genres` and one page per
canonical genre under `/genres/{slug}`, in German and under `/en`. DJs with a
SoundCloud profile are listed first and play inline, one at a time, behind the
SoundCloud consent. The "Gigs in" city filter uses past and upcoming nights;
DJs who have played the city rank above DJs only booked there. Base pages and
genre pages with at least 5 DJs or an upcoming night are indexable and in the
sitemap; filtered and paged variants are noindex with the base canonical, and
an empty genre answers 404. DJ and venue structured data now carry only the
public bio (`publicBioFor`). German genre compounds are hyphenated throughout
("Hard-Techno-DJs", "Kommende Hard-Techno-Events"). No schema change.
