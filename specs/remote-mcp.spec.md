---
name: remote-mcp
paths:
  owned:
    [
      src/mcp/,
      tests/remote-mcp.test.ts,
      tests/remote-mcp-browser.test.ts,
      specs/remote-mcp.spec.md,
    ]
exports: [createMcpServer, createRemoteServer, OperatorOAuth]
consumes: [ingestionRepository, readCatalog, EVRYVIBE_OPERATOR_PASSWORD]
verification:
  typecheck: npm run check
  test: npx vitest run tests/remote-mcp.test.ts tests/remote-mcp-browser.test.ts tests/mcp.test.ts
bar:
  reference: OpenAI MCP authentication guidance and MCP Streamable HTTP specification
  property: ChatGPT discovers all existing tools only after operator-authorized PKCE, and no unauthenticated caller can read private queue data or execute writes.
---

# Remote MCP

This explicitly extends the initial stdio-only ingestion transport. The existing
SSH/stdin entry remains `src/mcp/server.ts`; both entries use the exact same
tool factory in `src/mcp/tools.ts`. HTTP uses the official SDK's stateless
Streamable HTTP transport with JSON responses. No repository rules move into
transport code. Every HTTP MCP operation, including initialization and tool
inventory, requires an access token.

`src/mcp/http-server.ts` binds **127.0.0.1:3301** by default. Required environment:
`DATABASE_URL`, `EVRYVIBE_OPERATOR_PASSWORD` (at least 16 characters),
`EVRYVIBE_MCP_ORIGIN` (canonical HTTPS origin, e.g. `https://evryvibe.com`),
`EVRYVIBE_MCP_STATE_FILE` (absolute private path outside the checkout).
`EVRYVIBE_MCP_PORT` is optional. Run one process only: the private JSON state is
not a distributed store and must never be opened by multiple workers.

The reverse proxy preserves Host and routes `/mcp`, `/oauth/*`, and
`/.well-known/oauth-*` to this loopback service over public TLS. Forwarded headers
are not trusted for authentication or rate limiting. Server validates Host and
browser Origin, caps MCP request bodies at 1 MiB and OAuth bodies at 16 KiB,
and bounds tool arguments to 10,000 aggregate object keys and array elements
before schema validation. Split unusually large publication bundles into smaller
calls. It bounds request timing and applies global per-route
rate limits. OAuth form requires a random one-use nonce bound to an HttpOnly,
Secure, SameSite cookie and the exact origin. It defaults to German with an
English switch and follows system light/dark appearance. It grants full operator
scope; it is not a public account or a tenant system.

OAuth provides RFC 9728 protected-resource metadata, authorization-server
metadata, public-client DCR, authorization-code PKCE S256, refresh rotation and
revocation. The only accepted redirect is the exact documented stable ChatGPT
callback `https://chatgpt.com/connector_platform_oauth_redirect`. Issuer
identification is advertised, and successful redirects return exact `iss`.
Invalid authorization requests return local errors without redirecting.
Resource is exactly `${EVRYVIBE_MCP_ORIGIN}/mcp`, issuer is exactly the origin,
and the only scope is `evryvibe:operator`. Authorization and token requests must
supply that resource. DCR clients expire after ten minutes unless the operator
authorizes them, at which point they last one year.

Authorization codes expire after two minutes and work once. Access tokens last
one hour. Refresh families last 30 days without sliding extension; refresh reuse
revokes all access and refresh tokens in that family. Tokens are random opaque
256-bit values stored as SHA-256 hashes, so validation enforces stored issuer,
resource, and expiration. All grants represent the sole supported operator
scope. Passwords, raw tokens and authorization codes are never logged or stored.
Consent form state is intentionally ephemeral; restarting requires reloading an
unfinished consent flow. Existing issued tokens and OAuth clients survive a
restart.

Persistence writes a fresh 0600 file, fsyncs it, and atomically renames it into
place. Each record category is bounded to 2,048 entries with expiry cleanup;
failed saves restore the previous in-memory durable snapshot. State-file reads
are bounded to 8 MiB. The operator should protect the containing directory and
backups, and delete the state file while the service is stopped to revoke all
connections. Changing the operator password alone does not revoke issued grants.

Tests exercise redirect/password/PKCE/audience rejection, code expiry/replay,
cross-client refresh rejection, durable hashed tokens, file permissions, refresh
rotation/reuse revocation, DCR capacity recovery, CSRF, unauthenticated MCP denial,
and real SDK HTTP initialize/list/read. Existing PostgreSQL stdio integration
covers the shared tool factory against the actual queue when its dedicated test
DB is configured. ChatGPT account linking and production TLS require operational
verification in addition to these tests.

Reference: https://developers.openai.com/plugins/build/auth

The Chromium regression in `tests/remote-mcp-browser.test.ts` routes HTTPS fixture
requests through the actual local OAuth service, preserving browser cookies,
Origin, response headers and form submission. It follows the real consent POST
to an intercepted exact ChatGPT callback and redeems the resulting PKCE code. It
also checks server rejection of an untrusted callback and browser CSP rejection
of a tampered redirect response, with all third-party network traffic blocked.
The suite explicitly skips when the Playwright Chromium binary is unavailable.
Consent CSP must permit the exact callback in `form-action` because Chromium
applies this policy to the POST redirect, not only the initial form action.
Consent referrer policy must preserve the same-origin POST Origin without leaking
the authorization URL to the external callback (`same-origin`).
