#!/usr/bin/env bash
# One-time fix for the 502 pages (run as root on the server):
#   sudo bash /var/www/transverse/current/deploy/fix-502.sh
# 1. Shows why the game restarted in the last 3 days (killed for memory or crashed).
# 2. Installs the service files with a memory limit for Node (no more kills for memory).
# 3. Makes Caddy wait for the game while it restarts instead of answering 502.
# 4. Adds 2 GB of swap on a small server without any.
# Safe to run again: every step checks first.
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)

echo "==> 1. Why the game restarted (last 3 days)"
for s in transverse-web transverse-worker; do
  starts=$(journalctl -u "$s" --since "3 days ago" --no-pager 2>/dev/null | grep -c "Started " || true)
  oom=$(journalctl -u "$s" --since "3 days ago" --no-pager 2>/dev/null | grep -ciE "oom|out of memory|memory limit|status=9/KILL" || true)
  failed=$(journalctl -u "$s" --since "3 days ago" --no-pager 2>/dev/null | grep -cE "Main process exited|Failed with result" || true)
  echo "   $s: started $starts times, killed for memory $oom, exited with an error $failed"
done
echo "   Last lines about stops:"
journalctl -u transverse-web --since "3 days ago" --no-pager 2>/dev/null | grep -iE "oom|killed|exited|Failed|uncaught|FATAL|heap" | tail -n 8 | sed 's/^/     /' || true
echo "   Memory of the server:"
free -h | sed 's/^/     /'

echo "==> 2. Service files (memory limit for Node)"
install -m 644 "$DIR/transverse-web.service" /etc/systemd/system/transverse-web.service
install -m 644 "$DIR/transverse-worker.service" /etc/systemd/system/transverse-worker.service
# Limits that fit this server. The JavaScript heap stays small (640 MB): Node then cleans up as
# it goes — under load a capped site stayed at ~350 MB, an uncapped one grew past 1 GB just
# because it could. The service limit is generous (half the RAM, at least 1400 MB) so a busy
# moment is never a kill; no MemoryHigh (above it the kernel throttles the site).
RAM_MB=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024 ))
WEB_MAX=$(( RAM_MB / 2 )); [ "$WEB_MAX" -lt 1400 ] && WEB_MAX=1400
WEB_HEAP=640
mkdir -p /etc/systemd/system/transverse-web.service.d /etc/systemd/system/transverse-worker.service.d
printf '[Service]\nMemoryHigh=infinity\nMemoryMax=%sM\nEnvironment=NODE_OPTIONS=--max-old-space-size=%s\nTimeoutStopSec=10\nKillMode=mixed\n' "$WEB_MAX" "$WEB_HEAP" > /etc/systemd/system/transverse-web.service.d/memory.conf
printf '[Service]\nMemoryHigh=infinity\nMemoryMax=600M\nEnvironment=NODE_OPTIONS=--max-old-space-size=384\nTimeoutStopSec=10\nKillMode=mixed\n' > /etc/systemd/system/transverse-worker.service.d/memory.conf
echo "   server: ${RAM_MB} MB RAM, $(nproc) CPU -> site: limit ${WEB_MAX} MB, heap ${WEB_HEAP} MB; worker: 600 MB, heap 384 MB"
systemctl daemon-reload

echo "==> 3. Caddy waits for the game during a restart"
CF=/etc/caddy/Caddyfile
if grep -q "lb_try_duration" "$CF"; then
  echo "   already set"
else
  cp "$CF" "$CF.bak-$(date +%Y%m%d%H%M%S)"
  # "reverse_proxy 127.0.0.1:3000" on its own line becomes a block that retries for 30 s.
  perl -0pi -e 's/^(\s*)reverse_proxy 127\.0\.0\.1:3000[ \t]*$/$1reverse_proxy 127.0.0.1:3000 {\n$1\tlb_try_duration 30s\n$1\tlb_try_interval 500ms\n$1}/mg' "$CF"
  if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy && echo "   done"
  else
    echo "   the new Caddyfile did not validate — the old one is back"
    cp "$(ls -1t "$CF".bak-* | head -n1)" "$CF"
  fi
fi

echo "==> 3b. Caddy serves the game's static files itself (not through Node)"
STATIC=/var/www/transverse/current/app/.next/static
CADDY_USER=$(ps -o user= -C caddy 2>/dev/null | head -n1 || true)
CADDY_USER=${CADDY_USER:-caddy}
if grep -q "_next/static" "$CF"; then
  echo "   already set"
elif [ ! -d "$STATIC" ] || ! sudo -u "$CADDY_USER" test -r "$(find "$STATIC" -type f -name '*.js' | head -n1)"; then
  echo "   skipped: $CADDY_USER cannot read $STATIC"
else
  cp "$CF" "$CF.bak-$(date +%Y%m%d%H%M%S)"
  # Before the first "reverse_proxy" of the site: /_next/static straight from disk, cached for a year.
  perl -0pi -e 's/^(\s*)(\@sse|reverse_proxy)/$1handle_path \/_next\/static\/* {\n$1\troot * \/var\/www\/transverse\/current\/app\/.next\/static\n$1\theader Cache-Control "public, max-age=31536000, immutable"\n$1\tfile_server\n$1}\n$1$2/m' "$CF"
  if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy && echo "   done"
  else
    echo "   the new Caddyfile did not validate — the old one is back"
    cp "$(ls -1t "$CF".bak-* | head -n1)" "$CF"
  fi
fi
grep -q "encode" "$CF" || echo "   !! The Caddyfile has no \"encode zstd gzip\": add it, the game no longer compresses answers itself."

echo "==> 4. Swap"
if [ "$(swapon --show --noheadings | wc -l)" -gt 0 ]; then
  echo "   already on"
elif [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 8000000 ] && [ ! -e /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q "^/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
  echo "   2 GB swap added"
else
  echo "   not needed"
fi

echo "==> 5. Restart with the new settings (and no left-over processes)"
systemctl stop transverse-web transverse-worker || true
sleep 2
LEFT=$(pgrep -f "next-server|node server.js|dist/worker.js" || true)
if [ -n "$LEFT" ]; then
  echo "   left-over processes of the game (killed now):"
  ps -o pid,rss,etime,cmd -p $LEFT | sed 's/^/     /'
  kill -9 $LEFT || true
  sleep 1
fi
if [ "$(swapon --show --noheadings | wc -l)" -gt 0 ] && [ "$(free -m | awk '/Mem:/ {print $7}')" -gt "$(free -m | awk '/Swap:/ {print $3}')" ]; then
  swapoff -a && swapon -a && echo "   swap emptied"
fi
systemctl start transverse-worker transverse-web
sleep 5
systemctl is-active transverse-web transverse-worker
echo "Done. Админ → Система → „Рестарти на сървъра“ shows from now on every restart and the memory before it."
