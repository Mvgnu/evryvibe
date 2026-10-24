# Delivery plan

## This build

1. Adapt Leasy guidance and inspect reusable queue patterns in Leasy/Gameforest.
2. Freeze narrow product, data contracts, ownership, and acceptance criteria.
3. Build discovery and entity pages in parallel with relational storage and MCP ingestion.
4. Integrate, migrate a disposable local database, and verify queue-to-page behavior, typecheck, build, and browser flows.
5. Independent agent review of actual artifacts; fix concrete gaps and record remaining limitations.

## Before a public launch

- Choose initial city/venues and enable their sources. Configure the implemented local Playwright/Tesseract collector using `docs/collection.md`; no credentials are assumed or copied from the legacy app.
- Import an initial real catalog through MCP, check source embeds and ticket destinations, on the deployed evryvibe.com origin.
- Consider off-site backups as inventory grows.
- Operator identity/contact and bilingual legal copy use the details supplied by Magnus Ohle.

## Deliberately later

Accounts, synced saves, organizer self-service, personalized recommendations, and maps need evidence from users before implementation. Groups, collectives, upload/audio systems, owned ticketing, and multi-tenancy are outside this product brief.

## Verified progress

- Core discovery, relational storage, agent MCP queue, source toggles, raw OCR
  collector, package refresh and protected operator controls are implemented.
- German default and English content/routes, responsive light/dark themes,
  structured event/location/business/person/source/webpage data, and bilingual
  imprint/privacy pages are implemented. Optional translations persist through MCP.
- 62 unit/PostgreSQL/MCP/OCR tests passed both locally and on Linux. All 18 public
  browser tests and 2 production operator tests passed; lint/typecheck/build pass.
- Independent Gauntlet inspected 32 public discovery/detail and 16 legal
  language/theme/viewport combinations. Concrete mobile typography and production
  rewrite defects were fixed and rechecked.
- Actual stdio MCP publication renders in production with event/venue/DJ/source
  schema, correct links, German/English metadata, and load/unload embed fallback.
- Origin deployed to 87.58.154.89 with empty production inventory, restricted SSH
  MCP, nightly paced enabled-source collection, daily backups and bounded health checks.
  Real server Instagram capture/OCR succeeded without publishing. Backup restore
  passed in an isolated database; no production fixture rows were created.
- Cloudflare HTTPS and Let’s Encrypt are active for apex and www. Renewal dry-run
  passed. Mobile icon glyphs were replaced by inline SVG and independently checked
  across eight German/English light/dark home/event surfaces in mobile WebKit.
- Authenticated remote MCP is deployed with PKCE operator OAuth. Its six focused
  tests pass locally and on Linux; public OAuth, 16-tool discovery, queue/source
  reads and revocation pass through Cloudflare. SSH MCP remains verified.
- See `docs/deployment.md` for exact paths, credentials location, DNS/TLS activation
  and independently verified operating boundaries.

## Remaining launch inputs and boundaries

- Supply launch inventory and enable venue profiles through MCP.
- Contact-email delivery was not modified or tested.
- Public Instagram playback remains provider-dependent; source links and unload
  controls remain usable. Story video OCR uses sampled frames; full audio/video hosting remains excluded.
- Catalog reads load the small starting dataset. Introduce database pagination
  when inventory size warrants it. Backups currently remain on the same server.

- ChatGPT setup completed through computer use: EVRYVIBE installed, primary OAuth
  account connected and all 16 actions visible after refresh. Browser callback
  behavior is covered by a Chromium regression; inventory remains user-supplied.

- Final SEO/collection release adds ICO/Apple icons, consistent localized
  metadata and complete WebPage graphs. Nightly collection covers every enabled
  venue ten seconds apart, checks its six latest posts and all active stories,
  and preserves acknowledged history across re-enabling the same profile.
- Real VPS verification captured all three active stories (one image, two videos
  with sampled-frame OCR) using the supplied saved session. Story packages
  publish through MCP. Independent final mobile/desktop, DE/EN and light/dark
  story-page review and public edge favicon/metadata review passed.

- 2026-09-23 design and discovery slice: dark-first "club programme" redesign,
  generated genre posters (9 poster motifs from the genre taxonomy, thumbnail to full flyer, known facts
  only), `/cities` and `/cities/[slug]`, and typed JSON-LD with breadcrumbs on
  every public page. Verified: typecheck, lint, 106 unit tests (DB suites
  skipped), `next build`, 48/48 browser tests, and JSON-LD on a production build
  serving the fictional catalogue from a throwaway local Postgres (published
  through the real queue/claim/complete path). An independent review at 390/1440,
  dark/light, DE/EN found no blockers; its eight findings were fixed and
  rechecked. Remaining: desktop day groups with one or two nights leave empty grid
  columns; the mobile home first-event fold check has ~7px headroom.

- 2026-10-13 discovery rework: one-row filter chips (when/where/sound/genre),
  dense listing rows, SoundCloud listening with separate consent, `publicBioFor`
  bio filtering, ProfilePage `mainEntity` fix, media continuity for story
  updates, and the entity reconciliation queue (1,248 production tasks seeded).
  Verified: typecheck, lint, build, 306 tests, 58 browser tests, two Gauntlet
  reviews with fixes, live checks after deploy. Open: privacy-page SoundCloud
  section needs owner legal review; working the queue is agent work.
