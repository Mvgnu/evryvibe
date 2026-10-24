#!/usr/bin/env bash
set -euo pipefail
umask 077

root=/home/ploi/evryvibe-worker
cd "$root/current"
# Pin this release for the entire run; the shared lock covers collection and
# cover refresh even when their timers fire near each other.
cd "$(pwd -P)"
export NODE_ENV=production
export OCR_LANG=eng+deu
# Tesseract's OpenMP default oversubscribes this shared four-core host and can
# turn a single flyer into a 30-second timeout under unrelated server load.
export OMP_THREAD_LIMIT=1
export OMP_NUM_THREADS=1
export EVRYVIBE_COLLECTOR_MCP_SSH_KEY=/home/ploi/.ssh/evryvibe_collector
export EVRYVIBE_INSTAGRAM_STATE_DIR="$root/shared/.local/instagram"
export PLAYWRIGHT_BROWSERS_PATH="$root/shared/ms-playwright"

if [[ ${1:-} == covers ]]; then
  # Retired enrichment must not wait behind or interrupt normal collection.
  printf '%s\n' 'Extra Instagram cover refresh is disabled; use crawl-supplied URLs and consented embeds.'
  exit 0
fi

exec /usr/bin/flock --nonblock --conflict-exit-code 0 "$root/shared/instagram.lock" \
  /usr/bin/node --import tsx scripts/supervise-instagram.ts "$@"
