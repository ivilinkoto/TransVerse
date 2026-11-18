#!/usr/bin/env bash
# Moves TransVerse from the old server to this (new, empty) one. Run as root ON THE NEW SERVER:
#   bash move-server.sh <old-server-ip>
# It asks for the old server's root password once (to copy an SSH key there), then:
#   1. copies the settings, secrets, Caddyfile, deploy key and the running release from the old server;
#   2. installs everything here (setup-server.sh): Node 22, PostgreSQL, Caddy, the services;
#   3. after you confirm: stops the game on the old server for good, copies the database here and
#      starts the game here.
# Nothing on the old server is deleted: its database and files stay as they were (stopped).
set -euo pipefail
OLD=${1:?usage: bash move-server.sh <old-server-ip> [ssh-port]}
PORT=${2:-22}
APP=/var/www/transverse
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
OPTS="-p $PORT -o PubkeyAuthentication=no -o PreferredAuthentications=keyboard-interactive,password -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ControlPath=/root/.ssh/cm-move-%h-%p"
SSH="ssh $OPTS root@$OLD"
export RSYNC_RSH="ssh $OPTS"
# The newest install scripts (the release that runs now may be older than them).
RAW=${RAW:-https://raw.githubusercontent.com/ivilinkoto/TransVerse/claude/transport-game-unique-svnq1g/deploy}
KIT=/root/transverse-deploy

# No question may stop an install (a hidden prompt used to hang here).
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
echo "==> 0. Tools"
# A fresh server may still be updating itself in the background: wait for apt's lock.
while fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1; do echo "   waiting for the system's own update to finish..."; sleep 5; done
apt-get update -y -q
apt-get install -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold rsync openssh-client psmisc

install -d "$KIT"
for f in setup-server.sh fix-502.sh transverse-web.service transverse-worker.service Caddyfile; do
  curl -fsSL "$RAW/$f" -o "$KIT/$f"
done

echo "==> 1. Access to the old server ($OLD)"
[ -f /root/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519 -q
if ! timeout 12 bash -c "</dev/tcp/$OLD/$PORT" 2>/dev/null; then
  echo "   !! The old server does not answer on SSH port $PORT. If its SSH uses another port, run: bash move-server.sh $OLD <port>"
  exit 1
fi
# One connection for the whole move: the password (if the old server asks for one) is typed once.
ssh $OPTS -O exit "root@$OLD" 2>/dev/null || true
echo "   If asked, type the OLD server's root password (once):"
ssh $OPTS -o ControlMaster=yes -o ControlPersist=2h -fN "root@$OLD"
$SSH true && echo "   ok"

echo "==> 2. The deploy user (GitHub's key) and the settings"
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
$SSH "cat /home/deploy/.ssh/authorized_keys" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
install -d -m 755 /etc/transverse
$SSH "cat /etc/transverse/transverse.env" > /etc/transverse/transverse.env
$SSH "cat /etc/caddy/Caddyfile" > /root/Caddyfile.from-old-server
echo "   ok"

echo "==> 3. The running release, secrets and backups"
CURRENT=$($SSH "readlink -f $APP/current")
install -d "$APP/releases" "$APP/shared"
rsync -a --delete "root@$OLD:$CURRENT/" "$CURRENT/"
rsync -a "root@$OLD:$APP/shared/" "$APP/shared/"
ln -sfn "$CURRENT" "$APP/current"
chown -R deploy:deploy "$APP"
echo "   release $(basename "$CURRENT")"

echo "==> 4. Install (Node, PostgreSQL, Caddy, services)"
bash "$KIT/setup-server.sh"
# The database role with the password from the copied settings.
DB_PASS=$(sed -n 's#^DATABASE_URL=postgres://transverse:\([^@]*\)@.*#\1#p' /etc/transverse/transverse.env)
[ -n "$DB_PASS" ] || { echo "No database password in transverse.env"; exit 1; }
sudo -u postgres psql -qc "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='transverse') THEN CREATE ROLE transverse LOGIN; END IF; END\$\$;"
sudo -u postgres psql -qc "ALTER ROLE transverse PASSWORD '$DB_PASS';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='transverse'" | grep -q 1 || sudo -u postgres createdb -O transverse transverse
# The old server's Caddyfile (domain, HTTPS).
cp /root/Caddyfile.from-old-server /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null && systemctl reload caddy

echo
echo "============================================================"
echo " Ready. Next: the game STOPS on the old server, the database"
echo " is copied here and the game starts here (about 5-15 min)."
echo "============================================================"
read -r -p "Type YES to continue: " ok
[ "$ok" = "YES" ] || { echo "Stopped. Nothing changed on the old server."; exit 1; }

echo "==> 5. Stop the game on the old server (for good: no second worker or Discord bot)"
$SSH "systemctl disable --now transverse-web transverse-worker"

echo "==> 6. Copy the database"
systemctl stop transverse-web transverse-worker 2>/dev/null || true
$SSH "sudo -u postgres pg_dump -Fc transverse" > /tmp/transverse-move.dump
chown postgres /tmp/transverse-move.dump && ls -lh /tmp/transverse-move.dump
sudo -u postgres dropdb --if-exists transverse
sudo -u postgres createdb -O transverse transverse
sudo -u postgres pg_restore --no-owner --role=transverse -j 4 -d transverse /tmp/transverse-move.dump
sudo -u postgres psql -d transverse -tc "select count(*) || ' players' from users"

echo "==> 7. Memory limits, static files, start"
bash "$KIT/fix-502.sh"

echo "==> 8. Check"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/login; then echo "   the game answers here"; break; fi
  [ "$i" = 30 ] && echo "   !! the game does not answer yet: journalctl -u transverse-web -n 50"
  sleep 2
done

NEW_IP=$(curl -4 -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
echo
echo "============================================================"
echo " Done on this server. Now:"
echo "  1. DNS: point the domain (A record) to $NEW_IP."
echo "  2. GitHub → Settings → Secrets → Actions: VPS_HOST = $NEW_IP"
echo "  3. The old server stays stopped (keep it a few days as a spare)."
echo "============================================================"
