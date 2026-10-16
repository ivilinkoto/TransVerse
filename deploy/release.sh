#!/usr/bin/env bash
# Activates an uploaded release. Runs on the server as the deploy user:
#   bash release.sh /var/www/transverse/releases/<id>
set -euo pipefail
RELEASE=${1:?release directory}
APP_DIR=/var/www/transverse

# First deployment on a fresh server: files are uploaded, but the server is not prepared yet.
if ! command -v node >/dev/null || [ ! -r /etc/transverse/transverse.env ]; then
  echo "============================================================"
  echo " Сървърът още не е подготвен (липсва Node.js или настройките)."
  echo " Файловете са качени. Влез като root и изпълни:"
  echo "   bash $RELEASE/deploy/setup-server.sh"
  echo " След това пусни отново Deploy в GitHub (Re-run jobs)."
  echo "============================================================"
  exit 1
fi
set -a; . /etc/transverse/transverse.env; set +a

cd "$RELEASE"
echo "==> Database migrations"
node dist/migrate.js
echo "==> Real-world geography (idempotent)"
node dist/import-geonames.js data/geo/launch-region.json

echo "==> Switching release"
ln -sfn "$RELEASE" "$APP_DIR/current.new" && mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
sudo /usr/bin/systemctl restart transverse-web
sudo /usr/bin/systemctl restart transverse-worker

echo "==> Health check"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT:-3000}/login"; then echo "Healthy"; break; fi
  [ "$i" = 30 ] && { echo "Web service did not become healthy"; exit 1; }
  sleep 2
done

# Warm-up (first deploy only fills routes/season/market; later runs are cheap).
node dist/seed.js 1 || echo "Seed step failed (non-fatal)"

echo "==> Keeping the 5 most recent releases"
ls -1dt "$APP_DIR"/releases/* | tail -n +6 | xargs -r rm -rf
echo "Release $(basename "$RELEASE") is live."
