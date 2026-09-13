#!/usr/bin/env bash
# Backup for the native PostgreSQL/nginx release installed on the existing host.
set -euo pipefail
umask 077
RELEASE_DIR="${RELEASE_DIR:-/opt/wodana/releases/20260907}"
QUOTATION_WEB_DIR="${QUOTATION_WEB_DIR:-/opt/wodana/releases/20260907-quotation-fix}"
MATERIAL_RELEASE_DIR="${MATERIAL_RELEASE_DIR:-/opt/wodana/releases/20260907-material-builder}"
CANVAS_RELEASE_DIR="${CANVAS_RELEASE_DIR:-/opt/wodana/releases/20260907-quotation-canvas}"
SIMPLE_RELEASE_DIR="${SIMPLE_RELEASE_DIR:-/opt/wodana/releases/20260907-quotation-simple}"
CATALOG_RELEASE_DIR="${CATALOG_RELEASE_DIR:-/opt/wodana/releases/20260907-catalog-whatsapp}"
CATALOG_DATA_DIR="${CATALOG_DATA_DIR:-/opt/wodana/releases/20260907-catalog-data}"
USER_SETTINGS_RELEASE_DIR="${USER_SETTINGS_RELEASE_DIR:-/opt/wodana/releases/20260907-user-settings}"
SETTINGS_CRM_RELEASE_DIR="${SETTINGS_CRM_RELEASE_DIR:-/opt/wodana/releases/20260907-settings-crm-cleanup}"
CRM_TABLE_RELEASE_DIR="${CRM_TABLE_RELEASE_DIR:-/opt/wodana/releases/20260907-crm-table-refinement}"
LEADS_WHATSAPP_RELEASE_DIR="${LEADS_WHATSAPP_RELEASE_DIR:-/opt/wodana/releases/20260907-leads-whatsapp}"
LEAD_NOTES_RELEASE_DIR="${LEAD_NOTES_RELEASE_DIR:-/opt/wodana/releases/20260907-lead-notes-calendar}"
NOTE_ATTACHMENTS_RELEASE_DIR="${NOTE_ATTACHMENTS_RELEASE_DIR:-/opt/wodana/releases/20260907-note-attachments}"
QUOTATION_BUILDER_RELEASE_DIR="${QUOTATION_BUILDER_RELEASE_DIR:-/opt/wodana/releases/20260908-quotation-builder}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/wodana/current}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_ROOT"
STAGING_DIR="$(mktemp -d "$BACKUP_ROOT/.incomplete-${STAMP}-XXXXXX")"
trap 'echo "Backup incomplete: $STAGING_DIR" >&2' ERR
sudo -u postgres pg_dump -Fc wodana_release > "$STAGING_DIR/postgres.dump"
sudo -u postgres pg_restore --list < "$STAGING_DIR/postgres.dump" > "$STAGING_DIR/postgres.contents"
sudo -u postgres pg_dumpall --globals-only > "$STAGING_DIR/postgres-globals.sql"
docker exec wodana-release-redis-1 redis-cli -p 16379 --rdb /tmp/wodana-release-backup.rdb >/dev/null
docker cp wodana-release-redis-1:/tmp/wodana-release-backup.rdb "$STAGING_DIR/redis.rdb"
docker exec wodana-release-redis-1 rm /tmp/wodana-release-backup.rdb
OBJECT_PATH="$(docker volume inspect wodana-release-objects --format '{{.Mountpoint}}')"
tar -C "$OBJECT_PATH" -czf "$STAGING_DIR/objects.tar.gz" .
tar -C "$RELEASE_DIR" -czf "$STAGING_DIR/runtime-private.tar.gz" core.env web.env intelligence.env compose.yaml runtime-private.json database-private.json rollback.sh nginx-before-cutover.conf nginx-current-release.conf
tar -C /etc -czf "$STAGING_DIR/proxy-private.tar.gz" nginx letsencrypt
docker inspect wodana-release-web-1 wodana-release-business-core-1 wodana-release-intelligence-api-1 wodana-release-intelligence-worker-1 > "$STAGING_DIR/container-config-private.json"
if [[ -d "$QUOTATION_WEB_DIR" ]]; then
  tar -C "$QUOTATION_WEB_DIR" -czf "$STAGING_DIR/quotation-web-private.tar.gz" web.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh
  docker inspect wodana-quotation-fix-web-1 > "$STAGING_DIR/quotation-web-container-private.json"
fi
(cd "$STAGING_DIR" && sha256sum postgres.dump postgres-globals.sql redis.rdb objects.tar.gz runtime-private.tar.gz proxy-private.tar.gz container-config-private.json > SHA256SUMS)
if [[ -f "$STAGING_DIR/quotation-web-private.tar.gz" ]]; then
  (cd "$STAGING_DIR" && sha256sum quotation-web-private.tar.gz quotation-web-container-private.json >> SHA256SUMS)
fi
if [[ -d "$MATERIAL_RELEASE_DIR" ]]; then
  tar -C "$MATERIAL_RELEASE_DIR" -czf "$STAGING_DIR/material-builder-private.tar.gz" core.env web.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh
  docker inspect wodana-material-builder-business-core-1 wodana-material-builder-web-1 > "$STAGING_DIR/material-builder-containers-private.json"
  (cd "$STAGING_DIR" && sha256sum material-builder-private.tar.gz material-builder-containers-private.json >> SHA256SUMS)
fi
if [[ -d "$CANVAS_RELEASE_DIR" ]]; then
  tar -C "$CANVAS_RELEASE_DIR" -czf "$STAGING_DIR/quotation-canvas-private.tar.gz" core.env web.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh 0048_quotation_templates.sql
  docker inspect wodana-quotation-canvas-business-core-1 wodana-quotation-canvas-web-1 > "$STAGING_DIR/quotation-canvas-containers-private.json"
  (cd "$STAGING_DIR" && sha256sum quotation-canvas-private.tar.gz quotation-canvas-containers-private.json >> SHA256SUMS)
fi
if [[ -d "$SIMPLE_RELEASE_DIR" ]]; then
  tar -C "$SIMPLE_RELEASE_DIR" -czf "$STAGING_DIR/quotation-simple-private.tar.gz" web.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh release.json
  docker inspect wodana-quotation-simple-web-1 > "$STAGING_DIR/quotation-simple-container-private.json"
  (cd "$STAGING_DIR" && sha256sum quotation-simple-private.tar.gz quotation-simple-container-private.json >> SHA256SUMS)
fi
if [[ -f "$CATALOG_RELEASE_DIR/release.json" ]]; then
  tar -C "$CATALOG_RELEASE_DIR" -czf "$STAGING_DIR/catalog-whatsapp-private.tar.gz" web.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh release.json
  docker inspect wodana-catalog-whatsapp-web-1 > "$STAGING_DIR/catalog-whatsapp-container-private.json"
  (cd "$STAGING_DIR" && sha256sum catalog-whatsapp-private.tar.gz catalog-whatsapp-container-private.json >> SHA256SUMS)
fi
if [[ -f "$CATALOG_DATA_DIR/release.json" ]]; then
  tar -C "$CATALOG_DATA_DIR" -czf "$STAGING_DIR/catalog-data-private.tar.gz" web.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh release.json catalog-plan.json
  docker inspect wodana-catalog-data-web-1 > "$STAGING_DIR/catalog-data-container-private.json"
  (cd "$STAGING_DIR" && sha256sum catalog-data-private.tar.gz catalog-data-container-private.json >> SHA256SUMS)
fi
if [[ -f "$USER_SETTINGS_RELEASE_DIR/release.json" ]]; then
  tar -C "$USER_SETTINGS_RELEASE_DIR" -czf "$STAGING_DIR/user-settings-private.tar.gz" core.env web.env intelligence.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh release.json
  docker inspect wodana-user-settings-business-core-1 wodana-user-settings-web-1 wodana-user-settings-intelligence-api-1 > "$STAGING_DIR/user-settings-containers-private.json"
  (cd "$STAGING_DIR" && sha256sum user-settings-private.tar.gz user-settings-containers-private.json >> SHA256SUMS)
fi
if [[ -f "$SETTINGS_CRM_RELEASE_DIR/release.json" ]]; then
  tar -C "$SETTINGS_CRM_RELEASE_DIR" -czf "$STAGING_DIR/settings-crm-private.tar.gz" core.env web.env intelligence.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh release.json
  docker inspect wodana-settings-crm-cleanup-web-1 wodana-settings-crm-cleanup-business-core-1 wodana-settings-crm-cleanup-intelligence-api-1 > "$STAGING_DIR/settings-crm-container-private.json"
  (cd "$STAGING_DIR" && sha256sum settings-crm-private.tar.gz settings-crm-container-private.json >> SHA256SUMS)
fi
if [[ -f "$CRM_TABLE_RELEASE_DIR/release.json" ]]; then
  tar -C "$CRM_TABLE_RELEASE_DIR" -czf "$STAGING_DIR/crm-table-private.tar.gz" core.env web.env intelligence.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh release.json
  docker inspect wodana-crm-table-refinement-web-1 wodana-crm-table-refinement-business-core-1 wodana-crm-table-refinement-intelligence-api-1 > "$STAGING_DIR/crm-table-container-private.json"
  (cd "$STAGING_DIR" && sha256sum crm-table-private.tar.gz crm-table-container-private.json >> SHA256SUMS)
fi
if [[ -f "$LEADS_WHATSAPP_RELEASE_DIR/release.json" ]]; then
  tar -C "$LEADS_WHATSAPP_RELEASE_DIR" -czf "$STAGING_DIR/leads-whatsapp-private.tar.gz" core.env web.env intelligence.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh release.json
  docker inspect wodana-leads-whatsapp-web-1 wodana-leads-whatsapp-business-core-1 wodana-leads-whatsapp-intelligence-api-1 > "$STAGING_DIR/leads-whatsapp-container-private.json"
  (cd "$STAGING_DIR" && sha256sum leads-whatsapp-private.tar.gz leads-whatsapp-container-private.json >> SHA256SUMS)
fi
if [[ -f "$LEAD_NOTES_RELEASE_DIR/release.json" ]]; then
  tar -C "$LEAD_NOTES_RELEASE_DIR" -czf "$STAGING_DIR/lead-notes-calendar-private.tar.gz" core.env web.env intelligence.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh release.json
  docker inspect wodana-lead-notes-calendar-web-1 wodana-lead-notes-calendar-business-core-1 wodana-lead-notes-calendar-intelligence-api-1 > "$STAGING_DIR/lead-notes-calendar-container-private.json"
  (cd "$STAGING_DIR" && sha256sum lead-notes-calendar-private.tar.gz lead-notes-calendar-container-private.json >> SHA256SUMS)
fi
if [[ -f "$NOTE_ATTACHMENTS_RELEASE_DIR/release.json" ]]; then
  tar -C "$NOTE_ATTACHMENTS_RELEASE_DIR" -czf "$STAGING_DIR/note-attachments-private.tar.gz" core.env web.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh release.json
  docker inspect wodana-note-attachments-web-1 wodana-note-attachments-business-core-1 > "$STAGING_DIR/note-attachments-container-private.json"
  (cd "$STAGING_DIR" && sha256sum note-attachments-private.tar.gz note-attachments-container-private.json >> SHA256SUMS)
fi
MASTER_DATA_RELEASE_DIR="/opt/wodana/releases/20260908-master-data"
if [[ -f "$MASTER_DATA_RELEASE_DIR/release.json" ]]; then
  tar -C "$MASTER_DATA_RELEASE_DIR" -czf "$STAGING_DIR/master-data-private.tar.gz" core.env web.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh release.json artifact-checks.json master-default-before.json master-default-change.json
  docker inspect wodana-master-data-web-1 wodana-master-data-business-core-1 > "$STAGING_DIR/master-data-containers-private.json"
  (cd "$STAGING_DIR" && sha256sum master-data-private.tar.gz master-data-containers-private.json >> SHA256SUMS)
fi
if [[ -f "$QUOTATION_BUILDER_RELEASE_DIR/release.json" ]]; then
  tar -C "$QUOTATION_BUILDER_RELEASE_DIR" -czf "$STAGING_DIR/quotation-builder-private.tar.gz" core.env web.env compose.yaml nginx-before.conf nginx-current.conf rollback.sh release.json
  docker inspect wodana-quotation-builder-web-1 wodana-quotation-builder-business-core-1 > "$STAGING_DIR/quotation-builder-containers-private.json"
  (cd "$STAGING_DIR" && sha256sum quotation-builder-private.tar.gz quotation-builder-containers-private.json >> SHA256SUMS)
fi
FINAL_DIR="$BACKUP_ROOT/release-${STAMP}"
mv "$STAGING_DIR" "$FINAL_DIR"
trap - ERR
echo "Backup complete: $FINAL_DIR"
