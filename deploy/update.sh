#!/usr/bin/env bash
# อัปเดตโค้ดเป็นเวอร์ชันล่าสุดจาก GitHub แล้วรีสตาร์ต (รันบนเซิร์ฟเวอร์)
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/order-mkt}"
cd "$APP_DIR"
/usr/local/bin/jiancha-backup || true
git pull --ff-only
npm ci --omit=dev
pm2 restart jiancha-order --update-env
pm2 logs jiancha-order --lines 20 --nostream
