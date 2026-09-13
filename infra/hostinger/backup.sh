#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.production}"
COMPOSE_FILE="${ROOT_DIR}/infra/hostinger/compose.production.yaml"
BACKUP_DIR="${BACKUP_DIR:-/opt/wodana/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

[[ -f "${ENV_FILE}" ]] || { echo "Production environment file is missing" >&2; exit 1; }
mkdir -p "${BACKUP_DIR}"
BACKUP_DIR="$(cd "${BACKUP_DIR}" && pwd)"
# A failed backup is kept private with an explicit incomplete name; it is never a restore point.
STAGING_DIR="$(mktemp -d "${BACKUP_DIR}/.incomplete-${STAMP}-XXXXXX")"
trap 'echo "Backup incomplete: ${STAGING_DIR}" >&2' ERR
# Inspect first: docker run would otherwise silently create an empty source volume.
docker volume inspect wodana-object-data >/dev/null
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "${STAGING_DIR}/postgres.dump"
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "${STAGING_DIR}/postgres.dump" > "${STAGING_DIR}/postgres.contents"
"${COMPOSE[@]}" exec -T redis sh -c 'redis-cli --rdb /tmp/wodana-backup.rdb >/dev/null && cat /tmp/wodana-backup.rdb && rm -f /tmp/wodana-backup.rdb' > "${STAGING_DIR}/redis.rdb"
docker run --rm --network none -v wodana-object-data:/source:ro -v "${STAGING_DIR}:/backup" alpine:3.21 sh -c 'cd /source && tar -czf /backup/objects.tar.gz .'
# Provider tokens cannot be restored without the original encryption key.
cp "${ENV_FILE}" "${STAGING_DIR}/environment.restore.env"
cp "${COMPOSE_FILE}" "${STAGING_DIR}/compose.production.yaml"
"${COMPOSE[@]}" images --format json > "${STAGING_DIR}/images.json"
(cd "${STAGING_DIR}" && sha256sum postgres.dump redis.rdb objects.tar.gz environment.restore.env compose.production.yaml images.json > checksums.txt)
FINAL_DIR="${BACKUP_DIR}/wodana-backup-${STAMP}-${STAGING_DIR##*-}"
mv "${STAGING_DIR}" "${FINAL_DIR}"
trap - ERR
# Retention is deliberate and separate from backup creation. Never delete unrelated host files.
echo "Backup complete: ${FINAL_DIR}"
echo "Contains credentials. Store encrypted off-site and verify restoration before any data reset."
