#!/usr/bin/env bash
# สร้างเว็บลงโฟลเดอร์ _site
#   SITE_MODE=real     → เว็บจริงสำหรับ Cloudflare Pages: หน้าเว็บจาก public/ + _worker.js (API บน D1/R2)  [ค่าเริ่มต้นเมื่อ build บน Cloudflare Pages]
#   SITE_MODE=preview  → เว็บ preview ไฟล์เดียวไม่มีเซิร์ฟเวอร์ (GitHub Pages)                            [ค่าเริ่มต้นที่อื่น]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${OUT:-_site}"
MODE="${SITE_MODE:-}"
if [ -z "$MODE" ]; then if [ "${CF_PAGES:-}" = "1" ]; then MODE=real; else MODE=preview; fi; fi
rm -rf "$OUT"; mkdir -p "$OUT"
if [ "$MODE" = "real" ]; then
  cp -r public/. "$OUT/"
  mv "$OUT/index.html" "$OUT/home.html"        # / คือหน้า landing, หน้าแคมเปญ (index.html) ถูก worker เสิร์ฟที่ /<slug>/ และ /index
  # cache-busting: อ้าง /js/app.js และ /css/style.css ด้วย ?v=<commit> ทุกหน้า → เบราว์เซอร์โหลดไฟล์ใหม่ทันทีหลัง deploy (ไม่ต้องรอ cache หมดอายุ)
  VER="${CF_PAGES_COMMIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}"; VER="${VER:0:12}"
  for f in "$OUT"/*.html; do sed -i -e "s#\(src=\"/js/[a-z-]*\.js\)\"#\1?v=$VER\"#g" -e "s#\(href=\"/css/style\.css\)\"#\1?v=$VER\"#g" "$f"; done
  node scripts/build-worker.js "$OUT/_worker.js"
  # ไฟล์ static (css/js/img/fonts) ไม่ต้องผ่าน worker; ที่เหลือ (API, หน้าเว็บ, uploads) ผ่าน worker
  printf '{ "version": 1, "include": ["/*"], "exclude": ["/css/*", "/js/*", "/img/*", "/fonts/*"] }\n' > "$OUT/_routes.json"
  printf '/*.html\n  Cache-Control: no-cache\n/css/*\n  Cache-Control: public, max-age=3600\n/js/*\n  Cache-Control: public, max-age=3600\n' > "$OUT/_headers"
  echo "built $OUT (real site: pages + _worker.js, $(du -sh "$OUT" | cut -f1))"
else
  mkdir -p "$OUT/img"
  node scripts/build-preview.js "$OUT/index.html"
  cp "$OUT/index.html" "$OUT/404.html"
  touch "$OUT/.nojekyll"
  cp -r public/img/. "$OUT/img/"
  printf '/index.html\n  Cache-Control: no-cache\n/404.html\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n' > "$OUT/_headers"
  echo "built $OUT (preview, $(du -sh "$OUT" | cut -f1))"
fi
