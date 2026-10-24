#!/usr/bin/env bash
set -euo pipefail
# Connect as evryvibe; stdout is reserved exclusively for the MCP protocol.
if [[ "$(id -un)" != evryvibe ]]; then
  echo "Connect as the evryvibe system user." >&2
  exit 1
fi
umask 077
cd /srv/evryvibe/current
cd "$(pwd -P)"
exec /usr/local/bin/node --env-file=/srv/evryvibe/shared/.env --import tsx src/mcp/server.ts
