#!/bin/bash
# Daily database dump and uploaded files to S3; only the newest KEEP_DAYS (default 7) are kept, to stay cheap.
# The dump is checked (pg_restore can read its table of contents) before it is uploaded, and a successful run
# touches logs/last-backup, which the watchdog alerts on after 30 hours. Restore steps: docs in the go-live runbook.
set -euo pipefail
BUCKET="${BACKUP_BUCKET:-wodana-prod-files-aps1}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP=$(date -u +%Y%m%dT%H%MZ)
P=/opt/wodana/prod
cd "$P"
WORK=$(mktemp -d /var/tmp/wodana-backup.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$WORK/wodana.dump"
docker compose exec -T postgres pg_restore --list < "$WORK/wodana.dump" > "$WORK/toc.txt"
tables=$(grep -c ' TABLE DATA ' "$WORK/toc.txt" || true)
[ "$tables" -gt 100 ] || { echo "dump looks incomplete: $tables tables with data" >&2; exit 1; }
aws s3 cp --only-show-errors --sse AES256 "$WORK/wodana.dump" "s3://$BUCKET/backups/postgres/wodana-$STAMP.dump"
rm -f "$WORK/wodana.dump"

docker run --rm -v wodana-prod-objects:/data:ro alpine tar -czf - -C /data . \
  | aws s3 cp --only-show-errors --sse AES256 - "s3://$BUCKET/backups/objects/objects-$STAMP.tgz"

cutoff=$(date -u -d "-$KEEP_DAYS days" +%Y%m%d)
for prefix in backups/postgres/ backups/objects/; do
  keys=$(aws s3 ls "s3://$BUCKET/$prefix" 2>/dev/null | awk '{print $4}' || true)
  for key in $keys; do
    day=$(grep -oE '[0-9]{8}T' <<<"$key" | tr -d T || true)
    if [ -n "$day" ] && [ "$day" -lt "$cutoff" ]; then aws s3 rm --only-show-errors "s3://$BUCKET/$prefix$key"; fi
  done
done
mkdir -p "$P/logs" && date -u +%FT%TZ > "$P/logs/last-backup"
echo "backup $STAMP done ($tables tables, keeping $KEEP_DAYS days)"
