#!/bin/bash
# Puts production back on an earlier release whose images are still on this host. Run as root:
#   rollback.sh            the release before the current one (deploy.sh keeps its images)
#   rollback.sh <release>  any release whose four images are still here
# Migrations are forward-only and additive, so the older code runs on the newer schema; the database is not touched.
# If the images are gone, rebuild instead: deploy.sh <release> (needs /opt/wodana/prod/src/<release>.tgz).
set -euo pipefail
P=/opt/wodana/prod
R="${1:-$(cat "$P/.previous-release" 2>/dev/null || true)}"
[ -n "$R" ] || { echo "usage: rollback.sh <release> (no previous release is recorded)" >&2; exit 1; }
for image in wodana-core-migrator wodana-core wodana-intelligence wodana-web; do
  docker image inspect "$image:$R" >/dev/null 2>&1 \
    || { echo "$image:$R is not on this host; rebuild with: $P/deploy.sh $R" >&2; exit 1; }
done
mkdir -p "$P/logs"
exec > >(tee -a "$P/logs/rollback-$R.log") 2>&1
CURRENT=$(sed -n 's/^RELEASE=//p' "$P/.env")
echo "== $(date -u +%FT%TZ) rollback $CURRENT -> $R"
printf 'RELEASE=%s\n' "$R" > "$P/.env"
cd "$P"
docker compose up -d --remove-orphans --wait --wait-timeout 300
"$P/render-nginx.sh"
# Keep the release we left, so a second rollback.sh (or deploy.sh <it>) can go forward again.
[ -n "$CURRENT" ] && [ "$CURRENT" != "$R" ] && echo "$CURRENT" > "$P/.previous-release"
"$P/smoke.sh"
echo "== $(date -u +%FT%TZ) rolled back to $R"
