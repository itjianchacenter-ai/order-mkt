/* Shared: icons, header, cart (localStorage), API helper, formatting */
const ICONS = {
  cart: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM3 2v2h2l3.6 7.6L7.2 14A2 2 0 0 0 9 17h11v-2H9.4l1-2h7.5a2 2 0 0 0 1.7-1l3.6-6.5A1 1 0 0 0 22.4 4H6.2l-.9-2H3z"/></svg>',
  doc: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5L13 3.5zM8 12v2h8v-2H8zm0 4v2h8v-2H8z"/></svg>',
  store: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h18v2H3V3zm-1 3h20l1 5a3 3 0 0 1-3 3 3 3 0 0 1-2.5-1.3A3 3 0 0 1 15 14a3 3 0 0 1-2.5-1.3A3 3 0 0 1 10 14a3 3 0 0 1-2.5-1.3A3 3 0 0 1 5 14a3 3 0 0 1-3-3l1-5zm2 9.6A5 5 0 0 0 5 16a5 5 0 0 0 2.5-.7A5 5 0 0 0 10 16a5 5 0 0 0 2.5-.7A5 5 0 0 0 15 16a5 5 0 0 0 2.5-.7A5 5 0 0 0 20 16v5H4v-5.4zM6 17v2h4v-2H6z"/></svg>',
  drink: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4h14v2H5V4zm1 3h12l-1 12.5A2 2 0 0 1 15 21H9a2 2 0 0 1-2-1.5L6 7zm2.2 2 .7 8h6.2l.7-8H8.2zM13 2l.8 1.5H10L11 2h2z"/></svg>',
  dessert: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1.7 0 3 1.3 3 3 0 .5-.1 1-.4 1.4A4 4 0 0 1 18 10v1H6v-1a4 4 0 0 1 3.4-3.6A3 3 0 0 1 9 5c0-1.7 1.3-3 3-3zM5 12h14l-1.5 9H6.5L5 12zm3.5 2 .8 5h5.4l.8-5H8.5z"/></svg>',
  match: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M2 4h9v2H2V4zm1 3h7l-.8 10.5A2 2 0 0 1 7.2 19H5.8a2 2 0 0 1-2-1.5L3 7zm10.5-1a2.5 2.5 0 0 1 4.3-1.7A2.5 2.5 0 0 1 22 6a3 3 0 0 1-1 2.2V9h-7v-.8A3 3 0 0 1 13.5 6zM14 10h7l-1 9h-5l-1-9z"/></svg>',
  pin: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>',
  tag: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M21.4 11.6l-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7c0 .6.2 1.1.6 1.4l9 9a2 2 0 0 0 2.8 0l7-7a2 2 0 0 0 0-2.8zM6.5 8A1.5 1.5 0 1 1 8 6.5 1.5 1.5 0 0 1 6.5 8z"/></svg>',
  cal: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M7 2h2v2h6V2h2v2h3v18H4V4h3V2zM6 9v11h12V9H6zm2 2h2v2H8v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2zM8 15h2v2H8v-2zm4 0h2v2h-2v-2z"/></svg>',
  right: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M8 4l10 8-10 8V4z"/></svg>',
  down: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M4 8h16l-8 10L4 8z"/></svg>',
  arrowL: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M11 4l2 2-4 4h11v4H9l4 4-2 2-8-8 8-8z"/></svg>',
  arrowR: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M13 4l-2 2 4 4H4v4h11l-4 4 2 2 8-8-8-8z"/></svg>',
  ticket: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7zm7 1v8h2V8H9zm4 0v8h2V8h-2z"/></svg>',
  target: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>',
  user: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 12c5 0 9 2.5 9 5.5V22H3v-2.5C3 16.5 7 14 12 14z"/></svg>',
  wrench: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5L13 18a2.1 2.1 0 0 1-3-3l6.7-6.7z"/><path d="M14.7 6.3L17 4l3 3-2.3 2.3M4 20l3-3"/></svg>',
  eye: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5c5 0 9 3.5 11 7-2 3.5-6 7-11 7S3 15.5 1 12c2-3.5 6-7 11-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>',
  slip: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 1.6 2.9-.3 1 2.7 2.7 1-.3 2.9L22 12l-1.3 2.1.3 2.9-2.7 1-1 2.7-2.9-.3L12 22l-2.1-1.6-2.9.3-1-2.7-2.7-1 .3-2.9L2 12l1.6-2.1-.3-2.9 2.7-1 1-2.7 2.9.3L12 2z"/></svg>',
  print: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h12v5H6V2zm-2 6h16a2 2 0 0 1 2 2v7h-4v5H6v-5H2v-7a2 2 0 0 1 2-2zm4 9v3h8v-3H8zm10-6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.4-1.4z"/></svg>',
  brush: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M20.7 3.3a1 1 0 0 0-1.4 0L9.5 13.1l1.4 1.4 9.8-9.8a1 1 0 0 0 0-1.4zM8.2 14.4a3.3 3.3 0 0 0-3.3 3.1c-.1 1.2-.6 2-1.9 2.5.9.7 2.3 1 3.6 1a3.7 3.7 0 0 0 3.7-3.6l-2.1-3z"/></svg>',
  google: '<svg class="ic" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9l3.3-2.5z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.8 9.4 6 12 6z"/></svg>',
  customer: '<svg class="ic" viewBox="0 0 150 150" fill="currentColor"><defs><clipPath id="cust-4d7eac6610"><path d="M 60 5.15 L 86 5.15 L 86 30 L 60 30 Z M 60 5.15 "/></clipPath><clipPath id="cust-8dd7940305"><path d="M 5.15 57 L 21 57 L 21 144.65 L 5.15 144.65 Z M 5.15 57 "/></clipPath><clipPath id="cust-b61f1f4d45"><path d="M 129 57 L 144.65 57 L 144.65 144.65 L 129 144.65 Z M 129 57 "/></clipPath><clipPath id="cust-8fe0d74fd8"><path d="M 23 57 L 127 57 L 127 144.65 L 23 144.65 Z M 23 57 "/></clipPath></defs><path fill="currentColor" d="M 64.05 78.00 L 64.05 101.25 L 85.75 101.25 L 85.75 78.00 C 85.75 77.14 86.44 76.45 87.30 76.45 L 95.05 76.45 L 95.05 50.10 C 95.05 48.21 94.42 46.46 93.24 44.91 C 91.37 42.49 88.34 41.11 85.13 41.11 L 64.67 41.11 C 61.46 41.11 58.42 42.49 56.56 44.91 C 55.38 46.46 54.75 48.21 54.75 50.10 L 54.75 76.45 L 62.50 76.45 C 63.35 76.45 64.05 77.14 64.05 78.00 Z M 64.05 78.00 "/><g clip-path="url(#cust-4d7eac6610)"><path fill="currentColor" d="M 73.35 29.95 C 80.19 29.95 85.75 24.39 85.75 17.55 C 85.75 10.71 80.19 5.15 73.35 5.15 C 66.51 5.15 60.95 10.71 60.95 17.55 C 60.95 24.39 66.51 29.95 73.35 29.95 Z M 73.35 29.95 "/></g><g clip-path="url(#cust-8dd7940305)"><path fill="currentColor" d="M 5.15 62.29 L 5.15 140.21 C 5.15 142.66 7.14 144.65 9.59 144.65 L 20.65 144.65 L 20.65 57.85 L 9.59 57.85 C 7.14 57.85 5.15 59.84 5.15 62.29 Z M 5.15 62.29 "/></g><g clip-path="url(#cust-b61f1f4d45)"><path fill="currentColor" d="M 140.10 57.85 L 129.15 57.85 L 129.15 144.65 L 140.10 144.65 C 142.61 144.65 144.65 142.61 144.65 140.10 L 144.65 62.40 C 144.65 59.89 142.61 57.85 140.10 57.85 Z M 140.10 57.85 "/></g><g clip-path="url(#cust-8fe0d74fd8)"><path fill="currentColor" d="M 98.15 78.00 C 98.15 78.85 97.46 79.55 96.60 79.55 L 88.85 79.55 L 88.85 102.80 C 88.85 103.66 88.16 104.35 87.30 104.35 L 62.50 104.35 C 61.64 104.35 60.95 103.66 60.95 102.80 L 60.95 79.55 L 53.20 79.55 C 52.34 79.55 51.65 78.85 51.65 78.00 L 51.65 57.85 L 23.75 57.85 L 23.75 144.65 L 126.05 144.65 L 126.05 57.85 L 98.15 57.85 Z M 109.00 132.25 L 40.80 132.25 C 39.94 132.25 39.25 131.56 39.25 130.70 C 39.25 129.84 39.94 129.15 40.80 129.15 L 109.00 129.15 C 109.85 129.15 110.55 129.84 110.55 130.70 C 110.55 131.56 109.85 132.25 109.00 132.25 Z M 110.55 118.30 C 110.55 119.16 109.85 119.85 109.00 119.85 L 40.80 119.85 C 39.94 119.85 39.25 119.16 39.25 118.30 C 39.25 117.44 39.94 116.75 40.80 116.75 L 109.00 116.75 C 109.85 116.75 110.55 117.44 110.55 118.30 Z M 110.55 118.30 "/></g></svg>',  // ไอคอน Customer (customer.svg จากทีม)
  users: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm7 1a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM9 13c4.4 0 8 2 8 4.5V21H1v-3.5C1 15 4.6 13 9 13zm7 .5c3.4 0 6 1.6 6 3.7V21h-3.5v-3.5c0-1.4-.7-2.7-1.9-3.7l-.6-.3z"/></svg>',
  menu: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M2 4h20v3H2V4zm0 6.5h20v3H2v-3zM2 17h20v3H2v-3z"/></svg>',
  logout: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5"/><path d="M15 8l4 4-4 4"/><path d="M9 12h10"/></svg>',
  upload: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l5 5-1.4 1.4L13 6.8V16h-2V6.8L8.4 9.4 7 8l5-5zM4 18h16v3H4v-3z"/></svg>',
};

/* Campaign pages live at /<slug>/ (e.g. /jianchaxnavori/). The root shows the active campaign. */
const KNOWN_PAGES = ['', 'index', 'index.html', 'cart', 'orders', 'stores', 'pay', 'receipt', 'backend', 'admin-page'];
const ADMIN_PATH = '/backend'; // หลังบ้าน JIAN CHA Page (เดิม /admin-page ยัง redirect มาที่นี่)
function campaignSlug() {
  const seg = (location.pathname.split('/')[1] || '').toLowerCase().replace(/\.html$/, '');
  return KNOWN_PAGES.includes(seg) ? '' : seg.replace(/[^a-z0-9]/g, '');
}
const B = () => (campaignSlug() ? '/' + campaignSlug() : '');          // path prefix for navigation
const H = () => (window.PREVIEW_MODE ? '#' : '') + B();                // same, for href attributes
const withCampaign = (p) => (campaignSlug() ? p + (p.includes('?') ? '&' : '?') + 'campaign=' + campaignSlug() : p);
const CART_KEY = 'jc_cart' + (campaignSlug() ? ':' + campaignSlug() : ''), STORE_KEY = 'jc_store', NOTE_KEY = 'jc_note';
const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

async function api(path, opts = {}) {
  const init = { credentials: 'same-origin', ...opts };
  if (init.body && !(init.body instanceof FormData)) { init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) }; init.body = JSON.stringify(init.body); }
  const r = await fetch(path, init);
  let data = null; try { data = await r.json(); } catch (e) { /* no body */ }
  if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
  return data;
}

/* ─── Customer account: Sign in with Google ───
   /api/me → { logged_in, login_required, google_client_id, email, name, picture }
   login_required = server has GOOGLE_CLIENT_ID; then Confirm (order) needs a signed-in customer. */
let ME = null;
async function loadMe(force = false) { if (!ME || force) { try { ME = await api('/api/me'); } catch (e) { ME = { logged_in: false, login_required: false }; } } return ME; }
function needLogin() { return Boolean(ME && ME.login_required && !ME.logged_in); }
let _gis = null;
function ensureGis() {
  if (window.google && window.google.accounts) return Promise.resolve();
  if (_gis) return _gis;
  _gis = new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true; s.onload = resolve; s.onerror = () => reject(new Error('โหลด Google Sign-In ไม่ได้ / Could not load Google Sign-In')); document.head.appendChild(s); });
  return _gis;
}
async function googleSignIn(credential) {
  ME = await api('/api/auth/google', { method: 'POST', body: { credential, campaign: campaignSlug() || undefined } });
  refreshAccountSlot(); return ME;
}
async function signOut() { ME = await api('/api/auth/logout', { method: 'POST' }); refreshAccountSlot(); location.reload(); }
/* pop-up: "Sign in with Google" (renders the official button); onDone runs after a successful sign-in */
let _loginDone = null;
async function openLoginModal(onDone) {
  _loginDone = onDone || null;
  let m = $('#login-modal');
  if (!m) {
    m = document.createElement('div'); m.id = 'login-modal'; m.className = 'modal';
    m.innerHTML = `<div class="modal-card"><button type="button" class="lb-close" aria-label="ปิด">×</button>
      <b style="font-size:20px">Sign in with Google</b><span class="th">เข้าสู่ระบบด้วยอีเมล Google เพื่อยืนยันคำสั่งซื้อและดูประวัติการสั่งซื้อ</span>
      <div id="gsi-btn" class="gsi-btn"></div><div class="err" id="login-err"></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.lb-close')) m.classList.remove('open'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') m.classList.remove('open'); });
  }
  m.classList.add('open'); const err = $('#login-err'); err.textContent = '';
  const done = async () => { m.classList.remove('open'); if (_loginDone) { const f = _loginDone; _loginDone = null; await f(); } };
  const cid = ME && ME.google_client_id;
  if (!cid) {
    // ยังไม่ได้ตั้งค่า Google Client ID
    if (window.PREVIEW_MODE) {
      // preview: ทดลองล็อกอินด้วยอีเมลที่พิมพ์เอง (ไม่มีการตรวจสอบ ใช้ทดสอบ flow เท่านั้น)
      $('#gsi-btn').innerHTML = `<form id="demo-login" class="demo-login"><input name="email" type="email" placeholder="you@gmail.com" required><button class="btn" type="submit">ทดลองเข้าสู่ระบบ (preview)</button><small class="th">ของจริงจะเป็นปุ่ม Sign in with Google เมื่อตั้งค่า Client ID แล้ว</small></form>`;
      $('#demo-login').addEventListener('submit', async (e) => { e.preventDefault(); try { ME = await api('/api/auth/google', { method: 'POST', body: { demo_email: new FormData(e.target).get('email'), campaign: campaignSlug() || undefined } }); refreshAccountSlot(); await done(); } catch (ex) { err.textContent = ex.message; } });
    } else err.textContent = 'ยังไม่ได้ตั้งค่า Google login บนเซิร์ฟเวอร์ (GOOGLE_CLIENT_ID)';
    return;
  }
  try {
    await ensureGis();
    google.accounts.id.initialize({ client_id: cid, callback: async (resp) => { try { await googleSignIn(resp.credential); await done(); } catch (ex) { err.textContent = ex.message; } }, ux_mode: 'popup', auto_select: false });
    $('#gsi-btn').innerHTML = '';
    google.accounts.id.renderButton($('#gsi-btn'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
  } catch (e) { err.textContent = e.message; }
}
/* header slot: "Sign in" pill, or the signed-in customer + Sign out */
function refreshAccountSlot() {
  const slot = $('#acct-slot'); if (!slot || !ME) return;
  if (ME.logged_in) slot.innerHTML = `<span class="pill user" title="${esc(ME.email)}">${ME.picture ? `<img class="avatar" src="${esc(ME.picture)}" alt="" referrerpolicy="no-referrer">` : ICONS.user} ${esc(ME.name || ME.email)}</span><button type="button" class="pill" id="signout">${ICONS.logout} Sign out</button>`;
  else if (ME.login_required) slot.innerHTML = `<button type="button" class="pill" id="signin">${ICONS.google} Sign in</button>`;
  else slot.innerHTML = '';
  const si = $('#signin'); if (si) si.addEventListener('click', () => openLoginModal());
  const so = $('#signout'); if (so) so.addEventListener('click', signOut);
}

/* cart: [{set_id, quantity}] — one line per Match Set */
function loadCart() { try { return (JSON.parse(localStorage.getItem(CART_KEY)) || []).filter((l) => l && l.set_id && l.quantity > 0); } catch (e) { return []; } }
function saveCart(c) { try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ } updateCartBadge(); }
function cartCount() { return loadCart().reduce((s, l) => s + (l.quantity || 0), 0); }
function lineKey(l) { return String(l.set_id || ''); }
function cartLine(set_id) { return loadCart().find((l) => l.set_id === set_id) || null; }
function cartAdd(set_id, qty = 1) {
  const c = loadCart(); const ex = c.find((l) => l.set_id === set_id);
  if (ex) ex.quantity = Math.min(99, ex.quantity + qty); else c.push({ set_id, quantity: qty });
  saveCart(c);
}
function cartSetQty(key, qty) { let c = loadCart(); c = c.map((l) => (lineKey(l) === key ? { ...l, quantity: qty } : l)).filter((l) => l.quantity > 0); saveCart(c); }
function cartClear() { saveCart([]); }
const getStore = () => { try { return localStorage.getItem(STORE_KEY) || ''; } catch (e) { return ''; } };
const setStore = (id) => { try { localStorage.setItem(STORE_KEY, id); } catch (e) { /* ignore */ } };
const getNote = () => { try { return localStorage.getItem(NOTE_KEY) || ''; } catch (e) { return ''; } };
const setNote = (t) => { try { localStorage.setItem(NOTE_KEY, t); } catch (e) { /* ignore */ } };

function updateCartBadge() {
  const n = cartCount();
  $$('[data-cart-badge]').forEach((el) => { el.textContent = n; el.classList.toggle('hidden', n === 0); });
}

const ROLE_TAG = { it_admin: 'IT-ADMIN', admin: 'ADMIN', finance: 'FINANCE' };
function renderHeader(active, { admin = false, role = '', user = null, hideNav = false } = {}) {
  const el = $('#site-head'); if (!el) return;
  const brand = admin
    ? `<a class="brand" href="${ADMIN_PATH}"><b>JIAN CHA Page</b>${role ? `<span class="tag">${ROLE_TAG[role] || role.toUpperCase()}</span>` : ''}</a>`
    : `<a class="brand" href="${H()}/"><b>JIANCHA x NAVORI</b></a>`;
  // Back-office menu: a hamburger button (top-right) that opens a stacked list of wide buttons, icon left + label centred.
  const mi = (view, icon, label) => `<a class="mi ${active === view ? 'on' : ''}" href="${ADMIN_PATH}?view=${view}">${icon}<span>${label}</span></a>`;
  const adminNav = () => {
    const items = [];
    // Home is the campaign page (/backend). Any menu or campaign adds query params, so offer Back whenever they exist.
    if (location.search.length > 1) items.push(`<a class="mi" href="${ADMIN_PATH}">${ICONS.arrowL}<span>Back</span></a>`);
    if (role === 'it_admin') items.push(mi('design', ICONS.brush, 'Design'));
    if (role === 'it_admin') items.push(mi('accounts', ICONS.user, 'Account'));
    items.push(mi('orders', ICONS.doc, 'Order'));
    items.push(mi('slips', ICONS.slip, 'Slip Issue'));
    items.push(mi('pickup', ICONS.store, 'Pick-up Order'));
    items.push(mi('customers', ICONS.customer, 'Customer'));
    if (user) items.push(`<button type="button" class="mi" id="logout" title="${esc(user.username)}">${ICONS.logout}<span>Logout</span></button>`);
    return `<nav class="nav burger" id="burger">
      <button type="button" class="burger-btn" id="burger-btn" aria-label="Menu" aria-haspopup="true" aria-expanded="false" aria-controls="burger-menu">${ICONS.menu}</button>
      <div class="burger-menu" id="burger-menu" hidden>${items.join('')}</div>
    </nav>`;
  };
  const nav = admin
    ? (role && !hideNav ? adminNav() : '')
    : `<nav class="nav">
        ${active === 'home' ? '' : `<a class="pill" href="${H()}/" aria-label="Back to homepage">${ICONS.arrowL} Back</a>`}
        <a class="pill" href="${H()}/cart">${ICONS.cart} Cart <span class="badge hidden" data-cart-badge></span></a>
        <a class="pill" href="${H()}/orders">${ICONS.doc} Order History</a>
        <a class="pill" href="${H()}/stores">${ICONS.store} JIANCHA Store Location</a>
        <span id="acct-slot" class="acct-slot"></span>
       </nav>`;
  el.innerHTML = brand + nav;
  const burger = $('#burger'), burgerBtn = $('#burger-btn'), burgerMenu = $('#burger-menu');
  el.classList.toggle('has-burger', Boolean(burger));
  if (burger) {
    const setOpen = (open) => { burger.classList.toggle('open', open); burgerMenu.hidden = !open; burgerBtn.setAttribute('aria-expanded', String(open)); };
    burgerBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(burgerMenu.hidden); });
    document.addEventListener('click', (e) => { if (!burger.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  }
  const lo = $('#logout'); if (lo) lo.addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); if (location.search.length > 1) location.href = ADMIN_PATH; else location.reload(); });
  updateCartBadge();
  if (!admin) loadMe().then(refreshAccountSlot);
}

/* menu lookup helpers: the menu is a list of Match Sets */
let _menu = null, _menuKey = null;
async function getMenu() { const k = campaignSlug(); if (!_menu || _menuKey !== k) { _menu = await api(withCampaign('/api/menu')); _menuKey = k; } return _menu; }
function menuMap(menu) { const m = {}; for (const s of menu.sets || []) m[s.id] = s; return m; }
function lineSet(line, map) { return map[line.set_id] || null; }
function linePrice(line, map) { const s = lineSet(line, map); return s ? s.price : 0; }
function lineName(line, map) { const s = lineSet(line, map); return s ? `${s.label} · ${s.name_en}` : line.set_id; }
function setItemsText(s) { return (s.items || []).map((i) => i.name_en + (i.name_th ? ` (${i.name_th})` : '')).join(', '); }

/* set card used on the cart page. editable = qty controls + remove */
function matchCard(line, map, { editable = true } = {}) {
  const s = lineSet(line, map); const key = lineKey(line);
  if (!s) return '';
  const qty = editable
    ? `<span class="qty"><button type="button" data-dec="${esc(key)}" aria-label="ลด">−</button>x${line.quantity}<button type="button" data-inc="${esc(key)}" aria-label="เพิ่ม">+</button></span>`
    : `<span>x${line.quantity}</span>`;
  return `<div class="match" data-key="${esc(key)}">
    ${editable ? `<button type="button" class="rm" data-rm="${esc(key)}" aria-label="ลบ">×</button>` : ''}
    <div class="thumbs">${s.image ? `<img class="ph" src="${esc(s.image)}" alt="">` : '<div class="ph"></div>'}<span class="set-tag">${esc(s.label)}</span></div>
    <div class="names"><span class="en">${esc(s.name_en)}</span><span class="th">${esc(s.name_th)}</span></div>
    <ul class="items">${(s.items || []).map((i) => `<li>${esc(i.name_en)}${i.name_th ? ` <span class="th">(${esc(i.name_th)})</span>` : ''}</li>`).join('')}</ul>
    <div class="foot">${qty}<span>${money(s.price * line.quantity)} ฿</span></div>
  </div>`;
}
function bindMatchControls(root, rerender, { getStock, errEl, map } = {}) {
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-inc],[data-dec],[data-rm]'); if (!t) return;
    const cur = loadCart();
    if (t.dataset.inc) {
      const l = cur.find((x) => lineKey(x) === t.dataset.inc);
      if (l) {
        const short = getStock && map ? stockCheck(getStock(), cur, setPieces(map[l.set_id]), map) : '';
        if (short) { if (errEl) errEl.textContent = short; return; }
        if (errEl) errEl.textContent = '';
        cartSetQty(t.dataset.inc, Math.min(99, l.quantity + 1));
      }
    }
    if (t.dataset.dec) { const l = cur.find((x) => lineKey(x) === t.dataset.dec); if (l) cartSetQty(t.dataset.dec, l.quantity - 1); }
    if (t.dataset.rm) cartSetQty(t.dataset.rm, 0);
    rerender();
  });
}

/* stock: each set reserves `pieces` (default 1) plus its drink / dessert item counts */
function setPieces(s, qty = 1) { return s ? { total: (s.pieces || 1) * qty, drink: (s.drink_pieces || 0) * qty, dessert: (s.dessert_pieces || 0) * qty } : { total: 0, drink: 0, dessert: 0 }; }
function cartPieces(cart, extra = {}, map = {}) {
  const w = { total: extra.total || 0, drink: extra.drink || 0, dessert: extra.dessert || 0 };
  for (const l of cart) { const p = setPieces(map[l.set_id], l.quantity); w.total += p.total; w.drink += p.drink; w.dessert += p.dessert; }
  return w;
}
/* '' when the cart (plus `extra` pieces) fits in the remaining stock, else a message */
function stockCheck(stock, cart, extra = {}, map = {}) {
  if (!stock || !stock.remaining) return '';
  const want = cartPieces(cart, extra, map); const label = { total: 'สินค้า', drink: 'เครื่องดื่ม', dessert: 'ของหวาน' };
  for (const k of ['total', 'drink', 'dessert']) {
    const r = stock.remaining[k]; if (r == null || want[k] <= r) continue;
    return r === 0 ? `${label[k]}หมดแล้ว / Sold out` : `${label[k]}เหลือเพียง ${r} ชุด / Only ${r} left`;
  }
  return '';
}
function stockPill(stock) {
  if (!stock || !stock.remaining) return '';
  if (stock.sold_out) return '<span class="note-pill sold"><b>สินค้าหมด</b> Sold out</span>';
  const parts = [];
  if (stock.remaining.total != null) parts.push(`เหลือ <b>${stock.remaining.total.toLocaleString('en-US')}</b> ชุด`);
  if (stock.remaining.drink != null) parts.push(`เครื่องดื่ม <b>${stock.remaining.drink.toLocaleString('en-US')}</b>`);
  if (stock.remaining.dessert != null) parts.push(`ของหวาน <b>${stock.remaining.dessert.toLocaleString('en-US')}</b>`);
  return parts.length ? `<span class="note-pill th">${parts.join(' · ')}</span>` : '';
}

/* pop-up (lightbox) for product images: click an image to view it large, close with ×, click outside, or Esc */
function openLightbox(src, alt = '') {
  let lb = $('#lightbox');
  if (!lb) {
    lb = document.createElement('div'); lb.id = 'lightbox'; lb.className = 'lightbox'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true');
    lb.innerHTML = '<button type="button" class="lb-close" aria-label="ปิด">×</button><img alt="">';
    document.body.appendChild(lb);
    const close = () => { lb.classList.remove('open'); document.body.classList.remove('lb-lock'); };
    lb.addEventListener('click', (e) => { if (e.target === lb || e.target.closest('.lb-close')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lb.classList.contains('open')) close(); });
  }
  const im = lb.querySelector('img'); im.style.width = ''; im.alt = alt;
  // รูปย่อยต้นฉบับเล็ก (115x105) ขยายให้ดูได้ 2.5 เท่า; รูปใหญ่ใช้ขนาดตาม CSS
  im.onload = () => { if (im.naturalWidth && im.naturalWidth < 400) im.style.width = Math.min(im.naturalWidth * 2.5, window.innerWidth * 0.92) + 'px'; };
  im.src = src;
  lb.classList.add('open'); document.body.classList.add('lb-lock');
}

/* homepage hero: the campaign's promote images (one image, or a slideshow when there are several) */
function renderHero(el, banners) {
  const list = (banners || []).filter(Boolean);
  if (window.__heroTimer) { clearInterval(window.__heroTimer); window.__heroTimer = null; }
  if (!el) return;
  if (!list.length) { el.className = 'hero ph'; el.innerHTML = ''; return; }
  el.className = 'hero slider';
  el.innerHTML = list.map((b, i) => `<img class="${i ? '' : 'on'}" src="${esc(b)}" alt="">`).join('') + (list.length > 1 ? `<div class="dots">${list.map((_, i) => `<button type="button" class="${i ? '' : 'on'}" data-dot="${i}" aria-label="รูปที่ ${i + 1}"></button>`).join('')}</div>` : '');
  if (list.length < 2) return;
  let cur = 0;
  const show = (i) => { cur = (i + list.length) % list.length; $$('img', el).forEach((im, k) => im.classList.toggle('on', k === cur)); $$('[data-dot]', el).forEach((d, k) => d.classList.toggle('on', k === cur)); };
  el.addEventListener('click', (e) => { const d = e.target.closest('[data-dot]'); if (d) { show(Number(d.dataset.dot)); clearInterval(window.__heroTimer); window.__heroTimer = setInterval(() => show(cur + 1), 4500); } });
  window.__heroTimer = setInterval(() => { if (!document.body.contains(el)) { clearInterval(window.__heroTimer); return; } show(cur + 1); }, 4500);
}

/* pick-up chips */
function storeChips(stores, selected) {
  return stores.map((s) => `<button type="button" class="pill ${s.id === selected ? 'on' : ''}" data-store="${esc(s.id)}"><b>${esc(s.brand)}</b>&nbsp;- ${esc(s.name)}</button>`).join('');
}

/* submit the cart as an order, then go to the payment page */
async function submitOrder({ storeId, note, errEl, btn, onFail }) {
  errEl.textContent = '';
  const lines = loadCart();
  if (!lines.length) { errEl.textContent = 'ยังไม่มีรายการในตะกร้า / Your cart is empty'; return; }
  if (!storeId) { errEl.textContent = 'กรุณาเลือกสาขาที่รับสินค้า / Please choose a pick-up location'; return; }
  await loadMe();
  if (needLogin()) { openLoginModal(() => submitOrder({ storeId, note, errEl, btn, onFail })); return; }  // ล็อกอินก่อน แล้วยืนยันต่อให้อัตโนมัติ
  btn.disabled = true;
  try {
    const order = await api('/api/orders', { method: 'POST', body: { store_id: storeId, note, lines, campaign: campaignSlug() || undefined } });
    cartClear(); setNote('');
    location.href = `${B()}/pay?order=${encodeURIComponent(order.id)}`;
  } catch (e) {
    btn.disabled = false;
    if (/HTTP 401|เข้าสู่ระบบ|sign in/i.test(e.message)) { await loadMe(true); refreshAccountSlot(); openLoginModal(() => submitOrder({ storeId, note, errEl, btn, onFail })); return; }
    errEl.textContent = e.message; if (onFail) onFail();
  }
}

const STATUS_LABEL = {
  pending: ['Awaiting payment', 'รอชำระเงิน'], slip_uploaded: ['Verifying slip', 'รอตรวจสอบสลิป'], paid: ['Approved', 'บัญชีตรวจสอบรายการคำสั่งซื้อเรียบร้อย'], slip_rejected: ['Slip rejected', 'สลิปไม่ผ่าน กรุณาอัปโหลดใหม่'],
  picked_up: ['Picked up', 'รับสินค้าแล้ว'], cancelled: ['Cancelled', 'ยกเลิก'],
};
const PRINTABLE = ['paid', 'picked_up']; // ใบรายการพิมพ์ได้เมื่อบัญชี approve แล้วเท่านั้น
function canPrint(o) { return PRINTABLE.includes(o && o.status); }
function statusPill(s) { const [en, th] = STATUS_LABEL[s] || [s, '']; return `<span class="status ${esc(s)}">${en}<span class="th">${th}</span></span>`; }
function fmtDateTime(v) { if (!v) return ''; const d = new Date(String(v).replace(' ', 'T')); if (isNaN(d)) return v; const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; }

/* an order line as text: "SET A · Menu Name" (sets) or "Drink + Dessert" (orders placed before sets existed) */
function orderLineName(l) { return l.name || (l.set_id ? `${l.set_label || l.set_id} · ${l.set_name || ''}` : [l.drink_name, l.dessert_name].filter(Boolean).join(' + ')); }
function orderLineItems(l) { return (l.items || []).map((i) => i.name_en).join(', '); }

/* expandable order card (customer + admin) */
function orderCard(o, { light = false, open = false, extra = '', badge = '', aside = '' } = {}) {
  const rows = o.lines.map((l) => {
    const items = orderLineItems(l);
    return `<tr><td>${esc(orderLineName(l))}${items ? `<br><small class="items-inline">${esc(items)}</small>` : ''}</td><td class="q">x ${l.quantity}</td><td class="p">${money(l.line_total)}</td></tr>`;
  }).join('');
  return `<div class="order" data-id="${esc(o.id)}">
    <button type="button" class="head ${light ? 'light' : ''}" aria-expanded="${open}">
      <span><span class="t">Order Number: ${esc(o.order_number)}</span> ${badge}<br><span class="s"><b>Pick-up Location:</b> ${esc(o.store_name.replace(/^JIAN CHA - /, ''))}</span></span>
      <span class="amt">${aside}${money(o.total)} ฿ ${open ? ICONS.down : ICONS.right}</span>
    </button>
    <div class="body ${open ? '' : 'hidden'}">
      <table>${rows}</table>
      ${o.customer_email ? `<div class="meta"><span>${ICONS.user} <b>${esc(o.customer_name || '')}</b> ${esc(o.customer_email)}</span></div>` : ''}
      ${o.note ? `<div class="meta"><span><b>หมายเหตุ:</b> ${esc(o.note)}</span></div>` : ''}
      <div class="meta"><span>${fmtDateTime(o.created_at)}</span>${statusPill(o.status)}${o.slip_reason && ['pending', 'slip_uploaded', 'slip_rejected'].includes(o.status) && o.has_slip ? `<span>${esc(o.slip_reason)}</span>` : ''}</div>
      ${extra}
    </div>
  </div>`;
}
/* POS promotion code: box when assigned, otherwise a button that fetches it */
function codeBox(o) {
  if (o.promo_code) {
    return `<span class="code-box"><span class="th">รหัสโปรโมชัน<br><small>Promotion code for POS</small></span><b>${esc(o.promo_code)}</b><button type="button" class="pill" data-copy="${esc(o.promo_code)}">Copy</button></span>`;
  }
  if (o.code_available) return `<button type="button" class="btn" data-get-code="${esc(o.id)}">${ICONS.ticket} รับ code</button>`;
  return '';
}
function bindCodeActions(root, onUpdated) {
  root.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { try { await navigator.clipboard.writeText(c.dataset.copy); c.textContent = 'Copied'; setTimeout(() => { c.textContent = 'Copy'; }, 1500); } catch (err) { /* ignore */ } return; }
    const b = e.target.closest('[data-get-code]'); if (!b) return;
    b.disabled = true;
    try { const r = await api('/api/orders/' + encodeURIComponent(b.dataset.getCode) + '/code', { method: 'POST' }); onUpdated(r.order); }
    catch (err) { alert(err.message); b.disabled = false; }
  });
}
function bindOrderToggles(root) {
  root.addEventListener('click', (e) => {
    const head = e.target.closest('.order > .head'); if (!head) return;
    const body = head.nextElementSibling; const open = body.classList.toggle('hidden');
    head.setAttribute('aria-expanded', String(!open));
    const svg = head.querySelector('.amt svg.ic:last-child'); if (svg) svg.outerHTML = open ? ICONS.right : ICONS.down;
  });
}
