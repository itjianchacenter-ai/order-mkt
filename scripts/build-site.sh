#!/usr/bin/env bash
# สร้างเว็บ preview แบบ static ลงโฟลเดอร์ _site (ใช้ได้ทั้ง GitHub Pages และ Cloudflare Pages)
#   bash scripts/build-site.sh            → _site/index.html, _site/404.html, _site/img/...
# ตัวแปร GOOGLE_CLIENT_ID (ถ้ามี) จะถูกฝังเพื่อเปิด Sign in with Google บน preview
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${OUT:-_site}"
rm -rf "$OUT"; mkdir -p "$OUT/img"
node scripts/build-preview.js "$OUT/index.html"
cp "$OUT/index.html" "$OUT/404.html"
touch "$OUT/.nojekyll"
cp -r public/img/. "$OUT/img/"
# Cloudflare Pages: กันไม่ให้ cache หน้า HTML ค้าง (รูปยัง cache ได้)
printf '/index.html\n  Cache-Control: no-cache\n/404.html\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n' > "$OUT/_headers"
echo "built $OUT ($(du -sh "$OUT" | cut -f1))"
