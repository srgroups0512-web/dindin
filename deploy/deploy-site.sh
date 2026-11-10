#!/usr/bin/env bash
set -euo pipefail

archive="${1:?Usage: deploy-site.sh /tmp/dindin-site.tar.gz}"
stamp="$(date -u +%Y%m%d-%H%M%S)"
stage="/var/www/dindin-stage-$stamp"
backup_root="/var/www/dindin-backups"
backup="$backup_root/$stamp"
failed="/var/www/dindin-failed-$stamp"

echo "Preparing website release $stamp"
sudo mkdir -p "$backup_root"
sudo mkdir "$stage"
sudo tar -xzf "$archive" -C "$stage"
sudo test -f "$stage/index.html"
sudo test -f "$stage/privacy.html"
sudo test -f "$stage/terms.html"
sudo test -f "$stage/delete-account.html"
sudo test -f "$stage/deletion-request-received.html"
sudo test -f "$stage/styles.css"
sudo test -f "$stage/downloads/DinDin-latest.apk"
sudo grep -q 'Set a reminder for yourself' "$stage/index.html"
sudo grep -q 'Account-deletion request' "$stage/delete-account.html"
sudo chown -R root:www-data "$stage"
sudo find "$stage" -type d -exec chmod 755 {} +
sudo find "$stage" -type f -exec chmod 644 {} +
sudo nginx -t

echo "Switching website release"
sudo mv /var/www/dindin "$backup"
sudo mv "$stage" /var/www/dindin

if ! curl -fsS --resolve dindin.info:443:127.0.0.1 https://dindin.info/ | grep -q 'Set a reminder for yourself' ||
   ! curl -fsS --resolve dindin.info:443:127.0.0.1 https://dindin.info/delete-account.html | grep -q 'Account-deletion request' ||
   ! curl -fsSI --resolve dindin.info:443:127.0.0.1 https://dindin.info/downloads/DinDin-latest.apk | grep -q '200'; then
  echo "Website health check failed; rolling back"
  sudo mv /var/www/dindin "$failed"
  sudo mv "$backup" /var/www/dindin
  sudo systemctl reload nginx
  exit 1
fi

sudo systemctl reload nginx
echo "Website deployment complete"
