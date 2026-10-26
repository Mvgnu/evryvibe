# EVRYVIBE — product and ownership

Status: first working slice. PM owns scope, contracts, integration, and acceptance.
EVRYVIBE is a new sibling of `musikconnect`; legacy code is reference material only.

## Product

Help someone find a night out, understand the venue and lineup, hear a DJ through their SoundCloud profile player or an existing Instagram post, and open the ticket link or share the event. Start with events, venues, and DJs. These three connected entities are the product and the initial data flywheel.

No tenants, groups, collectives, social feeds, messaging, music uploads, library management, payments, ticket issuance, memberships, server-side recommendation or listening history, or account system in this slice. The one feed is Reels (`reels.spec.md`): DJs with upcoming nights near the visitor, played through SoundCloud's widget and ordered by likes kept on the visitor's device. Ticketing is an ordinary external HTTPS link, including ticket.io and other providers.

## Decisions

- One Next.js App Router application, strict TypeScript, Zod boundary parsing, Drizzle and PostgreSQL. No monorepo package machinery or Redis.
- Public pages read through `src/db/catalog.ts`. Agent writes use the same MCP tools over SSH stdio or authenticated HTTPS with operator OAuth. Both transports share Postgres repositories; public discovery remains account-free.
- A Postgres table is the durable post-package queue. The Playwright collector on the OVH worker adapts the original scraper's capture flow and runs Tesseract OCR before submitting packages through the origin's restricted SSH MCP. Other producers can use the same contract.
- Agents inspect caption, OCR, image/source links, and existing records, then write the venue/DJs/event and finish the queue item transactionally. No human approval workflow, hashes, or elaborate evidence scoring.
- Instagram profiles identify entities; post/reel permalinks supply embeds. Unknown facts stay absent. Every imported event retains its source permalink and observation time.
- Launch geography is not fixed. The opt-in demo (fictional venues in Berlin, Hamburg, Leipzig and München) is clearly labeled and only checks the experience; it is not published inventory. Real database mode never falls back to demo data on failure.

## Ownership

| Domain             | Spec                     | Owned paths                                                                      |
| ------------------ | ------------------------ | -------------------------------------------------------------------------------- |
| PM / foundation    | this file, `delivery.md` | root config, `docs/`, scripts, integration tests, shared contract initialization |
| Core and ingestion | `ingestion.spec.md`      | `src/core/`, `src/db/`, `src/mcp/`, `drizzle/`, backend tests                    |
| Discovery          | `discovery.spec.md`      | `src/app/`, `src/components/`, `public/`                                         |
| Reels              | `reels.spec.md`          | `src/core/reels.ts`, `src/core/locations.ts`, `src/core/musical-key.ts`, Reels and Keys pages and components |
| Guidance           | `.agent/`                | `AGENTS.md`, `.agent/`                                                           |

Collection work is divided under `collection.spec.md`: source control/persistence
belongs to ingestion; `src/collector/` and collector scripts own capture/OCR;
`src/ops/` and `src/app/ops/` own the protected operator surface. PM owns auth proxy,
configuration, integration tests and final product acceptance.

PM resolves cross-domain decisions and updates contracts before delegation. Agents use medium reasoning effort, bounded assignments, and separate ownership. Product quality review inspects the actual result. It is not a gate on runtime ingestion.

## End-to-end acceptance

1. A collector submits an Instagram post package twice; there is one queued item.
2. Two agents cannot claim the same live lease. An abandoned lease becomes claimable.
3. An agent looks up existing entities and publishes one event with its venue and lineup atomically; retry does not duplicate it.
4. Discovery shows the published event and links to its venue, DJs, source, and external tickets.
5. Instagram and SoundCloud media load only after consent, with a persistent source/profile link when unavailable. No audio is uploaded, rehosted or catalogued.
6. Agent-written profile data that drifts (filler or event-bound bios, missing or unverified SoundCloud profiles) flows through the reconciliation queue; story updates never discard a good post cover or post source link.
7. City, genre, date, and text filters are reflected in the URL. Detail pages and sharing work without login.
8. Empty/error states are honest; fictional preview data is explicitly labeled and opt-in.
