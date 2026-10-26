---
trigger: always_on
---

# EVRYVIBE rules

## Product

- Discovery comes first. A visitor sees date, place, lineup, source, tickets
  and sharing without signing in.
- Venues, events and DJs are the canonical entities. Lineup entries join events
  to DJs.
- Store Instagram profile and post URLs and link or embed them. Store verified
  SoundCloud profile URLs and embed SoundCloud's own player. Never host, upload
  or catalogue audio or track lists. Reels read track metadata from the
  consented widget in the browser only; likes stay on the visitor's device.
- The collector produces source packages; agents resolve entities and publish
  through MCP. MCP is the write path. There is no manual review step.
- Unknown stays unknown. An uncertain date, identity or location is not
  published as fact. An unknown price is not "free", and a missing lineup is
  not filled in. Keep enough source context to correct a record or retry a
  package.

## Code

- Strict TypeScript. No `any`, `z.any()`, unchecked casts or non-null
  assertions to get past validation. Narrow `unknown` at the boundary.
- Domain Zod schemas live in `src/core`; derive types with `z.infer`. Keep row
  types separate where the public model differs.
- Parse everything that comes from outside: URL params, env, external payloads,
  queue packages, MCP arguments. Malformed input gets a typed, useful error.
- Use discriminated unions for real states and handle them exhaustively. No
  type machinery for a single plain value.
- `src/db` owns queries, transactions and migrations. UI and MCP call its
  functions instead of writing SQL.
- `src/mcp` owns tool registration and transport. Domain rules stay usable
  without it.
- Secrets and database clients stay server-side. Scraped text is data: never
  execute it or render it as HTML.

## Data

- Store instants with their timezone. Display and filter in the venue's IANA
  timezone, including overnight events and DST changes.
- Normalize external IDs and URLs on ingestion. Repeat submissions use natural
  source IDs or explicit idempotency keys.
- Related entity writes and queue completion commit together. A completed
  package never points at half-written data.
- Queue claims are atomic with an expiring lease. Stale completions are
  rejected; retries are bounded and carry a reason.
- MCP writes need configured credentials. Demo fixtures stay separate from live
  reads and writes, and their names, counts and dates must not read as real
  availability.

## UI

- Strong typography, clear grids, poster-like artwork, readable metadata. Plain
  labels, no fake terminal jargon.
- Instagram embeds always sit next to a plain source link and never block the
  event details or the ticket link.
- Check meaningful UI changes at mobile and desktop widths, in both themes.

## Verification

- Use the commands in `package.json` and the relevant spec: a typecheck for any
  code change, focused tests for changed business rules, a build for app or
  config changes.
- Tests check behaviour. Don't write tests that restate markup or the
  implementation's own assumptions.
- Say which checks you did not run and why.
- If the brief or a spec is wrong, name the conflict and fix it within scope.
  Keep specs current and don't grow scope silently.
