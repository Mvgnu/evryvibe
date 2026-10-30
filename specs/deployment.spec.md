---
name: deployment
paths:
  owned: [ops/, specs/deployment.spec.md]
exports:
  [systemd units, nginx sites, paced collection, private backups, SSH MCP]
consumes: [Ubuntu 26.04, Node 24, PostgreSQL 18, nginx, Tesseract, Playwright]
---

# Production contract

Host `87.58.154.89`, domain `evryvibe.com`; DNS and certificate issuance are
separate activation steps. This shared host keeps its other sites and global
configuration. No Docker or PM2. Node is `/usr/local/bin/node`, database and role
are `evryvibe` on local PostgreSQL. Public web binds only `127.0.0.1:3300`. Use Next `--hostname localhost` with Node
`--dns-result-order=ipv4first`; the literal 127.0.0.1 hostname makes Next normalize
locale rewrites into external self-proxies and loses the English request header.

System user `evryvibe` owns `/srv/evryvibe`. Releases live in
`/srv/evryvibe/releases/<release>` and `current` is the active symlink. Retain
source, migrations, scripts and `node_modules` alongside a normal `.next` build;
operator actions and collection spawn the TypeScript stdio MCP implementation.
Build/install/check/migrate before atomically replacing `current`, then restart
`evryvibe.service` and check HTTP and journal. Do not remove an old release while
its collector or SSH MCP process remains active. A rollback selects the preceding
release and restarts the service; incompatible DB migrations need a separate
restore decision, not an automatic down migration.

The real `.env` is `/srv/evryvibe/shared/.env`, owned by evryvibe, mode 0600;
`ops/production.env.example` has placeholders only. Node `--env-file` loads it;
never shell-source it or print secrets. Each release links `.local` to
`/srv/evryvibe/shared/.local` (directory mode 0700), preserving Instagram login and
retry spool across releases. Playwright binaries live separately at
`/srv/evryvibe/shared/ms-playwright`. Install compatible Chromium and Linux
libraries plus Tesseract English/German; `OCR_LANG=eng+deu`. No demo or test DB
variables in production. No production fixture seeding.

# Services and collection

Install the origin web, MCP and backup services under `/etc/systemd/system`.
The origin collector and cover-refresh timers are disabled after the OVH worker
passes a real single-venue run. Web uses 640 MiB MemoryHigh / 768 MiB MemoryMax
and restarts on failure. The worker on `51.195.109.173` owns Chromium, Tesseract,
the collector spool, Instagram profile and its own backup. Its systemd units
live in `ops/worker/systemd/`; see `specs/collection.spec.md` for the daytime
rest window and repeated runs. A dedicated restricted SSH key reaches only the
origin's forced-command MCP; no database credentials or new public port move to
the worker.
There is no venue-count or total-duration cap. Each venue checks its six latest
posts and all active stories, skipping already submitted source IDs. Provider
operations retain individual timeouts; access restrictions persist a global
24-hour cooldown. Create
`shared/collector.lock` owned evryvibe:evryvibe mode 0600 before starting units.
Both scheduled and manual runs use `ops/bin/collect.sh` and the same nonblocking
flock; a concurrent run exits successfully without starting another browser.
Manual invocation: `sudo -u evryvibe /srv/evryvibe/current/ops/bin/collect.sh`.
No sources are enabled by deployment. Enabling is explicit through authenticated
ops/MCP. Scheduling captures/OCRs enabled sources; it does not invent events or
perform agent analysis. Instagram session expiry remains an operator action.

# HTTP, HTTPS and MCP

Install the HTTP site as `/etc/nginx/sites-available/evryvibe` with its matching
sites-enabled symlink. Check `nginx -t` before reload. Test pre-DNS with a Host
header or curl `--resolve`; do not replace the shared default server. Public
pages work over HTTP; `/ops` and `/ops/…` return 503 there. Use an SSH tunnel to
localhost:3300 for operator access before TLS. App HTTP Basic username is
`operator`; password stays in shared `.env`. Access logging is disabled. Dedicated error logs under `/var/log/evryvibe/`
use the supplied daily logrotate stanza with 14-day retention. The existing
server journal also has a 14-day limit.

Set apex and www origin A records to `87.58.154.89`. Cloudflare proxying is
supported, including its edge AAAA addresses; do not publish an unsupported
origin IPv6 address. Use Full (strict) encryption. Only afterward,
run root-owned `/usr/local/sbin/evryvibe-enable-https` as root (default contact
`legal@evryvibe.com`). Its protected HTTPS template lives at
`/etc/evryvibe/nginx-https.conf`. It checks random ACME challenge content through every public A/AAAA endpoint
from both public resolvers, obtains webroot certificates, installs the HTTPS site, tests nginx
before reload, and restores the prior file if activation fails. HTTPS redirects
www to apex and permits app-authenticated `/ops`; plaintext ops remains blocked.
ACME challenges remain reachable at `/var/www/letsencrypt`. Certbot timer renews,
with a dedicated nginx-test/reload deploy hook. Verify renewal with a dry run.

For SSH MCP, install `ops/bin/mcp-stdio.sh` at
`/usr/local/bin/evryvibe-mcp`, root-owned executable, and connect with
`ssh -T evryvibe@87.58.154.89`; the authorized existing public key uses the forced
command `/usr/local/bin/evryvibe-mcp`, no forwarding and no PTY. Wrapper requires
that user, resolves the active release, loads secrets server-side, and keeps
stdout exclusively for MCP. Remote MCP uses `evryvibe-mcp.service`, binding only 127.0.0.1:3301.
HTTPS nginx routes `/mcp`, `/oauth/…`, and OAuth discovery metadata to it;
all other paths remain on the web service. Set origin `https://evryvibe.com`
and private state file `/srv/evryvibe/shared/.local/mcp/oauth-state.json`.
Create its parent directory owned evryvibe mode 0700 before starting the service.
OAuth uses the existing operator password, PKCE, and expiring bearer tokens;
unauthenticated MCP requests must return 401. No tokens in URLs or access logs.
The state file persists across releases and is included in private backups.
See `remote-mcp.spec.md` for authorization and transport behavior.

# Backup and recovery

Install `ops/bin/backup.sh` as root-owned mode-0755
`/usr/local/sbin/evryvibe-backup`; the root timer executes this protected copy,
never an application-owned release script. Root-only `/var/backups/evryvibe`
holds daily atomic directories with a custom
format `database.dump`, mode-0600 environment, compressed `.local` session/spool
state, and UTC timestamp. Root uses local postgres peer authentication for dump,
never a database password in process arguments. The collector lock prevents
concurrent collector profile/spool changes; backup waits for any full collection
pass to finish rather than timing out after twenty minutes. Browser binaries and regenerable
profile caches are excluded; session cookies and spool remain included. Keep
seven days; failed runs leave the previous backups intact. Dumps use Postgres
snapshot consistency, but ongoing external MCP writes may occur after that
snapshot. This is same-server recovery only, not off-host disaster protection.

The collector does not retain captured image or video frames after OCR. The
backup therefore has no media-pruning step; legacy image files, if any, require
an explicit inventory and cleanup before removal. A database dump and private
collector state remain in each backup. Monitor unresolved queue growth and disk
space independently.

`pg_restore --list` catches unreadable archives but is not a restore test. Verify
by restoring a fresh backup into an isolated disposable DB, checking schema and
counts, then removing that DB. For real recovery stop web/collection and SSH MCP
sessions, restore DB, environment and state with original ownership/permissions,
then restart and validate. Never restore over production as a verification test.
Monitor disk space, failed units, backup timestamps, nginx logs and source errors.
Keep `.env`, dumps, cookies and raw sensitive logs outside version control.

# Acceptance

Verify unit syntax, script syntax, web HTTP 200 and disabled-source state;
unauthenticated ops denied through the app and all plaintext edge ops blocked;
MCP tools round-trip over SSH; collector and manual locking behave correctly;
a backup restores into a disposable database. TLS and renewal must pass through public DNS; the 21 September 2026 activation
verified Cloudflare HTTPS and a successful renewal dry-run. Templates are not evidence of
installed services; the deployment report records actual host checks.

# Behavioral bot guard

`ops/guard/` is an EVRYVIBE-isolated adaptation of the installed Leasy guard.
Its detector, independent button issuer and watchdog are root-owned systemd
units; only the issuer listens on loopback3319. Nginx namespaces use `evg_`,
`/_evg/pass`, a new private secret, private state and a 14-day security log.
The existing TLS vhost and its protected template include the guard; verify
the actual sites-enabled path since this host has a separate regular file.
Synthetically suspicious requests get403/no-store/noindex and “Bitte bestätigen”;
a same-site POST issues Secure/HttpOnly signed30-day pass cookies and redirects
to the original public URL. Known crawler/assistant and genuine navigation
exceptions follow Leasy. OAuth/MCP and auth retain their dedicated routes.
Initial state is empty, not a copy of another site's learned traffic. The
watchdog fails open if the issuer stops, and disables learned families if the
detector is stale. `guard.off` is an immediate rollback without reload.
See `ops/guard/README.txt` for installation, verification and rollback.
