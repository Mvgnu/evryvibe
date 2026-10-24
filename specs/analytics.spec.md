---
name: analytics
paths:
  owned:
    [
      src/analytics/,
      src/components/minilytics-analytics.tsx,
      src/app/api/minilytics/,
    ]
exports: [MinilyticsAnalytics, analyticsEventSchema, createAnalyticsSession]
consumes: [Minilytics authenticated network-session collector]
verification:
  typecheck: npm run check
  test: npm run test -- tests/analytics.test.ts
  build: npm run build
bar:
  property: Public visits and interactions reach the first-party collector without persistent browser identifiers or private content.
---

# Visit analytics

The root layout mounts Minilytics only when all three server settings are present
and demo mode is off: `MINILYTICS_COLLECTOR_URL`, `MINILYTICS_SITE_ID`, and
`MINILYTICS_SITE_SECRET`. Credentials never reach the browser. The configured
collector is `https://analytics.magnusohle.de/api/collect` on OVH.

A document-memory UUID groups client events without cookies or browser storage.
The runtime records a pageview for each committed public pathname (query/hash
changes alone do not add views), clicks, external link clicks, form submissions
without field values, and visible engagement increments. Navigation flushes the
previous page. Hidden, prerendered and operator/API pages are excluded; pagehide
flushes and bfcache pageshow resumes. DNT and GPC disable measurement. Form submit
buttons are excluded from click capture to avoid duplicate CTA events.

`POST /api/minilytics` validates a bounded JSON stream against the event schema,
strips unknown fields and visitor identifiers, strips URL parameters/fragments,
and limits referrers to their origin. It accepts only the public site origin
or same-origin browser requests, excludes bots and prefetch, and forwards with
a two-second timeout. Responses are empty, non-cacheable and noindex.

The origin nginx must overwrite `X-Real-IP` from the verified client connection
(including trusted Cloudflare real-IP configuration). The proxy validates this
IP and supplies `x-minilytics-client-ip`, `x-minilytics-user-agent`, site ID/secret
and `x-minilytics-session-mode: network`; it never forwards caller-supplied
Minilytics headers. The collector overrides client session IDs with database
assignment and receipt timestamps. Its site/IP/UA HMAC lookup expires after
30 minutes of inactivity; pruning removes expired lookup keys and session rows
older than one day. Raw IP is not stored in analytics tables, and network mode
stores no visitor ID. Event statistics currently have no automatic expiry.
DE/EN privacy copy describes this processing.

Focused tests cover client path deduplication, visible time/navigation, private
route exclusion, event sanitization and the authenticated server network
contract. Browser navigation/beacon delivery and production collector ingestion
are verified during deployment.
