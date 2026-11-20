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
    <p><b>สถานที่รับของ / Pick-up:</b> <img src="${logo('logo-jiancha')}" alt="JIANCHA" height="16" style="height:16px;vertical-align:-2px"> - ${th(String(o.store_name || '').replace(/^(JIANCHA|JIAN CHA)\s*-\s*/i, ''))}${pick ? `<br><b>วัน-เวลารับของ / Pick-up date &amp; time:</b> ${th(pick)}` : ''}${o.phone ? `<br><b>เบอร์ติดต่อ:</b> ${th(o.phone)}` : ''}${o.note ? `<br><b>หมายเหตุ:</b> ${th(o.note)}` : ''}</p>
    ${codeLine}
    <div style="margin:14px 0;padding:12px 16px;border:1px solid #ddd;border-radius:12px;background:#faf7f2;font-size:16px;line-height:1.5"><b>หมายเหตุการรับสินค้า</b><br>เนื่องจากสินค้ามีอายุการเก็บรักษาสั้น และเป็นสินค้าที่จัดเตรียมตามจำนวนการสั่งจอง เพื่อให้ลูกค้าได้รับสินค้าที่สดใหม่และคุณภาพดีที่สุด ขอความกรุณารับสินค้าตามวันที่และเวลาที่เลือกไว้<br><b style="color:#b00020">กรณีลูกค้าไม่มารับสินค้าตามกำหนด ทางร้านขอสงวนสิทธิ์ไม่คืนเงินทุกกรณี</b></div>
    <p>กรุณาแสดงอีเมลนี้หรือหน้า Order History ที่หน้าร้านในวันรับของ${link ? ` <a href="${th(link)}">${th(link)}</a>` : ''}<br>Please show this email or your Order History page at the store on pick-up day.</p>
    <p style="color:#444">ขอบคุณที่มาสั่งซื้อกับเรา / Thank you for ordering with us.<br><img src="${logo('logo-jiancha')}" alt="JIANCHA" height="20" style="height:20px;vertical-align:middle">${isNavori ? ` <span style="vertical-align:middle">x</span> <img src="${logo('logo-navori')}" alt="NAVORI" height="20" style="height:20px;vertical-align:middle">` : ''}</p></div>`;
  const text = `ยืนยันคำสั่งซื้อ ${o.order_number} อนุมัติเรียบร้อยแล้ว\n` + o.lines.map((l) => `- ${l.name} x${l.quantity} = ${money(l.line_total)} ฿`).join('\n') + `\nยอดรวม ${money(o.total)} ฿\nรับของที่ ${o.store_name}${pick ? ' ' + pick : ''}${o.promo_code ? '\nรหัสโปรโมชัน POS: ' + o.promo_code : ''}${link ? '\n' + link : ''}` + `\n\nหมายเหตุการรับสินค้า\nเนื่องจากสินค้ามีอายุการเก็บรักษาสั้น และเป็นสินค้าที่จัดเตรียมตามจำนวนการสั่งจอง เพื่อให้ลูกค้าได้รับสินค้าที่สดใหม่และคุณภาพดีที่สุด ขอความกรุณารับสินค้าตามวันที่และเวลาที่เลือกไว้\nกรณีลูกค้าไม่มารับสินค้าตามกำหนด ทางร้านขอสงวนสิทธิ์ไม่คืนเงินทุกกรณี`;
  return { subject: `ยืนยันคำสั่งซื้อ ${o.order_number} อนุมัติแล้ว / Order confirmed – ${c ? c.name : 'JIANCHA'}`, html, text, attachments };
}
/* อีเมลแจ้งทีม (marketing) เมื่อบัญชีกด Reject สลิป → ออเดอร์เป็น On Issue ให้เข้าไปตรวจสอบ
 *  o = orderView(order) (มี email/phone/slip_reason), c = campaign, baseUrl = เว็บจริง, opts.by = ชื่อผู้กด, opts.reason */
function issueEmail(o, c, baseUrl, { by = '', reason = '' } = {}) {
  const th = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const why = reason || o.slip_reason || '';
  const link = baseUrl ? `${baseUrl}/backend?view=slips` : '';
  const items = (o.lines || []).map((l) => `${l.name || l.set_name || ''} x${l.quantity}`).join(', ');
  const html = `<div style="font-family:Arial,'Noto Sans Thai',sans-serif;font-size:15px;line-height:1.5;max-width:600px;margin:0 auto;color:#000">
    <p style="font-size:18px;margin:0 0 12px"><b>ออเดอร์มีปัญหา (On Issue) / Order needs attention</b></p>
    <p>บัญชี${by ? ` (${th(by)})` : ''}กด <b>Reject</b> สลิปของออเดอร์ <b>${th(o.order_number)}</b>${c ? ` แคมเปญ ${th(c.name)}` : ''} กรุณาตรวจสอบและติดต่อลูกค้า</p>
    <table style="border-collapse:collapse"><tbody>
      <tr><td style="padding:4px 12px 4px 0"><b>เหตุผล / Reason</b></td><td style="padding:4px 0;color:#b00020"><b>${th(why || '-')}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0"><b>ยอด / Total</b></td><td style="padding:4px 0">${money(o.total)} ฿</td></tr>
      <tr><td style="padding:4px 12px 4px 0"><b>รายการ / Items</b></td><td style="padding:4px 0">${th(items)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0"><b>สถานที่รับ / Pick-up</b></td><td style="padding:4px 0">${th(o.store_name)}${o.pickup_date ? ` · ${th(o.pickup_date)}` : ''}${o.pickup_time ? ` ${th(o.pickup_time)}` : ''}</td></tr>
      <tr><td style="padding:4px 12px 4px 0"><b>เบอร์ลูกค้า / Phone</b></td><td style="padding:4px 0">${th(o.phone || '-')}</td></tr>
      <tr><td style="padding:4px 12px 4px 0"><b>อีเมลลูกค้า / Email</b></td><td style="padding:4px 0">${th(o.email || o.customer_email || '-')}</td></tr>
    </tbody></table>
    ${link ? `<p><a href="${th(link)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px">เปิดหลังบ้าน (Slip issues)</a></p>` : ''}
    <p style="color:#666;font-size:13px">ลูกค้าเห็นสถานะ "สลิปไม่ผ่าน กรุณาอัปโหลดใหม่" และอัปโหลดสลิปใหม่ได้จากหน้า Order History</p></div>`;
  const text = `ออเดอร์ ${o.order_number} ถูก Reject สลิป (On Issue)\nเหตุผล: ${why || '-'}\nยอด: ${money(o.total)} ฿\nรายการ: ${items}\nเบอร์: ${o.phone || '-'} อีเมล: ${o.email || o.customer_email || '-'}${link ? `\n${link}` : ''}`;
  return { subject: `[On Issue] ออเดอร์ ${o.order_number} สลิปไม่ผ่าน${why ? ' – ' + why : ''}`, html, text, attachments: [] };
}
/* อีเมลถึงลูกค้าเมื่อบัญชี Reject สลิป: เหตุผล + ปุ่มอัปโหลดสลิปใหม่ + QR LINE OA ไว้คุยกับทีมการตลาด
 *  opts.reason, opts.lineQr (URL รูป QR), opts.lineUrl (ลิงก์ LINE OA) */
function rejectEmail(o, c, baseUrl, { reason = '', lineQr = '', lineUrl = '' } = {}) {
  const th = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const why = reason || o.slip_reason || 'สลิปไม่ถูกต้อง';
  const slug = c && c.slug ? `/${c.slug}` : '';
  const link = baseUrl ? `${baseUrl}${slug}/orders` : '';
  const items = (o.lines || []).map((l) => `${l.name || l.set_name || ''} x${l.quantity}`).join(', ');
  const lineBlock = (lineQr || lineUrl) ? `<div style="margin:18px 0;padding:14px 16px;border:1px solid #ddd;border-radius:12px;text-align:center">
      <b>มีข้อสงสัยหรือต้องการความช่วยเหลือ ติดต่อทีมงานผ่าน LINE</b><br><span style="color:#444;font-size:14px">Need help? Chat with our team on LINE</span><br>
      ${lineQr ? `<img src="${th(lineQr)}" alt="LINE QR" width="180" height="180" style="width:180px;height:180px;margin:10px auto 4px;display:block">` : ''}
      ${lineUrl ? `<a href="${th(lineUrl)}" style="display:inline-block;margin-top:6px;background:#06c755;color:#fff;text-decoration:none;padding:9px 18px;border-radius:999px;font-weight:700">เพิ่มเพื่อน LINE / Add LINE</a>` : ''}</div>` : '';
  const html = `<div style="font-family:Arial,'Noto Sans Thai',sans-serif;font-size:16px;line-height:1.5;max-width:600px;margin:0 auto;color:#000">
    <p style="font-size:20px;margin:0 0 12px"><b>สลิปไม่ผ่านการตรวจสอบ กรุณาอัปโหลดใหม่ / Payment slip rejected</b></p>
    <p>คำสั่งซื้อหมายเลข <b>${th(o.order_number)}</b>${c ? ` (${th(c.name)})` : ''} ยังไม่สามารถอนุมัติได้ เนื่องจาก</p>
    <p style="padding:12px 16px;background:#fff3f3;border:1px solid #f3c2c2;border-radius:12px;color:#b00020"><b>เหตุผล / Reason: ${th(why)}</b></p>
    <p style="color:#444;font-size:14px">รายการ / Items: ${th(items)}<br>ยอดที่ต้องชำระ / Amount: <b>${money(o.total)} ฿</b></p>
    <p>กรุณาตรวจสอบยอดโอนและอัปโหลดสลิปที่ถูกต้องอีกครั้งที่หน้า Order History (จากเบราว์เซอร์/มือถือเครื่องที่ใช้สั่งซื้อ) เพื่อให้เจ้าหน้าที่ตรวจสอบและอนุมัติ<br><span style="color:#444;font-size:14px">Please check the transfer amount and upload the correct slip again from Order History on the device you ordered from.</span></p>
    ${link ? `<p><a href="${th(link)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:700">อัปโหลดสลิปใหม่ / Upload new slip</a></p>` : ''}
    ${lineBlock}
    <p style="color:#444;font-size:14px">คิวของท่านยังถูกเก็บไว้จนกว่าจะอัปโหลดสลิปใหม่หรือคำสั่งซื้อถูกยกเลิก / Your sets remain reserved until you re-upload or the order is cancelled.</p></div>`;
  const text = `สลิปไม่ผ่านการตรวจสอบ กรุณาอัปโหลดใหม่\nคำสั่งซื้อ ${o.order_number}\nเหตุผล: ${why}\nยอดที่ต้องชำระ: ${money(o.total)} ฿${link ? `\nอัปโหลดสลิปใหม่: ${link}` : ''}${lineUrl ? `\nติดต่อทีมงานผ่าน LINE: ${lineUrl}` : ''}`;
  return { subject: `สลิปไม่ผ่าน กรุณาอัปโหลดใหม่ – ออเดอร์ ${o.order_number} / Slip rejected`, html, text, attachments: [] };
}
/* อีเมลรหัสรับของสมาชิก — ส่งทุกครั้งที่สมาชิกเลือกวันที่รับของ (สมัคร / เปลี่ยนวัน)
 *  m = แถว members (first_name, last_name, pickup_code, pickup_date, store_name), c = campaign, baseUrl = เว็บจริง
 *  opts.changed = เปลี่ยนวันที่รับของ, opts.left = สิทธิ์เปลี่ยนวันที่เหลือ */
function memberCodeEmail(m, c, baseUrl, { changed = false, left = 0 } = {}) {
  const th = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const FONT = "'DB HelvethaicaX','DB Helvethaica X',Arial,'Noto Sans Thai',sans-serif";
  const date = m.pickup_date ? `${fmtDayTH(m.pickup_date)} / ${fmtDayEN(m.pickup_date)}` : '-';
  const store = String(m.store_name || '').replace(/^(JIANCHA|JIAN CHA)\s*-\s*/i, '');
  const link = baseUrl && c ? `${baseUrl}/${c.slug}/` : '';
  const logo = baseUrl ? `<img src="${baseUrl}/img/logo-jiancha.png" alt="JIANCHA" height="28" style="height:28px;vertical-align:middle">` : '<b style="font-size:26px">JIANCHA</b>';
  const head = changed ? 'เปลี่ยนวันที่รับของเรียบร้อย / Pick-up date changed' : 'สมัครสมาชิกเรียบร้อย / Membership confirmed';
  const html = `<div style="font-family:${FONT};font-size:19px;line-height:1.4;max-width:600px;margin:0 auto;color:#000">
    <div style="margin:0 0 6px">${logo}<span style="font-size:24px;font-weight:700;vertical-align:middle;margin-left:10px">Membership</span></div>
    <p style="margin:0 0 16px;color:#444;font-size:17px">${head}</p>
    <p>เรียนคุณ ${th(m.first_name)} ${th(m.last_name)}<br>นี่คือรหัสรับของของคุณ กรุณาแสดงรหัสนี้ที่หน้าร้านในวันรับของ<br>Here is your pick-up code. Please show it at the store on your pick-up date.</p>
    <div style="margin:18px 0;padding:18px;border:2px solid #000;border-radius:16px;text-align:center;background:#fffdf8">
      <div style="font-size:15px;color:#555">รหัสรับของ / Pick-up code</div>
      <div style="font-size:36px;font-weight:700;font-family:monospace,${FONT};letter-spacing:3px;margin-top:4px">${th(m.pickup_code)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:17px">
      <tr><td style="padding:6px 0;color:#555;width:170px">วันที่รับของ / Date</td><td style="padding:6px 0"><b>${th(date)}</b></td></tr>
      <tr><td style="padding:6px 0;color:#555">สถานที่ / Location</td><td style="padding:6px 0"><b>JIANCHA - ${th(store)}</b></td></tr>
      <tr><td style="padding:6px 0;color:#555">เบอร์โทร / Tel</td><td style="padding:6px 0">${th(m.phone)}</td></tr>
    </table>
    <p style="font-size:15px;color:#444">${left > 0 ? `เปลี่ยนวันที่รับของได้อีก ${left} ครั้ง ที่${link ? ` <a href="${th(link)}">${th(link)}</a>` : 'หน้าสมัครสมาชิก'} / You can change your pick-up date ${left} more time.` : 'ใช้สิทธิ์เปลี่ยนวันที่รับของครบแล้ว / Your pick-up date can no longer be changed.'}</p>
    <p style="font-size:15px;color:#444">สอบถามเพิ่มเติม Line OA <a href="https://page.line.me/jiancha">@jiancha</a></p></div>`;
  const text = `${head}\nรหัสรับของ / Pick-up code: ${m.pickup_code}\nวันที่รับของ: ${date}\nสถานที่: JIANCHA - ${store}\n${left > 0 ? `เปลี่ยนวันที่รับของได้อีก ${left} ครั้ง${link ? ' ' + link : ''}` : 'ใช้สิทธิ์เปลี่ยนวันที่รับของครบแล้ว'}\nLine OA @jiancha`;
  return { subject: `รหัสรับของ ${m.pickup_code} · ${changed ? 'เปลี่ยนวันที่รับของ' : 'JIANCHA Membership'} – ${m.pickup_date ? fmtDayEN(m.pickup_date) : ''}`, html, text };
}
/* อีเมลที่ลูกค้ากรอกตอนสั่งซื้อ: ตัดช่องว่าง/ตัวพิมพ์ใหญ่ แล้วตรวจรูปแบบ (name@domain.tld) */
const normalizeEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 120);
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
module.exports = { memberCodeEmail, approvalEmail, issueEmail, rejectEmail, normalizeEmail, validEmail };
