# EVRYVIBE

Event discovery for club nights: venues, their events, and the DJs playing
them. Instagram posts are the source material. The collector turns them into
OCR packages, agents publish structured records through MCP, and visitors
browse events, open tickets and share links without an account.

Before changing code, read `.agent/rules/evryvibe.md`, `specs/00_overview.md`
and the spec for the domain you touch. `.agent/workflows/lop.md` covers
ownership and parallel work; `.agent/workflows/gauntlet.md` covers review.

- One Next.js app: strict TypeScript, Drizzle, PostgreSQL.
- `../musikconnect` is reference only. Nothing is imported or migrated from it.
- Out of scope without a new brief: accounts, tenants, collectives, groups,
  social features, a music library, audio uploads, a marketplace,
  owned ticketing.
- The 2026-10-24 brief adds an account-free personal listening feed with
  device-local feedback and optional current-sound metadata; see
  `specs/listen.spec.md`. This does not introduce an audio/track catalogue.
- Schema and spec changes inside that scope are routine. Coordinate them; they
  don't need another approval.
- Delegated agents run at medium reasoning with exclusive write paths.
- Leave unrelated changes alone.
- Report what runs, what is fixture data and what is untested. Demo data is
  never presented as real inventory.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
