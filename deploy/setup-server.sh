#!/usr/bin/env bash
# One-time preparation of an Ubuntu 24.04 VPS for TransVerse.
# Run as root:  sudo bash setup-server.sh
# Safe to re-run: existing database, password and config are kept.
set -euo pipefail

APP_USER=deploy
APP_DIR=/var/www/transverse
ENV_DIR=/etc/transverse
ENV_FILE=$ENV_DIR/transverse.env

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo bash $0)"; exit 1; }
id "$APP_USER" >/dev/null 2>&1 || { echo "User $APP_USER does not exist — create it first (see docs/DEPLOYMENT.md)"; exit 1; }

echo "==> Base packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https postgresql

echo "==> Node.js 22 (NodeSource)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Caddy (reverse proxy, automatic HTTPS once a domain points here)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "==> PostgreSQL database"
mkdir -p "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  DB_PASS=$(openssl rand -hex 24)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE transverse LOGIN PASSWORD '$DB_PASS';" || sudo -u postgres psql -c "ALTER ROLE transverse PASSWORD '$DB_PASS';"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='transverse'" | grep -q 1 || sudo -u postgres createdb -O transverse transverse
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
DATABASE_URL=postgres://transverse:$DB_PASS@127.0.0.1:5432/transverse
ROUTING_PROVIDER=valhalla
VALHALLA_URL=https://valhalla1.openstreetmap.de
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/dark
# Set to true once the site is served over HTTPS (domain configured in Caddy)
COOKIE_SECURE=false
REGISTER_LIMIT_PER_HOUR=5
HOSTNAME=127.0.0.1
PORT=3000
ENV
  echo "Created $ENV_FILE with a generated database password."
fi
chown root:"$APP_USER" "$ENV_FILE" && chmod 640 "$ENV_FILE"

echo "==> Directories"
mkdir -p "$APP_DIR/releases" && chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> systemd services"
install -m 644 "$(dirname "$0")/transverse-web.service" /etc/systemd/system/transverse-web.service
install -m 644 "$(dirname "$0")/transverse-worker.service" /etc/systemd/system/transverse-worker.service
systemctl daemon-reload
systemctl enable transverse-web transverse-worker

echo "==> Allow the deploy user to restart only these services"
cat > /etc/sudoers.d/transverse <<SUDO
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart transverse-web, /usr/bin/systemctl restart transverse-worker, /usr/bin/systemctl status transverse-web, /usr/bin/systemctl status transverse-worker
SUDO
chmod 440 /etc/sudoers.d/transverse
visudo -cf /etc/sudoers.d/transverse

echo "==> Caddy site"
# Install our Caddyfile only once, so later domain edits are never overwritten.
grep -q "TransVerse reverse proxy" /etc/caddy/Caddyfile 2>/dev/null || install -m 644 "$(dirname "$0")/Caddyfile" /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "==> Firewall (HTTP/HTTPS)"
if command -v ufw >/dev/null; then ufw allow 80/tcp; ufw allow 443/tcp; fi

echo
echo "Done. Push to the main branch (or run the Deploy workflow) to install the first release."
