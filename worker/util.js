/* Cloudflare worker helpers: JSON responses, cookies, HMAC tokens, PBKDF2 passwords, D1 wrappers */
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
export class HttpError extends Error { constructor(status, body) { super(typeof body === 'string' ? body : (body && body.error) || 'error'); this.status = status; this.body = typeof body === 'string' ? { error: body } : body; } }
export const fail = (status, body) => { throw new HttpError(status, body); };

// ─── bytes / encoding ───
const enc = new TextEncoder();
export function b64url(bytes) { let s = ''; const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function unb64url(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
export const b64 = (bytes) => { let s = ''; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
export const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
export const uuid = () => crypto.randomUUID();
export function randomInt(n) { const max = Math.floor(0xffffffff / n) * n; let r; do { r = crypto.getRandomValues(new Uint32Array(1))[0]; } while (r >= max); return r % n; }
export const sha256hex = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));

// ─── HMAC tokens (cookies) ───
const keyCache = new Map();
async function hmacKey(secret) {
  if (!keyCache.has(secret)) keyCache.set(secret, await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
  return keyCache.get(secret);
}
export async function signToken(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return body + '.' + b64url(sig);
}
export async function verifyToken(token, secret) {
  try {
    const [body, sig] = String(token || '').split('.'); if (!body || !sig) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(body)); if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (p.exp && p.exp * 1000 < Date.now()) return null;
    return p;
  } catch (e) { return null; }
}

// ─── passwords: PBKDF2-SHA256 (Web Crypto) ───
const PBKDF2_ITER = 20000;
export async function hashPassword(password, iter = PBKDF2_ITER) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return `pbkdf2$${iter}$${b64url(salt)}$${b64url(bits)}`;
}
export async function checkPassword(password, stored) {
  try {
    const [algo, iterS, saltS, hashS] = String(stored || '').split('$'); if (algo !== 'pbkdf2') return false;
    const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64url(saltS), iterations: parseInt(iterS, 10) }, key, 256));
    const want = unb64url(hashS); if (want.length !== bits.length) return false;
    let diff = 0; for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ want[i];
    return diff === 0;
  } catch (e) { return false; }
}

// ─── cookies ───
export function parseCookies(req) {
  const out = {}; for (const part of (req.headers.get('cookie') || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
export function cookie(name, value, { maxAge, secure = true, path = '/' } = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax`;
  if (secure) s += '; Secure';
  if (maxAge != null) s += `; Max-Age=${maxAge}`;
  return s;
}

// ─── D1 ───
const clean = (args) => args.map((a) => (a === undefined ? null : (typeof a === 'boolean' ? (a ? 1 : 0) : a)));
export function sql(env) {
  const D = env.DB;
  return {
    get: (q, ...args) => D.prepare(q).bind(...clean(args)).first(),
    all: async (q, ...args) => (await D.prepare(q).bind(...clean(args)).all()).results,
    run: (q, ...args) => D.prepare(q).bind(...clean(args)).run(),
    stmt: (q, ...args) => D.prepare(q).bind(...clean(args)),
    batch: (stmts) => D.batch(stmts),
  };
}
