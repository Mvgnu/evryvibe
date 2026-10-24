# OVH Instagram worker

The origin remains the only database and MCP server. This worker reaches its
forced-command SSH MCP as `evryvibe@87.58.154.89`; it needs no Postgres URL.

Each release under `/home/ploi/evryvibe-worker/releases/` contains `src/core`,
`src/collector`, the three collector scripts, and this `ops/worker` directory.
Copy `ops/worker/package.json` and `package-lock.json` to the **release root**
before running `npm ci --omit=dev` there. The root `type: module` setting is
required for the TypeScript scripts' top-level `await`. Link `.local` in the
release to `/home/ploi/evryvibe-worker/shared/.local`, then atomically point
`current` at the new release. A running walk pins its physical release and is
not interrupted by a symlink switch.

Before switching `current`, verify that `ops/worker/run.sh` and
`ops/worker/backup.sh` are executable by `ploi` (`test -x` for both). File
syncs can silently drop their execute bits; then all three systemd jobs fail
with `203/EXEC` without starting Chromium or producing collector logs.

The active timers collect at 00:00, 03:00, 18:00 and 21:00 and back up state
at noon Europe/Berlin. The separate `evryvibe-worker-covers.timer` is disabled;
keep it disabled. Covers use existing crawl-supplied URLs and consented embeds.
The retired `covers` command returns immediately without network or database
access. `run.sh` holds the shared `flock` for normal collection, and a second
collector exits immediately. `supervise-instagram.ts` stops the collector process group
when the variable 6–10 hour daytime rest begins or when there is no source/item
progress for 20 minutes. The service units use `KillMode=control-group` so
manual stops and abnormal exits reap Chromium descendants too. The worker
sets Tesseract's OpenMP thread count to one on this shared four-core VPS.

The daily backup includes the authenticated profile and sent/pending spool,
but excludes regenerable browser caches. Keep the shared state and the private
SSH key outside releases. The origin's collection and cover timers stay
disabled after cutover.
