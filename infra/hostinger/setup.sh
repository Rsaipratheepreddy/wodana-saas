#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this once as root on a fresh Ubuntu host." >&2
  exit 1
fi

APP_USER="${APP_USER:-wodana}"
APP_DIR="${APP_DIR:-/opt/wodana/app}"

apt-get update
apt-get install -y ca-certificates certbot curl fail2ban git openssl ufw
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin

id "${APP_USER}" >/dev/null 2>&1 || useradd -m -s /bin/bash "${APP_USER}"
usermod -aG docker "${APP_USER}"
mkdir -p "${APP_DIR}" /opt/wodana/{backups,certbot/conf,certbot/www}
chown -R "${APP_USER}:${APP_USER}" /opt/wodana

ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban docker

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
fi

cat <<EOF
Host setup complete. No application was deployed.
1. Place the repository at ${APP_DIR}
2. Copy infra/hostinger/env.production.example to .env.production and fill it
3. Run infra/hostinger/validate.sh
4. Issue the initial certificate as documented in infra/hostinger/README.md
5. Run infra/hostinger/deploy.sh only when deployment is approved
EOF
