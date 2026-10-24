#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /srv/evryvibe/current
# Resolve once so an in-flight run survives a release symlink switch.
cd "$(pwd -P)"
exec /usr/bin/flock --nonblock --conflict-exit-code 0 /srv/evryvibe/shared/collector.lock \
  /usr/local/bin/node --env-file=/srv/evryvibe/shared/.env --import tsx scripts/collect.ts "$@"
