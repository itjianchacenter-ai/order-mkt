#!/usr/bin/env bash
# ติดตั้งระบบสั่งซื้อ JIANCHA บนเซิร์ฟเวอร์ Ubuntu 22.04 / 24.04 ใหม่ (รันครั้งเดียวด้วย root)
#   curl -fsSL https://raw.githubusercontent.com/itjianchacenter-ai/order-mkt/main/deploy/install.sh | sudo bash
# ทำอะไรบ้าง: Node.js 22, git, pm2, Caddy (HTTPS อัตโนมัติ), clone repo ไป /opt/order-mkt, สร้าง .env, เปิดบริการ, backup ฐานข้อมูลทุกคืน
set -euo pipefail
DOMAIN="${DOMAIN:-order.jianchatea.com}"
APP_DIR="${APP_DIR:-/opt/order-mkt}"
REPO="${REPO:-https://github.com/itjianchacenter-ai/order-mkt.git}"
PORT="${PORT:-3870}"

[ "$(id -u)" = 0 ] || { echo "กรุณารันด้วย sudo/root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg build-essential python3 sqlite3 ufw debian-keyring debian-archive-keyring apt-transport-https

# Node.js 22
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2 >/dev/null

# Caddy (reverse proxy + Let's Encrypt)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y && apt-get install -y caddy
fi

# แอป
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only; else git clone "$REPO" "$APP_DIR"; fi
cd "$APP_DIR"
npm ci --omit=dev
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s/^NODE_ENV=.*/NODE_ENV=production/; s/^PORT=.*/PORT=$PORT/; s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=https://$DOMAIN#" .env
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
  echo ">> สร้าง $APP_DIR/.env แล้ว (JWT_SECRET สุ่มให้) — ใส่ PROMPTPAY_ID, GOOGLE_CLIENT_ID, SMTP_* แล้วรัน: pm2 restart jiancha-order"
fi
mkdir -p uploads/design data backups

# บริการ (pm2 เริ่มอัตโนมัติเมื่อเครื่องรีบูต)
pm2 describe jiancha-order >/dev/null 2>&1 && pm2 restart jiancha-order --update-env || pm2 start server.js --name jiancha-order --time
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# Caddy: HTTPS ให้โดเมนอัตโนมัติ
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    encode gzip
    request_body { max_size 12MB }
    reverse_proxy 127.0.0.1:$PORT
}
CADDY
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

# ไฟร์วอลล์: เปิดเฉพาะ SSH + เว็บ
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null

# backup ฐานข้อมูล + รูปสลิปทุกคืน 03:00 (เก็บ 30 วัน)
install -m 755 deploy/backup.sh /usr/local/bin/jiancha-backup
( crontab -l 2>/dev/null | grep -v jiancha-backup; echo "0 3 * * * APP_DIR=$APP_DIR /usr/local/bin/jiancha-backup >/var/log/jiancha-backup.log 2>&1" ) | crontab -

echo
echo "================================================================"
echo " ติดตั้งเสร็จ: https://$DOMAIN  (Caddy จะขอใบรับรอง HTTPS เองเมื่อ DNS ชี้มาที่เครื่องนี้)"
echo " แอป: $APP_DIR   log: pm2 logs jiancha-order   ตั้งค่า: nano $APP_DIR/.env แล้ว pm2 restart jiancha-order"
echo " หลังบ้าน: https://$DOMAIN/admin-page  (เปลี่ยนรหัสผ่าน 3 บัญชีในหน้า Account ก่อนเปิดใช้)"
echo "================================================================"
