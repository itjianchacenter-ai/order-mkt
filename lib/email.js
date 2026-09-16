/* อีเมลยืนยันการอนุมัติ (เนื้อหา) — pure; ผู้เรียกเลือกว่าโลโก้แนบเป็น cid (SMTP) หรือลิงก์รูปบนเว็บ (Cloudflare) */
const { fmtDayTH, fmtDayEN } = require('./window');
/** o = orderView(order), c = campaign row (or null), baseUrl = https://order.jianchatea.com ('' = no links)
 *  opts.logos: 'cid' (attachments logo-jiancha / logo-navori) | 'url' (baseUrl/img/…) */
function approvalEmail(o, c, baseUrl, { logos = 'cid' } = {}) {
  const th = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // ฟอนต์ DB Helvethaica X จากเว็บ (ไคลเอนต์ที่รองรับ @font-face เช่น Apple Mail จะใช้ ที่เหลือใช้ Arial)
  const fontCss = baseUrl ? ['Regular:400', 'Medium:500', 'Bold:700'].map((f) => { const [n, w] = f.split(':'); return `@font-face{font-family:'DB HelvethaicaX';font-weight:${w};src:url('${baseUrl}/fonts/DBHelvethaicaX-${n}.ttf') format('truetype')}`; }).join('') : '';
  const FONT = "'DB HelvethaicaX','DB Helvethaica X',Arial,'Noto Sans Thai',sans-serif";
  const logo = (name) => (logos === 'cid' ? `cid:${name}` : `${baseUrl}/img/${name}.png`);
  const attachments = logos === 'cid' ? [{ filename: 'logo-jiancha.png', name: 'logo-jiancha', cid: 'logo-jiancha' }, { filename: 'logo-navori.png', name: 'logo-navori', cid: 'logo-navori' }] : [];
  const isNavori = !c || /navori/i.test(c.name || '');
  const header = isNavori
    ? `<div style="margin:0 0 6px"><img src="${logo('logo-jiancha')}" alt="JIANCHA" height="28" style="height:28px;vertical-align:middle"> <span style="font-size:22px;vertical-align:middle;margin:0 8px">x</span> <img src="${logo('logo-navori')}" alt="NAVORI" height="28" style="height:28px;vertical-align:middle"></div>`
    : `<div style="margin:0 0 6px"><img src="${logo('logo-jiancha')}" alt="JIANCHA" height="28" style="height:28px;vertical-align:middle"><span style="font-size:22px;font-weight:700;vertical-align:middle;margin-left:10px">${th(c.name)}</span></div>`;
  const rows = o.lines.map((l) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #ddd">${th(l.name)}${l.items && l.items.length ? `<br><small style="color:#666">${th(l.items.map((i) => i.name_en).join(', '))}</small>` : ''}</td><td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:center">x ${l.quantity}</td><td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right">${money(l.line_total)} ฿</td></tr>`).join('');
  const link = baseUrl ? `${baseUrl}/${c ? c.slug + '/' : ''}orders` : '';
  const codeLine = o.promo_code ? `<p><b>รหัสโปรโมชันสำหรับ POS / Promotion code:</b> <span style="font-size:24px;font-family:monospace;letter-spacing:1px">${th(o.promo_code)}</span><br><small style="color:#444">แสดงรหัสนี้ที่หน้าร้านในวันรับของ / Show this code at the store on pick-up day.</small></p>` : '';
  const pick = [o.pickup_date ? `${fmtDayTH(o.pickup_date)} (${fmtDayEN(o.pickup_date)})` : '', o.pickup_time || ''].filter(Boolean).join(' · ');
  const html = `${fontCss ? `<style>${fontCss}</style>` : ''}<div style="font-family:${FONT};font-size:20px;line-height:1.35;max-width:600px;margin:0 auto;color:#000">
    ${header}
    <p style="margin:0 0 16px;color:#444;font-size:18px">ยืนยันคำสั่งซื้อ / Order confirmed</p>
    <p>คำสั่งซื้อหมายเลข <b>${th(o.order_number)}</b> ของคุณได้รับการตรวจสอบยอดโอนและ<b>อนุมัติเรียบร้อยแล้ว</b><br>Your payment has been verified and your order is confirmed.</p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0"><thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #000">รายการ / Item</th><th style="padding:6px 8px;border-bottom:2px solid #000">จำนวน</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #000">ราคา</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><td colspan="2" style="padding:8px;text-align:right"><b>ยอดรวม / Total</b></td><td style="padding:8px;text-align:right"><b>${money(o.total)} ฿</b></td></tr></tfoot></table>
    <p><b>สถานที่รับของ / Pick-up:</b> ${th(o.store_name)}${pick ? `<br><b>วัน-เวลารับของ / Pick-up date &amp; time:</b> ${th(pick)}` : ''}${o.phone ? `<br><b>เบอร์ติดต่อ:</b> ${th(o.phone)}` : ''}${o.note ? `<br><b>หมายเหตุ:</b> ${th(o.note)}` : ''}</p>
    ${codeLine}
    <p>กรุณาแสดงอีเมลนี้หรือหน้า Order History ที่หน้าร้านในวันรับของ${link ? ` <a href="${th(link)}">${th(link)}</a>` : ''}<br>Please show this email or your Order History page at the store on pick-up day.</p>
    <p style="color:#444">ขอบคุณที่มาสั่งซื้อกับเรา / Thank you for ordering with us.<br><img src="${logo('logo-jiancha')}" alt="JIANCHA" height="20" style="height:20px;vertical-align:middle">${isNavori ? ` <span style="vertical-align:middle">x</span> <img src="${logo('logo-navori')}" alt="NAVORI" height="20" style="height:20px;vertical-align:middle">` : ''}</p></div>`;
  const text = `ยืนยันคำสั่งซื้อ ${o.order_number} อนุมัติเรียบร้อยแล้ว\n` + o.lines.map((l) => `- ${l.name} x${l.quantity} = ${money(l.line_total)} ฿`).join('\n') + `\nยอดรวม ${money(o.total)} ฿\nรับของที่ ${o.store_name}${pick ? ' ' + pick : ''}${o.promo_code ? '\nรหัสโปรโมชัน POS: ' + o.promo_code : ''}${link ? '\n' + link : ''}`;
  return { subject: `ยืนยันคำสั่งซื้อ ${o.order_number} อนุมัติแล้ว / Order confirmed – ${c ? c.name : 'JIANCHA'}`, html, text, attachments };
}
/* อีเมลที่ลูกค้ากรอกตอนสั่งซื้อ: ตัดช่องว่าง/ตัวพิมพ์ใหญ่ แล้วตรวจรูปแบบ (name@domain.tld) */
const normalizeEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 120);
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
module.exports = { approvalEmail, normalizeEmail, validEmail };
