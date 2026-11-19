/* Cloudflare Pages worker: API + uploads + page routing; everything else is a static asset from public/ */
import { ensureSchema } from './schema.js';
import { maybeScheduledReset } from './reset.js';
import { makeContext, withCookies, handleApi, serveSlip, serveDesign, campaignBySlug, campaignHome } from './api.js';

const CAMPAIGN_PAGES = { '': 'home', cart: 'cart', orders: 'orders', stores: 'stores', pay: 'pay', receipt: 'receipt' };
const NO_CACHE = { 'cache-control': 'no-cache' };
const redirect = (to) => new Response(null, { status: 301, headers: { location: to, ...NO_CACHE } });
/** Serve a page from public/ (built into the site as <name>.html) at the requested URL, following the asset server's own redirects */
async function page(env, url, name) {
  let target = new URL(`/${name}.html`, url.origin);
  for (let i = 0; i < 3; i++) {
    const r = await env.ASSETS.fetch(new Request(target, { headers: { accept: 'text/html' } }));
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { target = new URL(r.headers.get('location'), target); continue; }
    if (!r.ok) return r;
    return new Response(r.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...NO_CACHE } });
  }
  return new Response('not found', { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url); const p = url.pathname;
    // static files never touch the database
    if (/^\/(css|js|img|fonts)\//.test(p) || (!p.startsWith('/uploads/') && /\.(css|js|png|jpg|jpeg|webp|svg|ico|ttf|woff2?|txt|xml)$/i.test(p))) return env.ASSETS.fetch(request);
    if (!env.DB) return new Response('Cloudflare Pages: bind a D1 database as "DB" (Settings → Bindings). Optional: an R2 bucket as "FILES" for slip images; without it images are stored in D1.', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    await ensureSchema(env);
    await maybeScheduledReset(env);   // RESET_ORDERS_AT: ล้างออเดอร์ทดสอบอัตโนมัติครั้งเดียวเมื่อถึงเวลา
    const c = await makeContext(request, env, ctx);
    let res;
    if (p === '/api' || p.startsWith('/api/')) res = await handleApi(c);
    else if (/^\/uploads\/design\/[A-Za-z0-9._-]+$/.test(p)) res = await serveDesign(c, p.split('/').pop());
    else if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(p)) res = await serveSlip(c, p.split('/').pop());
    else if (p === '/backend' || p === '/backend/') res = await page(env, url, 'admin-page');   // หลังบ้าน JIANCHA Page
    else if (p === '/admin-page' || p === '/admin-page/') res = redirect(`/backend${url.search}`);   // ลิงก์เก่า
    else if (p === '/') res = await page(env, url, 'landing');   // "Order with us" -> active campaign page
    else if (p === '/index' || p === '/index.html') res = await page(env, url, 'home');
    else {
      // Campaign pages: order.jianchatea.com/<slug>/ shows that campaign (and /<slug>/cart, /orders, /stores, /pay, /receipt)
      const m = p.match(/^\/([A-Za-z0-9-]+)(?:\/([a-z]*))?$/);
      const pg = m ? CAMPAIGN_PAGES[m[2] || ''] : undefined;
      const camp = m && pg !== undefined && !['backend', 'admin-page', 'cart', 'orders', 'stores', 'pay', 'receipt', 'landing', 'home', 'membership'].includes(m[1]) ? await campaignBySlug(c.db, m[1]) : null;
      if (camp) {
        if (m[2] === undefined) res = redirect(`/${m[1]}/${url.search}`);
        else res = await page(env, url, pg === 'home' && campaignHome(camp) === 'membership' ? 'membership' : pg);   // หน้าแรกแบบ Membership → ฟอร์มสมัครสมาชิก
      } else res = await env.ASSETS.fetch(request);
    }
    return withCookies(res, c);
  },
};
