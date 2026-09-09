/* Build a single-file, backend-free preview of the site (dist/preview.html).
   Every page is bundled; api() is swapped for scripts/preview/mock-api.js (localStorage). */
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..'); const PUB = path.join(ROOT, 'public');
const out = process.argv[2] || path.join(ROOT, 'dist', 'preview.html');
const read = (p) => fs.readFileSync(p, 'utf8');
const css = read(path.join(PUB, 'css/style.css'));
const menu = JSON.parse(read(path.join(ROOT, 'data/menu.json'))); const stores = JSON.parse(read(path.join(ROOT, 'data/stores.json')));
const normSet = (x) => { const items = (x.items || []).map((i) => ({ name_en: i.name_en || '', name_th: i.name_th || '', kind: i.kind || '' })); return { id: String(x.id), label: x.label || `SET ${x.id}`, name_en: x.name_en || '', name_th: x.name_th || '', price: Number(x.price) || 0, image: x.image || '', images: x.images || [], items, pieces: Number(x.pieces) > 0 ? Number(x.pieces) : 1, drink_pieces: items.filter((i) => i.kind === 'drink').length, dessert_pieces: items.filter((i) => i.kind === 'dessert').length }; };
const menuPublic = { banner: menu.banner || '', stock: menu.stock || {}, promo_code: menu.promo_code || {}, sets: (menu.sets || []).filter((x) => x.active !== false).map(normSet), drinks: (menu.drinks || []).filter((x) => x.active !== false), desserts: (menu.desserts || []).filter((x) => x.active !== false) };

const toPreview = (js) => js
  .replace(/location\.href = /g, "location.hash = '#' + ")
  .replace(/location\.reload\(\)/g, 'route()')
  .replace(/location\.search/g, "pvSearch()")
  .replace(/location\.pathname/g, "pvPath()")
  .replace(/href="\//g, 'href="#/')
  .replace(/href="\$\{ADMIN_PATH\}/g, 'href="#${ADMIN_PATH}');
// app.js without its real api(): the mock defines api() instead
let app = read(path.join(PUB, 'js/app.js'));
app = app.replace(/async function api\(path, opts = \{\}\) \{[\s\S]*?\n\}\n/, '/* api() provided by mock-api.js */\n');
if (/async function api\(/.test(app)) throw new Error('failed to strip api()');
app = toPreview(app).replace('location.href = ADMIN_PATH; else', "location.hash = '#' + ADMIN_PATH; else");

const PAGES = { landing: 'landing', home: 'index', cart: 'cart', orders: 'orders', stores: 'stores', pay: 'pay', receipt: 'receipt', admin: 'admin-page' };
const html = {}, js = {};
for (const [name, file] of Object.entries(PAGES)) {
  const src = read(path.join(PUB, file + '.html'));
  const m = src.match(/<div class="wrap">([\s\S]*?)<\/div>\s*<script src="\/js\/app\.js"><\/script>\s*<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('cannot parse ' + file);
  html[name] = toPreview(m[1]).replace(/href="#\/pay\?order=/g, 'href="#/pay?order=');
  js[name] = toPreview(m[2]);
}
const mock = read(path.join(__dirname, 'preview/mock-api.js'));

const page = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<title>JIANCHA x NAVORI Order</title>
<link rel="icon" type="image/png" href="data:image/png;base64,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"><link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;800&family=Noto+Sans+Thai:wght@400;700&display=swap" rel="stylesheet">
<style>
${css}
.pv-bar{background:#000;color:#fff;font-size:12px;padding:6px 16px;display:flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap}
.pv-bar b{font-weight:700;letter-spacing:.5px}
.pv-bar a,.pv-bar button{color:#fff;background:none;border:1px solid #fff;border-radius:999px;padding:2px 10px;font-size:12px;text-decoration:none;cursor:pointer}
</style>
</head>
<body>
<div class="pv-bar" id="pv-bar" style="display:none"><b>PREVIEW</b><span class="th">ข้อมูลทดลอง เก็บในเบราว์เซอร์นี้เท่านั้น</span><a href="#/">หน้าร้าน</a><button type="button" id="pv-reset">รีเซ็ตข้อมูล</button></div>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
<script>
window.PREVIEW_MODE = true;
// Static hosting serves this file for every path (404.html), so /jianchaxnavori/ and /backend/ work as real URLs;
// in-app links then use #/... routes. The current "path"/"search" come from the hash when there is one, else the real URL.
const PV_BASE = (window.location['pathname'].match(new RegExp('^(.*/)[^/]*[.]html$')) || [, '/'])[1];
function pvPath() {
  if (location.hash.length > 1) return '/' + location.hash.replace(new RegExp('^#/?'), '').split('?')[0];
  let p = window.location['pathname']; if (p.startsWith(PV_BASE)) p = '/' + p.slice(PV_BASE.length);
  return p.replace(new RegExp('/index[.]html$'), '/').replace(new RegExp('[.]html$'), '');
}
function pvSearch() { return location.hash.includes('?') ? '?' + location.hash.split('?')[1] : (location.hash.length > 1 ? '' : window.location['search']); }
const PREVIEW_GOOGLE_CLIENT_ID = ${JSON.stringify((process.env.GOOGLE_CLIENT_ID || '').trim())}; // ว่าง = ปุ่มทดลองล็อกอินด้วยอีเมล
const PREVIEW_MENU = ${JSON.stringify(menuPublic)};
const PREVIEW_STORES = ${JSON.stringify(stores.filter((s) => s.active !== false).map((s) => ({ id: String(s.id), brand: s.brand || 'JIANCHA', name: s.name, map_url: s.map_url || '' })))};
${mock}
${app}
const PAGE_HTML = ${JSON.stringify(html)};
const PAGE_JS = {
${Object.entries(js).map(([n, code]) => `  ${n}: function () {\n${code}\n  },`).join('\n')}
};
const ROUTES = { '/': 'landing', '/index': 'home', '/cart': 'cart', '/orders': 'orders', '/stores': 'stores', '/pay': 'pay', '/receipt': 'receipt', '/backend': 'admin', '/admin-page': 'admin' };
function route() {
  let h = pvPath().split('?')[0].replace(new RegExp('/+$'), '') || '/';
  // #/<campaign-slug>/cart -> page 'cart' of that campaign (campaignSlug() reads the slug from the hash)
  const segs = h.split('/').filter(Boolean);
  const hasSlug = segs.length > 0 && !ROUTES['/' + segs[0]] && segs[0] !== 'index';
  if (hasSlug) h = '/' + segs.slice(1).join('/');
  if (h === '') h = '/';
  // "/" is the Order-with-us landing; "/<slug>/" is that campaign's home
  const name = (h === '/' && hasSlug) ? 'home' : (ROUTES[h] || 'home');
  // แถบ PREVIEW (ข้อมูลทดลอง + บัญชีหลังบ้าน) แสดงเฉพาะหน้าหลังบ้าน /backend เท่านั้น หน้าลูกค้าไม่แสดง
  document.getElementById('pv-bar').style.display = name === 'admin' ? '' : 'none';
  document.getElementById('root').innerHTML = '<div class="wrap">' + PAGE_HTML[name] + '</div>';
  window.scrollTo(0, 0);
  PAGE_JS[name]();
}
window.addEventListener('hashchange', route);
document.getElementById('pv-reset').addEventListener('click', () => { if (confirm('ล้างข้อมูลทดลองทั้งหมด?')) { pvReset(); location.hash = '#/'; route(); } });
route();
</script>
</body>
</html>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`preview -> ${out} (${(page.length / 1024).toFixed(0)} KB)`);
