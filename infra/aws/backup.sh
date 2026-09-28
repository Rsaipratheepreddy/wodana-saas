#!/bin/bash
# Database dump and uploaded files to S3 (backups/ moves to Glacier Instant Retrieval after 30 days).
set -euo pipefail
BUCKET="${BACKUP_BUCKET:-wodana-prod-files-aps1}"
STAMP=$(date -u +%Y%m%dT%H%MZ)
cd /opt/wodana/prod
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  | aws s3 cp --only-show-errors --sse AES256 - "s3://$BUCKET/backups/postgres/wodana-$STAMP.dump"
docker run --rm -v wodana-prod-objects:/data:ro alpine tar -czf - -C /data . \
  | aws s3 cp --only-show-errors --sse AES256 - "s3://$BUCKET/backups/objects/objects-$STAMP.tgz"
echo "backup $STAMP done"
