#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo "Run backup as root." >&2; exit 1; }
umask 077
root=/var/backups/evryvibe
install -d -m 0700 -o root -g root "$root"
exec 9>"$root/.backup.lock"
flock -n 9 || exit 0
# Prevent session/spool writes while copying persistent collector state.
[[ -f /srv/evryvibe/shared/collector.lock ]]
exec 8<>/srv/evryvibe/shared/collector.lock
# Collection has no venue/time cap; wait for its full pass before copying state.
flock 8
stage=$(mktemp -d "$root/.pending.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
runuser -u postgres -- pg_dump --format=custom --dbname=evryvibe >"$stage/database.dump"
pg_restore --list "$stage/database.dump" >/dev/null
install -m 0600 /srv/evryvibe/shared/.env "$stage/environment.env"
tar -C /srv/evryvibe/shared --exclude=Cache --exclude="Code Cache" --exclude=GPUCache --exclude=ShaderCache --exclude=GrShaderCache --exclude=Crashpad --exclude=BrowserMetrics -czf "$stage/state.tar.gz" .local
printf '%s\n' "$(date -u +%FT%TZ)" >"$stage/created-at.txt"
# Atomic publication; incomplete backups never match the retention pattern.
name="backup-$(date -u +%Y%m%dT%H%M%S)-$$"
mv -- "$stage" "$root/$name"
trap - EXIT
find "$root" -mindepth 1 -maxdepth 1 -type d -name 'backup-*' -mmin +10080 -exec rm -rf -- {} +
printf 'Backup complete: %s\n' "$root/$name"
