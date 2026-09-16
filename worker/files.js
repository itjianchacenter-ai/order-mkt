/* File storage for slips and design images: R2 bucket bound as FILES when available, otherwise a BLOB table in D1
   (free, no payment method needed; keep files small — pay.html and the Design page downscale images before upload). */
export const D1_FILE_MAX = 1.5 * 1024 * 1024;   // ต่อไฟล์เมื่อเก็บใน D1 (คอลัมน์ D1 จำกัด ~2 MB)
export const usingR2 = (env) => Boolean(env.FILES);
export const fileMax = (env) => (usingR2(env) ? 8 * 1024 * 1024 : D1_FILE_MAX);
export async function putFile(env, key, bytes, type, now) {
  if (env.FILES) return env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
  await env.DB.prepare('INSERT OR REPLACE INTO files(key, type, size, data, created_at) VALUES (?, ?, ?, ?, ?)').bind(key, type, bytes.byteLength, bytes, now).run();
}
/** → { body, type } or null */
export async function getFile(env, key) {
  if (env.FILES) { const o = await env.FILES.get(key); return o ? { body: o.body, type: o.httpMetadata?.contentType || '' } : null; }
  const r = await env.DB.prepare('SELECT type, data FROM files WHERE key = ?').bind(key).first();
  if (!r) return null;
  const data = r.data instanceof ArrayBuffer || ArrayBuffer.isView(r.data) ? r.data : Uint8Array.from(r.data || []);
  return { body: data, type: r.type || '' };
}
export async function deleteFile(env, key) {
  try { if (env.FILES) await env.FILES.delete(key); else await env.DB.prepare('DELETE FROM files WHERE key = ?').bind(key).run(); } catch (e) { /* best effort */ }
}
