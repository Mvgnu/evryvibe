#!/usr/bin/env bash
set -euo pipefail
umask 077

worker_root=/home/ploi/evryvibe-worker
mkdir -p "$worker_root/backups"
exec 9> "$worker_root/shared/instagram.lock"
# The noon timer falls inside every daily rest window. An unexpected active
# run keeps its lock; skip rather than copying a live Chromium profile.
/usr/bin/flock --nonblock 9 || exit 0

stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$worker_root/backups/instagram-state-$stamp.tar.gz"
temporary="$archive.tmp"
tar -C "$worker_root/shared" \
  --exclude='.local/instagram/Default/Cache' \
  --exclude='.local/instagram/Default/Code Cache' \
  --exclude='.local/instagram/Default/GPUCache' \
  --exclude='.local/instagram/Default/DawnGraphiteCache' \
  --exclude='.local/instagram/Default/DawnWebGPUCache' \
  -czf "$temporary" .local/instagram .local/collector
mv "$temporary" "$archive"
find "$worker_root/backups" -maxdepth 1 -name 'instagram-state-*.tar.gz' -mtime +7 -delete
