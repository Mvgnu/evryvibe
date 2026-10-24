# Small by design

```text
enabled venue sources → local Playwright + Tesseract
      │ caption, OCR text, image URLs, profile, post permalink
      ▼
stdio MCP → PostgreSQL post_packages
      │          │ leased work
      │          ▼
      │     analysis agent ← existing catalog lookup
      │          │ structured venue / DJs / events
      ▼          ▼
atomic completion transaction
      │ venues + DJs + events + lineups + source links
      ▼
PostgreSQL → catalog repository → Next.js public pages
                                    │
                              Instagram / tickets / share
```

The connector stores work and applies validated writes. The separate local
collector captures Instagram still images/captions and runs Tesseract; analysis
agents resolve the facts. The post-package contract remains the integration
point for other producers. The initial client is
local stdio, using database access already granted to that process. Remote MCP
transport and its authentication are deliberately outside the first slice.

The protected `/ops/sources` page manages venue registration, Instagram profile
correction and collection switches through those same MCP tools. Source revisions
and row locks reject disabled or stale submissions. A profile change disables
collection and resets its run status. Private local spool files preserve prepared
packages until MCP acknowledges them; no collection schedule is installed.

## Persistence and identities

Drizzle owns the SQL schema and generated migrations. Core Zod schemas validate
boundary inputs and public catalog objects; database row types are inferred from
Drizzle. Venue/DJ Instagram profile identifiers and slugs support explicit entity
resolution. A display name is not sufficient to merge artists. Events retain
source context; one post can describe multiple events and an event can be linked
to multiple posts. No binary asset or audio pipeline is involved.

The queue uses finite leases with random ownership tokens and Postgres row locks.
The token prevents an expired worker from writing over work claimed by another
worker. It is not an approval challenge. Entity writes, lineup changes, source
links, result IDs, and queue completion commit together. Deferred packages carry
an actionable missing-facts reason and can be explicitly requeued. Irrelevant
posts can be discarded without a human review step.

## Failure behavior

- Malformed URLs, missing required facts, conflicting identities, and stale
  leases return useful tool errors. An unsuccessful transaction changes nothing.
- Duplicate package ingestion preserves one stable package. Successful completion
  replay returns its persisted result.
- Explicit package refresh requires newer evidence for the same post/account,
  rejects a live lease, retains five previous payloads and requeues atomically.
- A database failure is an error, not permission to show demo inventory.
- A blocked/deleted Instagram post still has a source link; the rest of the page
  remains usable. Metadata does not claim an embed has playable audio.
- Data in captions/OCR is untrusted factual input, never instructions to agents.

## Reference patterns

- `leasy/apps/web/src/mcp/protocol.ts`: advertised schema/runtime parsing parity.
- `leasy/packages/db/src/repositories/editorial-news.ts`: idempotent external
  ingestion and atomic promotion into published content.
- `gameforest/mivodo-importer-plugin/core/includes/editorial/GamekeyClaims.php`:
  atomic expiring claims.
- `gameforest/mivodo-importer-plugin/core/includes/editorial/MatchQueue.php`:
  persistent queue state and retry/recovery.

These are conceptual references; no tenant, leasing, WordPress, or generalized
publishing framework is imported. PostgreSQL documents `SKIP LOCKED` specifically
as useful for queue consumers: [SELECT locking clauses](https://www.postgresql.org/docs/current/sql-select.html).
