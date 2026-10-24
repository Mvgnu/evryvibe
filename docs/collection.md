# Collect venue posts and stories

Run commands from `evryvibe/` with Node 22 or newer. Local collection is an explicit
run. Production has the OVH worker schedule below; enabling a venue includes it
in that schedule but never publishes an event by itself.

## Prepare

```sh
npm ci
npx playwright install chromium
# macOS; install Tesseract through your OS package manager on other systems.
brew install tesseract
cp .env.example .env.local
docker compose up -d
npm run db:migrate
```

Copy the example only on first setup; preserve an existing `.env.local`. Set
`DATABASE_URL`, keep `EVRYVIBE_DEMO=0`, and choose
`EVRYVIBE_OPERATOR_PASSWORD`. Next.js, migration, login and collection commands
load `.env.local`. `TESSERACT_BIN` defaults to `tesseract` and `OCR_LANG` to `eng`;
install matching Tesseract language data before selecting another language.

Start `npm run dev` and open `http://localhost:3100/ops/sources`. HTTP Basic uses
username `operator` and the configured password; an unset password denies access.
Add the venue's actual details/profile and enable its source. The page shows
recent run status and counts, and writes through MCP. Use **Edit Instagram
profile** in the source list to correct an existing venue's profile; registration
is for venue details, not replacing its Instagram identity. Correcting its Instagram
profile disables collection, increments its revision, and resets run status;
enable the corrected source explicitly when ready.

## Establish access and run

Public access can work without a session. If Instagram requires login or a
checkpoint, use the dedicated local browser profile:

```sh
npm run instagram:login
# Optional: an explicitly supplied Instagram JSON cookie array.
npm run instagram:login -- --import-cookies /absolute/path/to/cookies.json
```

Complete any provider login/checkpoint in the visible browser, then press Enter
in the terminal. Cookies stay in ignored `.local/instagram/`, or the configured
`EVRYVIBE_INSTAGRAM_STATE_DIR`. Import supports Instagram-domain cookies only;
expired cookies are excluded. Keep exported cookies private and outside version
control. Close the login command before collecting with the same browser profile.

```sh
npm run collect
# To diagnose one enabled venue without changing the nightly source list:
npm run collect -- --venue=lehmann-club
```

Every enabled venue is processed sequentially, with ten seconds between venues
and five seconds before a new post or story navigation.
The authenticated browser profile persists on disk; Chromium restarts between
venues to keep long walks within memory. On the OVH worker, run a manual targeted
collection through `ops/worker/run.sh collect --venue=<slug>` so it shares the
scheduled job's lock and supervisor. Manual runs honor the global Instagram
access cooldown and the daytime rest window.
Each profile contributes its six latest posts, skipping posts already submitted,
and all available active stories. The stored source revision and canonical source
permalink identify collected items across runs. There is no venue-count or total
run-duration cap. Collection captures raw caption, source links and still-image
OCR before calling `enqueue_collected_package`; agents interpret the evidence.

Post carousels include all stills. Stories retain their individual story permalink
and account identity. Videos in posts, reels, carousel slides and stories use sampled-frame OCR at
0, 1 and 2 seconds, midpoint and near the end, clamped for short clips. This catches
flyer details after short intros without video/audio hosting. Provider media can expire; captured OCR and
source context remain in the queue. Failed sources record an error and produce a
nonzero command exit; inspect `/ops/sources` and the queue.

Captured stills and video frames are temporary OCR input only. Packages retain
caption, canonical post/story URL, account URL, and OCR text labeled with the
carousel slide or sampled second and its persistent media ID. They contain no
frame URLs or image files. Public post/reel image candidates also carry their
source-and-slide media IDs; signed URL refresh changes only the URL cache.
Public post/reel visuals use Instagram embeds after visitor consent; stories
are never embedded or displayed from expiring CDN links.

Use MCP `list_packages` / `get_package` to inspect evidence. Continue with
[the agent ingestion flow](ingestion.md) to claim, resolve and publish events.
Collection itself never invents or publishes event details.

## Retry and correct

- Prepared work is written privately to ignored `.local/collector/<venueId>/`.
  `.pending.json` becomes `.sent.json` after MCP acknowledgment. Retry the command
  after resolving an OCR/network/MCP failure; enqueue is idempotent.
- Pending packages retain their source revision. Disabled or changed sources
  cannot submit them. On retry, obsolete work becomes `.stale.json` for local
  inspection; do not relabel it to bypass the source check. Disabling a source
  does not remove already queued packages or published events.
- Capture/OCR failure before preparation leaves no new pending package; rerun
  after correcting access or OCR configuration. Temporary OCR image files are
  removed after capture. Local spool content contains raw source text; keep
  the ignored directory private.
- Re-enqueueing a known post preserves its current payload. For newer caption/OCR
  evidence, use `refresh_package` with the same post/account and a newer capture.
  It refuses live claims, requeues atomically, and retains five prior payloads.
- Profile changes use `set_venue_profile`, also exposed on the operator page.
  A stale revision requires reloading the source state before retrying.

## Verification and current limits

At 2026-09-21 13:39 UTC, [this real Instagram post](https://www.instagram.com/p/Dc_YFudiJy6/)
produced one image, 1,282 caption characters and 1,010 OCR characters, then reached
the queue in an isolated test database. It created **zero public events**; its
source was disabled after the check. Sanitized local evidence is in
`.local/collection-verification.json`.

Production runs the Chromium/Tesseract worker on `51.195.109.173` at 00:00,
03:00, 18:00 and 21:00 Europe/Berlin, with up to 12 minutes of jitter. Missed
runs do not catch up. A deterministic 6–10 hour daily rest window varies around
08:00–17:00 Berlin time; starts skip it and active walks stop at its boundary.
A later timer starts a new walk. A supervisor stops
the Chromium process group at the rest boundary or after 20 minutes without
source/item progress, and systemd cleans up all children. Cover refresh runs on
the same worker at 19:30 and waits for the collector lock for up to three hours.
Tesseract is restricted to one thread on the shared four-core VPS. Source state and OCR packages
reach origin Postgres through restricted SSH MCP; the origin's former collector
and cover-refresh timers are disabled. Sources stay disabled until explicitly
enabled through MCP.
The worker keeps browser login, sent/pending packages and cooldown under
`/home/ploi/evryvibe-worker/shared/.local/`; its private noon backup excludes
regenerable browser caches and retains seven days. These files are no longer
updated by the origin's backup.
Login/checkpoint or rate-limit responses stop collection across all venues and
write a private 24-hour cooldown; manual runs honor it too. Resolve any expired
session using `instagram:login` before the next attempt.

The saved, user-supplied session on the VPS was rechecked on 21 September 2026:
one real post, 1,282 caption characters, one image and 1,005 English/German OCR
characters, without registering a venue or publishing a record. See [deployment](deployment.md). These checks
do not establish coverage of every Instagram layout or live embed/audio playback. Select launch sources, import real catalog data through agents, and
validate representative embeds and ticket destinations before launch.

`npm run test:ops` exercises the protected page against a built production server
on port 3102. Build first, then supply `DATABASE_URL` for a disposable database
whose name contains `test`, and `EVRYVIBE_OPERATOR_PASSWORD` in the process
environment. The Playwright configuration does not load `.env.local` itself.

On 22 September 2026, the saved VPS session successfully captured the posterless
reel `DdbaFJatJ_e` through its isolated same-shortcode `/p/` view, retaining the
original reel source URL. All five video samples completed; the live clip yielded
sparse OCR, so capture success does not establish complete event extraction.
Synthetic intro/flyer/outro clips independently verified readable flyer recovery
specifically at 1 and 2 seconds for posts, carousel videos and stories. Temporary
frames are removed; no video or audio is stored. No production records were written
by these verification probes.

## 23 September overnight audit

The 01:01 Berlin run recorded 10 source outcomes and queued 88 packages by 01:34;
three later sources were interrupted before run status could be written. A profile
could previously keep scrolling without a stopping condition when six recent
non-pinned posts never appeared. Enumeration now stops after 12 scrolls with an
explicit incomplete-source error. Source, story and post progress lines make a
slow profile visible in the journal without logging captions, cookies or signed
media URLs. The five-second item gap remains sequential; the ten-second venue
gap and all-active-stories traversal remain.

At 06:40, Ubuntu unattended upgrades invoked `needrestart`, which restarted the
active collector after a library update. The backup was merely waiting for the
collector lock. `/etc/needrestart/conf.d/evryvibe-collect.conf` now defers the
collector's service restart; the next normal timer run picks up updated libraries.
No kernel OOM was recorded. Earlier OCR logs suppressed Tesseract's exit reason;
new logs report a bounded diagnostic. The caption fallback and video-seek retry
are fixture-tested mitigations, not proof every failed live post will succeed.

## Caption failure diagnostics, 28 September

The 03:03–03:22 Berlin walk completed all 40 enabled sources and reported 14
failures: 12 sources could not isolate original captions and two profiles were
unavailable. There was no recorded login, checkpoint, HTTP 401/403/429, or
activity-restriction stop. An empty pending queue did not mean no collection;
the morning packages had already been processed.

The official Kater website links to `kater.berlin`; its stale `katerblaugram`
profile was corrected through `set_venue_profile` and collection explicitly
re-enabled at revision 3. Berghain's official legal notice still links to
`berghain_ostgut`; no substitute profile is verified.

Caption extraction now uses typed embedded media records tied to the exact
shortcode and owner or declared collaborator. Positively empty captions remain
valid OCR sources. Scoped DOM fallback waits briefly for hydration, keeps
self-mentions, and excludes nested replies from both author and text evidence.
Metadata must match the source permalink and account. Conflicting evidence is
an explicit failure.

Local verification passed typecheck, focused lint, and 29 collector checks.
Database-dependent fixture suites were skipped because their disposable database
configuration was absent. The staged OVH release also passed an import and
source-bound caption runtime check without contacting Instagram. After the 16:10 Berlin rest boundary, the previous extractor reproduced the
caption failures for Kantine `DdbkA_HgAvx` and OXI `Ddvx9gUjWYt`. Their captions
were available in exact-code/author embedded media records; the rendered caption
was a div/span layout rather than the earlier heading/comment-list structure.
Observed metadata also omitted like counts and used account-prefixed permalinks.
Both metadata forms now have regression coverage. Sisyphos `DdldBJTjUhN` had
become unavailable; that sample remains unavailable rather than a parser success.

The new extractor captured Kantine `DdbkA_HgAvx`, another previously failing
Sisyphos post `Dddh6YRjfII`, and OXI `Ddvx9gUjWYt`, recovering original captions
and one, one, and two still-image slides respectively. Both diagnostic browser
services exited cleanly without leftover Chromium processes. Additional metadata
checks bring the focused total to 30 passed checks; typecheck and changed-file
lint passed again.

At that cutover OVH ran release `20260928-caption-extraction`. The previous worker release
remains available for rollback; shared authentication, sent-post history and
cooldown state stay outside releases. A locked retry is running the 12 affected
caption sources and the corrected Kater source through the ordinary collector,
OCR and MCP path. Its final source outcomes are recorded below.

Initial production retry results: Artheater completed four stories and six posts,
Bootshaus completed one new story and three previously failing posts, and Die
Rakete completed its run without failure. Fourteen pending packages were verified
through production MCP after the first two venues, with valid original captions,
labeled OCR, carousel candidates and no story image candidates. The supervised
retry continues in the background at the user's request to wrap up quietly;
full 13-source completion is not yet claimed. The normal timers use the deployed
fix for later runs.

As of 5 October the worker symlink points to `20261005-media-ids`. It now
labels each OCR still/frame with its persistent media ID and sends those IDs
with public post/reel cover candidates. The origin MCP release is deployed in
step with it, and the worker's read-only MCP connection and module imports
passed. The next scheduled collection will provide the first production capture
on this release; existing queue reads already expose IDs for labeled legacy
OCR.

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
