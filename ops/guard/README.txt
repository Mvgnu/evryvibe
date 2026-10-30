EVRYVIBE behavioral nginx guard
=============================
Adapted 2026-10-30 from the owner's installed Leasy/Preiswert CG1/CG2 guard.
No Leasy detection state, private owner networks or signing secret is imported.

Installed paths:
  /usr/local/lib/evryvibe-guard/{guard.py,policy.json,prefetch-proxy.txt}
  /etc/nginx/conf.d/evryvibe-guard.conf
  /etc/nginx/evryvibe-guard/ (private pass-secret.conf is generated on host)
  /var/lib/evryvibe-guard/ (0700, live state and 14-day event ledger)
  /var/log/evryvibe/guard.log (0640, daily rotation, 14 days)
  systemd: evryvibe-guard, evryvibe-guard-pass, evryvibe-guard-watchdog.timer
  pass issuer: loopback 127.0.0.1:3319 only

Operation:
  python3 -I /usr/local/lib/evryvibe-guard/guard.py ledger --days 7
  python3 -I /usr/local/lib/evryvibe-guard/guard.py mode shadow|enforce
  touch /etc/nginx/evryvibe-guard/guard.off      (immediate bypass, no reload)
  rm /etc/nginx/evryvibe-guard/guard.off         (restore)
  touch /etc/nginx/evryvibe-guard/families.off   (learned rules bypass)

Behavior matches Leasy: forged desktop-browser/search fetch metadata can be
challenged immediately. Learned single-network scraping needs 30+ documents
in an hour, mostly without referrers/fetch metadata and without engagement.
Families and cross-network sweeps also learn from rare non-engaging browser
fingerprints. Internal/RSC navigation and same-site analytics posts contribute
engagement evidence. A single passive visit is insufficient for the learned
scraping rule. Declared crawlers, the inherited public assistant-egress ranges,
campaign/assistant referrals and genuine cross-site clicks are exempt as in
Leasy. Runtime/HTTP-library fleets get plain403 like Leasy, rather than a button.

Normal challenge:403 with no-store/noindex, POST /_evg/pass returns303 to the
same-origin original URL. Signed evg_h/evg_e cookies last up to30 days, bound to
user agent and client network; Secure on HTTPS, HttpOnly, SameSite=Lax.
The independent issuer is watched every minute: issuer failure creates an
immediate-bypass file; a stale detector disables learned-family rules. No IP
blocklist from Leasy is reused. Cold start learns from new EVRYVIBE traffic.
OAuth/MCP and app authentication stay on their existing dedicated locations.
Security logging excludes ops/OAuth/MCP/API URLs except the analytics beacons
needed for behavioral evidence; no cookies, auth headers or bodies are logged.

Deployment:
  root: install.sh /absolute/path/to/this/directory
  root: python3 wire-nginx.py
  nginx -t
  systemctl enable --now evryvibe-guard evryvibe-guard-pass evryvibe-guard-watchdog.timer
  systemctl restart evryvibe-guard evryvibe-guard-pass
  systemctl reload nginx
  python3 -I /usr/local/lib/evryvibe-guard/guard.py mode enforce
The wire helper updates both regular/symlink sites-enabled and sites-available,
plus the protected TLS template. On this host, sites-enabled was a separate
regular file: always verify nginx -T, not just the sites-available file.
One http-level variables_hash_bucket_size128 directive fits the additional
isolated variables without changing HWA's existing max-size directive.

Verification:
  python3 ops/guard/test_guard.py
  python3 ops/guard/verify_tls.py (on VPS; real TLS host + certificate check)
  For forced-cookie tests, temporarily install test-server.conf as
  /etc/nginx/conf.d/zz-evryvibe-guard-test.conf; nginx -t/reload; run verify.py
  on VPS; remove that temporary config and test/reload again. It binds only
  127.0.0.1:3303. Public requests cannot use its force-challenge header.

Rollback:
  Immediate: touch guard.off as above. For full nginx rollback, restore the
  distinct original enabled/available/template files from root-only
  /var/backups/evryvibe/guard-20261030/, nginx -t and reload; stop/disable the
  three EVRYVIBE guard units, remove its conf.d include and test/reload again.
  Other sites and guard namespaces retain their existing rules and state.
