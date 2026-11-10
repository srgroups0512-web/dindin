#!/usr/bin/env bash
set -euo pipefail

archive="${1:?Usage: deploy-api.sh /tmp/dindin-api.tar.gz}"
stamp="$(date -u +%Y%m%d-%H%M%S)"
stage="/opt/dindin-api-stage-$stamp"
backup_root="/opt/dindin-api-backups"
backup="$backup_root/$stamp"
failed="/opt/dindin-api-failed-$stamp"

echo "Preparing release $stamp"
sudo mkdir -p "$backup_root"
sudo mkdir "$stage"
sudo tar -xzf "$archive" -C "$stage"
sudo env npm_config_cache="/tmp/dindin-npm-cache-$stamp" npm ci --omit=dev --prefix "$stage"
sudo chown -R dindin:dindin "$stage"

echo "Applying database migration"
sudo systemd-run \
  --wait \
  --pipe \
  --collect \
  --unit="dindin-migrate-$stamp" \
  -p User=dindin \
  -p Group=dindin \
  -p WorkingDirectory="$stage" \
  -p EnvironmentFile=/etc/dindin-api.env \
  -p EnvironmentFile=-/etc/dindin-otp.env \
  /usr/bin/node db/migrate.js

echo "Switching release"
sudo systemctl stop dindin-api
sudo mv /opt/dindin-api "$backup"
sudo mv "$stage" /opt/dindin-api

if ! sudo systemctl start dindin-api; then
  echo "Start failed; rolling back"
  sudo mv /opt/dindin-api "$failed"
  sudo mv "$backup" /opt/dindin-api
  sudo systemctl start dindin-api
  exit 1
fi

healthy=0
for _attempt in {1..10}; do
  body="$(curl -fsS http://127.0.0.1:8787/health || true)"
  if printf '%s' "$body" | grep -q '"checkInModel":"self"'; then
    healthy=1
    printf '%s\n' "$body"
    break
  fi
  sleep 1
done

if [[ "$healthy" -ne 1 ]]; then
  echo "Health check failed; rolling back"
  sudo systemctl stop dindin-api || true
  sudo mv /opt/dindin-api "$failed"
  sudo mv "$backup" /opt/dindin-api
  sudo systemctl start dindin-api
  exit 1
fi

echo "Deployment complete"
sudo systemctl --no-pager --full status dindin-api | head -18
