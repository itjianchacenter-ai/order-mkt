#!/usr/bin/env bash
# สำรองฐานข้อมูล SQLite (แบบ online-safe) + รูปสลิป/รูปแคมเปญ ไว้ที่ $APP_DIR/backups เก็บ 30 วัน
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/order-mkt}"
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$APP_DIR/backups"
sqlite3 "$APP_DIR/data/orders.db" ".backup '$APP_DIR/backups/orders-$TS.db'"
tar -czf "$APP_DIR/backups/uploads-$TS.tgz" -C "$APP_DIR" uploads
find "$APP_DIR/backups" -type f -mtime +30 -delete
echo "backup ok $TS"
