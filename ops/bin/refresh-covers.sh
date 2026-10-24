#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /srv/evryvibe/current
# Pin this release for the entire run; never overlap the source collector.
cd "$(pwd -P)"
exec /usr/bin/flock --nonblock /srv/evryvibe/shared/collector.lock \
  /usr/local/bin/node --env-file=/srv/evryvibe/shared/.env --import tsx scripts/refresh-instagram-covers.ts "$@"
