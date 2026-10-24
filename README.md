# EVRYVIBE

Find a night out through its venue, event, and DJs. Fresh Next.js application;
`../musikconnect` is a reference, not a dependency.

Start with [the scope and ownership map](specs/00_overview.md),
[delivery plan](specs/delivery.md), and [working agreement](AGENTS.md).

[Production deployment and SSH MCP](docs/deployment.md): origin installed on
87.58.154.89; https://evryvibe.com is live through Cloudflare with Let’s Encrypt. German is the default,
English lives under `/en`, and both light/dark themes are supported.

## Run locally

Use Node 22 or newer and npm.

```sh
npm ci
# Fictional catalog for design/development; visibly labeled, never live inventory.
EVRYVIBE_DEMO=1 npm run dev
```

Open http://localhost:3100. Demo mode is disabled in production. Without demo mode
or a database, the application has an honest empty catalog.

For real persistence:

```sh
docker compose up -d
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Postgres is bound to localhost port 5438. The sample credentials are for this
local container only. Next.js, migration, and MCP commands load `.env.local`.
Keep `EVRYVIBE_DEMO=0` for real data. Database errors never silently substitute
fictional events.

## Collection and agent ingestion

The local Playwright collector captures enabled venues' Instagram posts and
per-image Tesseract OCR, then submits packages through MCP. Configure
`EVRYVIBE_OPERATOR_PASSWORD` in `.env.local` and open `/ops/sources` with HTTP
Basic username `operator` to register venues, correct profiles, and toggle
collection. New sources start disabled; enabling one includes it in the installed
production overnight schedule. Local setup needs an explicit collection run.
Follow [the collection runbook](docs/collection.md) for browser/OCR setup and a
paced `npm run collect` run.

```sh
npm run mcp
```

This starts the stdio MCP connector. Configure it in an MCP client; stdout is
reserved for protocol messages. Agents receive collector/OCR post packages,
claim work, find existing venues and DJs, and publish linked event data directly.
See [the ingestion runbook](docs/ingestion.md) for the concrete tool sequence.

There is no public unauthenticated write endpoint, tenant system, uploaded audio, account system,
or human publication approval queue. Instagram sample embeds load on demand;
source links remain available. Ticket purchases happen on the linked provider.

## Verify

```sh
npm run check
npm run lint
npm test
npm run build
npm run test:e2e
```

Database tests require a **dedicated disposable database** via
`TEST_DATABASE_URL`; never point them at application data. Browser acceptance
tests use a separate dev server in explicit demo mode. See the delivery plan for
verified checks and remaining launch work.

Database verification accepts `TEST_DATABASE_URL` for repository tests and a
separate `MCP_TEST_DATABASE_URL` for real stdio-client tests and
`COLLECTOR_TEST_DATABASE_URL` for OCR-to-MCP integration. All three must point to
separate disposable databases with `_test` in their name. Run `npm test` with all
three variables to exercise the entire suite; otherwise database tests are
explicitly skipped. Collector tests also need Chromium and Tesseract installed.
`npm run test:ops` tests the protected operator page against a built server on
port 3102; supply a disposable `DATABASE_URL` containing `test` and
`EVRYVIBE_OPERATOR_PASSWORD` in its process environment. This Playwright config
does not load `.env.local` itself.
`npm run verify:published` checks the MCP test data against a production server at
`VERIFY_BASE_URL` (default `http://localhost:3101`) using the same MCP test database.

## Stack and references

[Next.js App Router](https://nextjs.org/docs/app/getting-started/installation),
[Drizzle / Postgres](https://orm.drizzle.team/docs/get-started-postgresql),
[MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server).
Dependencies are locked in `package-lock.json`. Guidance and queue patterns
were adapted from the local Leasy and Gameforest repositories; details are in
[the reference audit](docs/reference-audit.md).
