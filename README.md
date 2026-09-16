# JIANCHA x NAVORI — เว็บสั่งซื้อล่วงหน้า (order.jianchatea.com)

เว็บสั่งสินค้าตามแคมเปญ ลูกค้าเลือกเครื่องดื่ม + ของหวาน จับคู่เป็น "Your Match" เลือกสาขาที่รับของ ชำระเงินผ่าน PromptPay QR แล้วอัปโหลดสลิป ฝ่ายหลังบ้านตรวจสอบและติดตามคำสั่งซื้อได้ที่ `/backend/`

ระบบนี้เป็นแอปแยกเดี่ยว ไม่เชื่อมกับระบบอื่น (repo: `itjianchacenter-ai/order-mkt`)

- **ระบบจริง (Cloudflare Pages + D1 + R2):** https://order.jianchatea.com — โค้ดเดียวกันรันเป็น worker บน Cloudflare (`worker/`) ฐานข้อมูลกลาง (ลูกค้าทุกคนที่ล็อกอิน, ออเดอร์, โควตา 200/วัน, สลิป) ดูวิธีตั้งค่าที่หัวข้อ **ขึ้นระบบจริงบน Cloudflare Pages**
- **Preview (GitHub Pages):** https://itjianchacenter-ai.github.io/order-mkt/ — เวอร์ชันไม่มีเซิร์ฟเวอร์ ข้อมูลอยู่ในเบราว์เซอร์ build อัตโนมัติจาก `.github/workflows/pages.yml` ทุกครั้งที่ push ขึ้น `main`
- แถบ PREVIEW สีดำ (ข้อมูลทดลอง + บัญชีหลังบ้าน + ปุ่มรีเซ็ต) แสดงเฉพาะหน้าหลังบ้าน `/backend/` หน้าลูกค้า (`/`, `/<แคมเปญ>/`) ไม่แสดง

## หน้าเว็บ

| URL | หน้า |
|---|---|
| `/` | หน้าทางเข้า: ปุ่ม "Order with us" พาไปหน้าแคมเปญที่ Active (`/<ลิงก์แคมเปญ>/`) |
| `/<ลิงก์แคมเปญ>/` | หน้าแรกของแคมเปญ: แบนเนอร์, Match Sets, สาขารับของ, สรุปคำสั่งซื้อ, Confirm |
| (หน้าแคมเปญ) **Pick-up Date** | ปุ่มเลือกวันที่รับของ (อังกฤษ + ไทย พ.ศ.) จาก `pickup_dates` ของแคมเปญ (แม่แบบ `data/menu.json`: 25–28 กันยายน 2026) บังคับเลือกก่อน Confirm — server ปฏิเสธออเดอร์ที่ไม่มีวันที่หรือวันที่ไม่อยู่ในรายการ (`orders.pickup_date`) แสดงใน Order Summary, การ์ดออเดอร์ (ลูกค้าและหลังบ้าน) และใบรายการ |
| (หน้าแคมเปญ) **Pick-up Time** | ปุ่มเลือกช่วงเวลารับของจาก `pickup_times` ของแคมเปญ (แม่แบบ: 10:00-11:00 น. / 13:00-15:00 น. / 17:00-20:00 น.) บังคับเลือกก่อน Confirm — server ปฏิเสธออเดอร์ที่ไม่มีเวลาหรือเวลานอกรายการ (`orders.pickup_time`) แสดงใน Order Summary, การ์ดออเดอร์ และใบรายการ |
| `/cart` | ตะกร้า: Match Sets (รูปรายการในเซ็ต), Cart Summary, ช่อง Contact number เบอร์ติดต่อผู้รับขนม (บังคับ: server ไม่รับออเดอร์ที่ไม่มีเบอร์; หน้าแคมเปญก็มีช่องนี้), Confirm — สาขารับของเลือกที่หน้าแคมเปญ |
| `/pay?order=…` | ชำระเงิน: QR PromptPay ตามยอด + อัปโหลดสลิป |
| `/orders` | ประวัติการสั่งซื้อ (กดรายการเพื่อดูรายละเอียด; ปุ่ม Print พิมพ์ใบรายการจะขึ้นเมื่อสถานะ Approved แล้วเท่านั้น) |
| `/receipt?order=…` | ใบรายการสั่งซื้อแบบพิมพ์ได้ (ลูกค้าเจ้าของออเดอร์และ admin เปิดได้) |
| `/stores` | สาขาที่รับสินค้า + ปุ่ม Google Map (ไม่มีปุ่มในหัวเว็บแล้ว เปิดได้จาก URL ตรง) |
| `/backend/` | หลังบ้าน (หัวเว็บเป็นโลโก้ JIANCHA + ป้ายบทบาท) แยกสิทธิ์ 3 บทบาท (ดูหัวข้อถัดไป) ลิงก์เก่า `/admin-page` redirect มาที่นี่ |

## ช่วงเปิดรับออเดอร์และโควตาต่อวัน

แคมเปญรับออเดอร์ได้เฉพาะวันที่กำหนดและจำกัดจำนวนต่อวัน (แม่แบบ `data/menu.json`: `order_days` = 18–22 กันยายน 2026, `orders_per_day` = 200 → รวม 1,000 ออเดอร์) นับตามวันเวลาไทย (Asia/Bangkok) เฉพาะออเดอร์ที่ไม่ถูกยกเลิก (`orders.order_day`)

- นอกช่วงวัน: หน้าแคมเปญ/Cart แสดงป้าย "ยังไม่เปิดรับออเดอร์ เปิด 18–22 กันยายน 2569" หรือ "ปิดรับออเดอร์แล้ว" ปุ่ม Confirm กดไม่ได้ และ server ปฏิเสธ (409)
- ในช่วงวัน: ป้าย "วันนี้เหลือ N / 200 ออเดอร์" เมื่อครบ 200 จะขึ้น "วันนี้ครบ 200 ออเดอร์แล้ว" และแจ้งให้สั่งใหม่วันถัดไป (ตรวจใน transaction เดียวกับสต๊อก กันสั่งเกินพร้อมกัน) ยกเลิกออเดอร์คืนโควตา
- หลังบ้าน (เมนู Slip Issue) แสดง "วันนี้ X / 200 ออเดอร์ · รวม Y / 1000"; `/api/stock` และ `/api/menu` มี `order_window` (`days`, `per_day`, `today`, `today_count`, `today_remaining`, `total_count`, `total_max`, `status`, `message`)
- design ของแคมเปญกำหนด `order_days` / `orders_per_day` ของตัวเองได้ (ว่าง = ใช้ของแม่แบบ); ตัวแปร `ORDER_DAY_OVERRIDE=YYYY-MM-DD` ใช้จำลองวันตอนทดสอบ
- **ข้อจำกัด preview (GitHub Pages)**: ไม่มี server กลาง โควตาต่อวันนับเฉพาะออเดอร์ในเบราว์เซอร์นั้น การจำกัด 200 ออเดอร์/วันจริงอยู่บนระบบจริง (Cloudflare Pages + D1 หรือ `node server.js`)

## PDPA (ความยินยอมเก็บ/ใช้ข้อมูลส่วนบุคคล)

ลูกค้าใหม่ที่ยังไม่เคยกดยอมรับ จะเจอ pop-up "การให้ความยินยอมในการเก็บรวบรวมและใช้ข้อมูลส่วนบุคคล" ทุกครั้งที่เปิดหน้าแคมเปญ (`/jianchaxnavori/` รวมถึง `/backend/#/jianchaxnavori/` ใน preview) ต้องติ๊กช่อง "ข้าพเจ้ายอมรับและยินยอมให้ JIANCHA ..." แล้วกด **ยอมรับ** ถึงจะปิดได้ (ปิดด้วยวิธีอื่นไม่ได้) ข้อความมาจากไฟล์ "ฟอร์ม PDPA.docx" (ค่าคงที่ `PDPA_TITLE / PDPA_PARAS / PDPA_CONSENT` ใน `public/js/app.js`)

- การยอมรับเก็บใน localStorage ของเบราว์เซอร์ (`jc_pdpa`) และส่งไป `POST /api/pdpa` บันทึก `customers.pdpa_accepted_at` (ครั้งแรกเท่านั้น) เมื่อล็อกอิน Google การยอมรับของเบราว์เซอร์นั้นจะติดไปกับบัญชี ล็อกอินบัญชีเดิมจากเครื่องอื่นจึงไม่ต้องยอมรับซ้ำ
- ออเดอร์เก็บเวลาที่ยอมรับไว้ด้วย (`orders.pdpa_accepted_at`) หลังบ้านเห็นบรรทัด **PDPA consent** ในการ์ดออเดอร์เป็นหลักฐาน

## ลูกค้าเข้าสู่ระบบด้วย Google

ลูกค้าดูเมนู เลือกเซ็ต เลือกสาขาได้โดยไม่ต้องล็อกอิน แต่เมื่อกด **Confirm** ระบบจะเปิด pop-up "Sign in with Google" ให้ล็อกอินด้วยอีเมล Google ก่อน (ล็อกอินเสร็จจะยืนยันคำสั่งซื้อต่อให้อัตโนมัติ) ประวัติการสั่งซื้อ (`/orders`) ผูกกับบัญชี Google จึงเปิดดูได้จากทุกเครื่อง หัวเว็บแสดงชื่อ/รูปบัญชีและปุ่ม Sign out

- เปิดใช้ด้วยตัวแปร `GOOGLE_CLIENT_ID` (OAuth 2.0 Client ID ชนิด Web application จาก https://console.cloud.google.com/apis/credentials) ใส่ **Authorized JavaScript origins** = `https://order.jianchatea.com` (และ `http://localhost:3870` สำหรับทดสอบ) ไม่ต้องใส่ redirect URI
- Cloudflare Pages: ใส่ตัวแปร `GOOGLE_CLIENT_ID` ใน Settings → Variables (ดูหัวข้อ Cloudflare) · server: ใส่ใน `.env` · preview (GitHub Pages): ตั้ง Repository variable ชื่อ `GOOGLE_CLIENT_ID` (Settings → Secrets and variables → Actions → Variables) แล้ว push/rerun workflow
- ถ้ายังไม่ตั้งค่า: server จะให้สั่งซื้อแบบไม่ล็อกอินเหมือนเดิม ส่วน preview จะแสดงปุ่ม "ทดลองเข้าสู่ระบบ (preview)" ให้พิมพ์อีเมลเองเพื่อทดสอบ flow
- ฝั่ง server ตรวจ ID token กับ Google (`oauth2.googleapis.com/tokeninfo`) และเช็ค client id / ผู้ออก / วันหมดอายุ / อีเมลยืนยันแล้ว ก่อนบันทึกบัญชี (`customers.google_sub/email/name/picture`) ออเดอร์ที่สั่งไว้ในเบราว์เซอร์ก่อนล็อกอินจะย้ายไปอยู่กับบัญชีให้
- **ประวัติการสั่งซื้อแยกตามบัญชี Google**: `/orders` แสดงเฉพาะออเดอร์ที่สั่งด้วยบัญชีที่ล็อกอินอยู่ (ยังไม่ล็อกอิน = ไม่มีออเดอร์) ออเดอร์เดิมทั้งหมดที่มีอยู่ก่อนแยกตามบัญชี ย้ายไปอยู่กับบัญชี `whenwendy.yake@gmail.com` (server: ทำครั้งเดียวตอนเริ่ม ตั้งอีเมลอื่นได้ด้วย `LEGACY_ORDERS_OWNER` — สร้างแถวลูกค้าไว้ล่วงหน้าด้วยอีเมล เมื่อเจ้าของล็อกอินด้วย Google อีเมลนั้นครั้งแรกจะผูกบัญชีให้อัตโนมัติ; preview: ข้อมูลใน localStorage ของเบราว์เซอร์นั้นย้ายให้ตอนเปิดหน้า) ผู้ใช้อื่นล็อกอินเข้ามาจะไม่เห็นออเดอร์เหล่านี้
- หลังบ้านเห็น **Google account** (อีเมล/ชื่อ) และ **Contact number** ของผู้สั่งในการ์ดออเดอร์ทุกใบ (ค้นหาออเดอร์ด้วยอีเมลหรือเบอร์ได้) เผื่อต้องติดต่อผู้รับให้ถูกคน และมีเมนู **Customer** (ทุกบทบาท) แสดงรายชื่อลูกค้าที่ล็อกอินด้วย Google **แยกตามแคมเปญ**: ลูกค้าที่ล็อกอินจากหน้า `/<แคมเปญ>/` (เช่น `/jianchaxnavori/`) หรือสั่งซื้อในแคมเปญนั้น จะอยู่ในรายชื่อของแคมเปญนั้น (ตาราง `customer_campaigns`) ค่าเริ่มต้นแสดงแคมเปญที่ Active เลือกแคมเปญอื่นหรือ "ทุกแคมเปญ" ได้ คอลัมน์: ชื่อ อีเมล ล็อกอินล่าสุด จำนวนออเดอร์และยอดที่ชำระ (นับเฉพาะแคมเปญที่เลือก) ออเดอร์ล่าสุด วันที่เข้าแคมเปญ ค้นหาได้ และปุ่ม Download CSV

ก่อนหน้านี้ระบบจำเบราว์เซอร์ด้วย cookie (อายุ 1 ปี) ซึ่งยังใช้เป็นตัวตนชั่วคราวก่อนล็อกอิน

## หลังบ้าน: บทบาทและบัญชี

| บัญชีเริ่มต้น | รหัสผ่าน | บทบาท | ทำอะไรได้ |
|---|---|---|---|
| `it-admin` | `jiancha2026` | IT-Admin | ทุกอย่าง: จัดการบัญชี (Account), สร้าง/แก้ไข/เปิดใช้แคมเปญ, ดูออเดอร์, ตรวจสลิป, รับสินค้า, ยกเลิก |
| `admin` | `marketing` | Admin (Marketing) | ดูออเดอร์ทุกรายการ (Order), ดู Slip Issue, Store Pick-up Order, กดรับสินค้าแล้ว, ออกรหัสโปรโมชัน |
| `finance` | `jiancha` | Finance | เหมือน Admin และเพิ่ม: Approve / Reject สลิปใน Slip Issue (พร้อมเหตุผลที่ลูกค้าเห็น), ยกเลิกออเดอร์ |

ทุกบัญชีมีเมนู Order · Slip Issue · Pick-up Order · Customer เหมือนกัน (IT-Admin มี Design และ Account เพิ่ม) เมนูเป็นปุ่ม hamburger (☰) มุมขวาบนของทุกหน้าหลังบ้าน กดแล้วกางเป็นรายการปุ่มเรียงลงมา (ไอคอนซ้าย ชื่อเมนูกลาง) ปิดโดยกดปุ่มซ้ำ กดนอกเมนู หรือกด Esc หน้าแรกคือหน้า Campaign (การ์ดแคมเปญ) เมื่ออยู่ในเมนูหรือแคมเปญใดก็ตาม รายการแรกในเมนูคือ Back กลับหน้าแรก และ Logout อยู่ท้ายเมนู

- **Order**: รายการออเดอร์ทั้งหมดของแคมเปญที่ Active ทันที มีช่องค้นหา (เลขออเดอร์/สาขา) และ Date Selection (สลับแคมเปญได้เมื่อมีหลายแคมเปญ) แสดงหน้าละ 20 รายการ (ใหม่สุดก่อน) เกินกว่านั้นกดลูกศรไปหน้าถัดไป ตัวเลขกลางแสดง "หน้าปัจจุบัน / จำนวนหน้า" ใช้เหมือนกันทั้ง Order · Slip Issue · Store Pick-up Order
- **Slip Issue**: รายการสลิปที่มีปัญหาทั้งหมด (รอตรวจ + On Issue) พร้อมตัวเลขสรุป ตัวกรอง Status เลือกดูสถานะอื่นได้
- **Store Pick-up Order**: chip All Stores + สาขา JIANCHA แล้วรายการออเดอร์ที่ชำระแล้ว (รอรับสินค้า / รับแล้ว) ของสาขานั้น กด "รับสินค้าแล้ว" ได้จากรายการ

- บัญชีเก็บในฐานข้อมูล (รหัสผ่านเข้ารหัสด้วย bcrypt) IT-Admin เพิ่ม/แก้ไข/ปิด/ลบบัญชีได้ในหน้า Account และทุกคนเปลี่ยนรหัสผ่านตัวเองได้ผ่าน API `/api/admin/me/password`
- **เปลี่ยนรหัสผ่านทั้ง 3 บัญชีก่อนขึ้น production**
- ทุกมุมมองเริ่มจากหน้า "Campaign Selection" เลือกแคมเปญก่อน (พิมพ์เลขออเดอร์ในช่องค้นหาเพื่อข้ามไปหาออเดอร์ได้เลย) IT-Admin สร้างแคมเปญใหม่ได้จากการ์ด "Create new campaign" (ชื่อ, stock, ช่วงรหัสโปรโมชัน) และเปิดใช้งานได้ครั้งละ 1 แคมเปญ หน้าเว็บลูกค้าจะขายตามแคมเปญที่ Active
- ค่า stock และช่วงรหัสโปรโมชันใน `data/menu.json` ใช้เป็นค่าเริ่มต้นตอนสร้างแคมเปญแรกเท่านั้น หลังจากนั้นแก้ที่แคมเปญในหลังบ้าน

## สถานะคำสั่งซื้อ

`pending` รอชำระเงิน → `slip_uploaded` รอตรวจสลิป (แท็กสีแดง "Verifying slip") → `paid` Approved (แท็กสีเขียว "บัญชีตรวจสอบรายการคำสั่งซื้อเรียบร้อย" เมื่อ Finance กด Approve หรือ SlipOK ตรวจผ่านอัตโนมัติ) → `picked_up` รับสินค้าแล้ว

ปุ่ม Print / ใบรายการพิมพ์ได้เฉพาะเมื่อสถานะเป็น `paid` หรือ `picked_up` แล้ว (หน้า Order History, หน้า `/receipt` และปุ่มพิมพ์ในหลังบ้าน) ก่อนหน้านั้นเปิดดูใบรายการได้แต่ไม่มีปุ่มพิมพ์
สลิปที่ไม่ผ่านจะเป็น `slip_rejected` (Finance เห็นเป็น "On Issue") ลูกค้าเห็นเหตุผลและอัปโหลดใหม่ได้ หรือ `cancelled` เมื่อยกเลิก

- ถ้าตั้งค่า SlipOK (`SLIPOK_API_KEY`) สลิปที่ยอดตรง/ผู้รับตรงจะเป็น `paid` อัตโนมัติ
- ถ้าไม่ตั้ง SlipOK สลิปทุกใบจะเป็น `slip_uploaded` รอ Finance กด "Approve"
- ระบบกันสลิปซ้ำ (hash รูป และเลขอ้างอิงจาก SlipOK) และคำสั่งซื้อยอด 0 บาทจะเป็น `paid` ทันที

## ติดตั้งและรัน

```bash
git clone https://github.com/itjianchacenter-ai/order-mkt.git
cd order-mkt
npm install
cp .env.example .env     # แก้ค่าตามด้านล่าง
npm start                # http://localhost:3870
```

ค่าใน `.env` ที่ต้องตั้งก่อนใช้งานจริง

| ตัวแปร | ความหมาย |
|---|---|
| `JWT_SECRET` | ค่าสุ่มยาว ๆ สำหรับเซ็น cookie (จำเป็นเมื่อ `NODE_ENV=production`) |
| `GOOGLE_CLIENT_ID` | OAuth Client ID สำหรับ Sign in with Google ของลูกค้า (ว่าง = ไม่บังคับล็อกอิน) |
| `LEGACY_ORDERS_OWNER` | อีเมล Google ที่รับออเดอร์เดิมซึ่งไม่ผูกบัญชี (ค่าเริ่มต้น `whenwendy.yake@gmail.com` ทำครั้งเดียว) |
| `PROMPTPAY_ID` | เบอร์/เลขนิติบุคคล PromptPay ที่รับเงิน |
| `PROMPTPAY_QR_PAYLOAD` | (ถ้ามี) payload ของ Thai-QR ร้านค้า ระบบจะใส่ยอดเงินให้เอง |
| `SLIPOK_API_KEY` / `SLIPOK_BRANCH_ID` | (ถ้ามี) ตรวจสลิปอัตโนมัติ |

ฐานข้อมูลเป็น SQLite ที่ `data/orders.db` (สร้างอัตโนมัติ) รูปสลิปอยู่ที่ `uploads/` ทั้งสองอย่างไม่อยู่ใน git ควรสำรองข้อมูลตามรอบ

## จำกัดจำนวนสินค้า (stock)

สต๊อกนับเป็น "ชุด": ทุกเซ็ตที่สั่ง 1 ชุด = 1 หน่วยของสต๊อก (ค่าเริ่มต้น) ถ้าต้องการให้เซ็ตไหนกินสต๊อกมากกว่านั้น ใส่ `pieces` ในเซ็ตนั้น (เช่น `"pieces": 3` = 1 ชุดกิน 3 หน่วย) ค่า `stock.total` ของแคมเปญคือจำนวนหน่วยสูงสุด (1,000)

```json
"stock": { "total": 1000 }
```

- `total` = รวมทุกอย่าง, `drink` / `dessert` = แยกตามหมวด ใส่ได้หลายค่าพร้อมกัน ค่าที่ไม่ใส่ = ไม่จำกัด
- คำสั่งซื้อทุกสถานะยกเว้น `cancelled` นับเป็นการจองสต๊อก (รวมที่รอชำระเงิน) ถ้าลูกค้าไม่จ่าย admin กด "ยกเลิก" เพื่อคืนสต๊อก
- หน้าเว็บแสดงจำนวนคงเหลือ และขึ้น "สินค้าหมด" พร้อมปิดปุ่มสั่งเมื่อครบ เซิร์ฟเวอร์ตรวจซ้ำตอนยืนยันเสมอ

## รหัสโปรโมชันสำหรับ POS (ปุ่ม "รับ code")

เมื่อออเดอร์อยู่ในสถานะ `paid` หรือ `picked_up` ลูกค้ากด "รับ code" ในหน้า Order History ระบบสุ่มเลข 10 หลักจากช่วงใน `data/menu.json` (ค่าเริ่มต้น 2026090001 ถึง 2026092000) ที่ยังไม่เคยใช้ ผูกกับออเดอร์นั้นถาวร กดซ้ำได้เลขเดิม แสดงในใบรายการและหน้า admin ด้วย หน้าร้านนำเลขนี้ไปกรอกโปรโมชันใน POS

```json
"promo_code": { "from": 2026090001, "to": 2026092000 }
```

## แก้เมนูและสาขา

- **ลิงก์ของแต่ละแคมเปญ** — ทุกแคมเปญมี URL ของตัวเอง `https://order.jianchatea.com/<ลิงก์>/` เช่น JIANCHA x NAVORI → `/jianchaxnavori/` (ตั้งจากชื่อแคมเปญ ใช้ได้เฉพาะ a-z, 0-9 แก้ได้ในฟอร์มแคมเปญ) หน้า `/cart` `/orders` `/stores` `/pay` `/receipt` อยู่ใต้ลิงก์เดียวกัน ส่วน `/` (ไม่มีลิงก์) แสดงแคมเปญที่ติ๊ก **Active** ปิดรับออเดอร์ของแคมเปญได้ด้วยติ๊ก "เปิดรับคำสั่งซื้อ" (ลูกค้ายังเปิดหน้าดูได้แต่กด Confirm ไม่ได้)
- **หน้า Design (IT-Admin, ปุ่มไอคอนพู่กันในเมนู)** — หน้าแรกเป็น All Campaign กดการ์ดแคมเปญเพื่อแก้รูป (ปุ่ม Another Campaign กลับมาเลือกแคมเปญอื่น หรือกดปุ่ม Design บนการ์ดในหน้าแรกก็ได้) ใส่รูปและรายละเอียดที่แสดงบนหน้าของแคมเปญนั้น การแก้ไขทั้งหมด (รูป ชื่อ ราคา รายการ) จะมีผลเมื่อกดปุ่ม **Save** ที่แถบด้านล่าง (ปุ่ม "ยกเลิกการแก้ไข" ทิ้งการแก้ที่ยังไม่บันทึก เก็บใน `campaigns.design_json`) รูปอัปโหลดเก็บที่ `uploads/design/` และเปิดดูได้สาธารณะ
  - **Promote Image** 1180 × 570 px (svg / png) รูปใหญ่รวมน้ำ + ขนม ใส่ได้หลายรูป = สไลด์บนหน้าแรก
  - **Set image** 320 × 330 px 1 รูปต่อเซ็ต + **รูปน้ำ / ขนมเดี่ยว** 115 × 105 px 3 รูปต่อเซ็ต
  - รายละเอียดเซ็ต: label (SET A), ชื่อเมนู EN/TH, ราคา, stock ต่อ 1 ชุด (pieces), รายการในเซ็ต (EN/TH/ประเภท drink หรือ dessert), เปิด/ปิดการแสดง, สร้างเซ็ตใหม่ / ลบเซ็ต
  - รูปที่อัปโหลดถูกย่อในเบราว์เซอร์ให้พอดี 2 เท่าของขนาดแนะนำ (svg ไม่ถูกแตะ) ออเดอร์เดิมเก็บชื่อ/ราคาเซ็ต ณ ตอนสั่งไว้แล้ว การแก้ design ภายหลังไม่กระทบ
- `data/menu.json` — **แม่แบบ** ของแคมเปญที่ยังไม่เคยตั้งค่าในหน้า Design: เซ็ตเมนู (`sets`): `id`, `label` (เช่น SET A), `name_en`, `name_th`, `price`, `image` (รูปใหญ่), `images` (รูปย่อย 3 รูป), `items` (รายการในเซ็ต: `name_en`, `name_th`, `kind` = drink/dessert), `pieces` (หน่วยสต๊อกต่อ 1 ชุด ค่าเริ่มต้น 1), `pickup_dates` (วันที่รับของ YYYY-MM-DD ให้ลูกค้าเลือก; design ของแคมเปญมี `pickup_dates` ของตัวเองได้ ว่าง = ใช้ของแม่แบบ), `pickup_times` (ช่วงเวลารับของเป็นข้อความ เช่น 13:00-15:00 น.; design ของแคมเปญกำหนดเองได้เช่นกัน), `banner` รูปแบนเนอร์หน้าแรก path รูปอยู่ใน `public/img/menu/` หรือเป็น URL
- `data/stores.json` — สาขา: `id`, `brand`, `name`, `map_url`, `active`

ไฟล์ทั้งสองอ่านใหม่ทุกครั้งที่มีการเรียก ไม่ต้องรีสตาร์ท

## ก่อนขึ้น production: รีเซ็ตข้อมูลทดสอบ

ข้อมูลทดสอบทั้งหมด (ออเดอร์, รหัสโปรโมชันที่ออกไปแล้ว, เลขลำดับออเดอร์, รูปสลิป) ล้างได้ด้วยคำสั่งเดียว เมนู สาขา และค่า stock ไม่ถูกแตะ

```bash
node scripts/reset-data.js --yes
```

หลังรัน เลขออเดอร์เริ่มที่ `YYYYMMDD00001` ใหม่ และรหัสโปรโมชันสุ่มได้จากช่วงเต็ม 2,000 เลขอีกครั้ง
(ถ้าเซิร์ฟเวอร์ production เป็นเครื่องใหม่ที่ไม่เคยรันทดสอบ ฐานข้อมูลจะว่างอยู่แล้ว ไม่ต้องรัน)

**Checklist ขึ้น production**
1. ตั้งค่า `.env`: `NODE_ENV=production`, `JWT_SECRET` ใหม่, `PROMPTPAY_ID` จริง และเปลี่ยนรหัสผ่านทั้ง 3 บัญชีหลังบ้านในหน้า Account
2. ใส่เมนู ราคา รูป และสาขาจริงใน `data/menu.json` / `data/stores.json`
3. `node scripts/reset-data.js --yes`
4. `npm test` แล้วสั่งซื้อทดลอง 1 รายการบนระบบจริง ตรวจ QR และรหัส แล้วรัน reset อีกครั้ง

## อีเมลยืนยันการอนุมัติ

- หลังลูกค้าส่งสลิป หน้าชำระเงินจะขึ้น pop-up "สั่งซื้อสำเร็จ" พร้อมข้อความว่าระบบจะตรวจสอบยอดโอนและแจ้งผลภายใน 24 ชม. ทางอีเมลที่ลงทะเบียน
- เมื่อบัญชี (finance / it-admin) กด **Approve** หรือสลิปผ่านการตรวจอัตโนมัติ (SlipOK) ระบบส่งอีเมลยืนยันพร้อมรายการคำสั่งซื้อ ยอดรวม สาขา วัน-เวลารับของ ไปยัง**อีเมล Google ที่ลูกค้าใช้สั่ง** ผลการส่งแสดงใต้ออเดอร์ในหลังบ้าน และเก็บในตาราง `mail_log`
- ตั้งค่า SMTP ใน `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (เช่น Gmail: smtp.gmail.com พอร์ต 587 + App Password) ถ้ายังไม่ตั้งค่า ระบบจะไม่ส่งจริงแต่บันทึกสถานะ "logged" ให้เห็น
- หัวอีเมลเป็นโลโก้ JIANCHA x NAVORI (แนบไปกับอีเมลแบบ inline) ใช้ฟอนต์ DB Helvethaica X จาก `public/fonts/` (ไคลเอนต์ที่รองรับ @font-face เช่น Apple Mail/iOS จะแสดงฟอนต์นี้ Gmail จะใช้ Arial แทน) ทดสอบการตั้งค่า SMTP ได้ด้วย `node scripts/send-test-mail.js you@example.com`
- preview บน GitHub Pages ไม่มี server จึงส่งอีเมลจริงไม่ได้ จะแสดงเป็น "อีเมลยืนยัน (preview จำลอง)" แทน

## ขึ้นระบบจริงบน Cloudflare Pages (แนะนำ)

ระบบทั้งหมด (API, ฐานข้อมูล, รูปสลิป, อีเมล, หลังบ้าน) รันบน Cloudflare โดยไม่ต้องมีเซิร์ฟเวอร์: หน้าเว็บจาก `public/` + `_worker.js` (bundle จาก `worker/` ด้วย `scripts/build-worker.js`) ใช้ **D1** (SQLite ของ Cloudflare ฟรี 5 GB) เป็นฐานข้อมูลกลาง รูปสลิป/รูป Design เก็บใน D1 ด้วย (ผูก **R2** เพิ่มได้ถ้าต้องการ แต่ R2 ต้องผูกบัตร) ตารางและ API เหมือน `server.js` ทุกอย่าง (ตารางถูกสร้างและ seed บัญชีหลังบ้าน + แคมเปญแรกให้เองตอนเปิดใช้ครั้งแรก) ลูกค้าทุกคนที่ล็อกอิน Google จากทุกเครื่อง/เบราว์เซอร์จะอยู่ในเมนู **Customer** ของหลังบ้าน

### 1. สร้างฐานข้อมูลและที่เก็บไฟล์ (ทำครั้งเดียว)

ใน Cloudflare dashboard (บัญชีที่ถือโดเมน jianchatea.com)

| เมนู | ทำอะไร |
|---|---|
| Storage & Databases → **D1 SQL Database** → Create | ตั้งชื่อ `jc-order` (ไม่ต้องสร้างตารางเอง) |
| (ไม่บังคับ) Storage & Databases → **R2 Object Storage** → Create bucket | ตั้งชื่อ `jc-files` ใช้เก็บรูปสลิปแทน D1 — ต้องผูกบัตรตอนเปิดใช้ R2 (ปริมาณเว็บนี้อยู่ใน free tier) ถ้าไม่ผูก รูปจะเก็บใน D1 (จำกัด 1.5 MB/รูป หน้า pay ย่อรูปให้อัตโนมัติ) |

### 2. สร้าง Pages project จาก repo

Workers & Pages → Create → **Pages** → Connect to Git → เลือก repo `itjianchacenter-ai/order-mkt`

| ช่อง | ค่า |
|---|---|
| Production branch | `main` |
| Build command | `bash scripts/build-site.sh` (บน Cloudflare จะ build เป็นเว็บจริงอัตโนมัติ ตัวแปร `CF_PAGES=1`) |
| Build output directory | `_site` |

**Environment variables** (Settings → Variables and Secrets ใส่ทั้ง Production และ Preview):

| ตัวแปร | ค่า | จำเป็น |
|---|---|---|
| `NODE_VERSION` | `22` | ✅ |
| `JWT_SECRET` | ข้อความสุ่มยาว ๆ (ใช้เซ็น cookie ล็อกอิน) — ชนิด Secret | ✅ |
| `GOOGLE_CLIENT_ID` | OAuth Client ID ชนิด Web (origin `https://order.jianchatea.com`) — ถ้าว่าง ลูกค้าจะสั่งได้โดยไม่ล็อกอินและหลังบ้านจะไม่มีรายชื่อลูกค้า | ✅ |
| `PROMPTPAY_ID` | เบอร์/เลขนิติบุคคล PromptPay ที่รับเงิน (สร้าง QR) หรือใส่ `PROMPTPAY_QR_PAYLOAD` จาก QR ร้าน | ✅ |
| `PUBLIC_BASE_URL` | `https://order.jianchatea.com` (ลิงก์ในอีเมล/หลังบ้าน) | ✅ |
| `RESEND_API_KEY` + `MAIL_FROM` | ส่งอีเมลยืนยันเมื่อ Approve ผ่าน https://resend.com (ยืนยันโดเมน jianchatea.com ใน Resend ก่อน) ว่าง = ไม่ส่งจริง บันทึกสถานะ "logged" | แนะนำ |
| `SLIPOK_API_KEY` + `SLIPOK_BRANCH_ID` | ตรวจสลิปอัตโนมัติ (ว่าง = บัญชีตรวจเอง) | ไม่บังคับ |
| `ORDER_DAY_OVERRIDE` | `YYYY-MM-DD` จำลองวันที่ (ใช้ทดสอบเท่านั้น ห้ามตั้งบน Production) | — |

**Bindings** (Settings → Bindings → Add ทั้ง Production และ Preview) — ชื่อตัวแปรต้องตรงตามนี้:

| ชนิด | Variable name | เลือก |
|---|---|---|
| D1 database | `DB` | `jc-order` |
| R2 bucket (ไม่บังคับ) | `FILES` | `jc-files` |

ถ้ายังไม่ได้ผูก `DB` เว็บจะแสดงข้อความบอกให้ผูกแทนหน้าเว็บ (`/api/admin/me` บอก `file_storage` = `d1` หรือ `r2`) หลังเพิ่ม bindings/ตัวแปรให้กด **Retry deployment** (หรือ push ใหม่) 1 ครั้ง

> ถ้า build ล้มตอน `npm install` (แพ็กเกจ `better-sqlite3` ของเวอร์ชันเซิร์ฟเวอร์ต้อง compile) ให้เพิ่มตัวแปร `SKIP_INSTALL_DEPS` = `true` และเปลี่ยน Build command เป็น `npm ci --ignore-scripts && bash scripts/build-site.sh`

### 3. ผูกโดเมน

Pages project → Custom domains → Set up a custom domain → `order.jianchatea.com` (Cloudflare สร้าง CNAME แทน record เดิมที่ชี้ GitHub Pages ให้เอง) รอ 1–5 นาที แล้วเปิด https://order.jianchatea.com — Workers & Pages ไม่ต้องตั้ง Cache Rules เพิ่ม (`_routes.json` ให้เฉพาะ css/js/img/fonts ผ่าน CDN ส่วน API/หน้าเว็บ/สลิปผ่าน worker ทุกครั้งและส่ง `Cache-Control: no-store`)

### 4. ก่อนเปิดขาย

- เข้า https://order.jianchatea.com/backend ด้วย `it-admin` / `jiancha2026` แล้ว**เปลี่ยนรหัสผ่านทั้ง 3 บัญชี**ในหน้า Account (บัญชีเริ่มต้นชุดเดียวกับตารางด้านบน แต่ฐานข้อมูลบน D1 เริ่มว่าง ไม่มีออเดอร์ทดสอบจาก preview)
- หน้า Design: ตรวจรูป/ราคา/วันรับของ กด Save
- ทดลองสั่ง 1 ออเดอร์ด้วยบัญชี Google → สแกน QR → ส่งสลิป → Approve ในหลังบ้าน → ได้อีเมล → รับ code แล้วยกเลิกออเดอร์ทดสอบ (ยกเลิกคืนโควตาและสต๊อก)
- แก้เมนู/สาขา/วันรับของ: แก้ `data/menu.json`, `data/stores.json` แล้ว push เข้า `main` (Cloudflare build ใหม่เอง ~1 นาที) หรือแก้ในหน้า Design ของแคมเปญโดยไม่ต้อง push

### ทดสอบเครื่องตัวเอง

```bash
npm run test:cf      # build เว็บจริง + รัน wrangler pages dev (D1/R2 จำลองในเครื่อง) + smoke test ชุดเดียวกับ npm test
npm run test:cf:d1   # แบบไม่ผูก R2 (รูปเก็บใน D1)
npm run dev:cf    # เปิดเว็บจริงที่ http://localhost:8788 ด้วย D1/R2 จำลอง (ไม่มี Google login: GOOGLE_CLIENT_ID ว่าง)
```

## ทางเลือก: Deploy บนเซิร์ฟเวอร์ของตัวเอง (Node + SQLite)

**ต้องมี** เครื่อง Ubuntu 22.04/24.04 ที่มี IP สาธารณะ (VPS 1 vCPU / 1 GB พอ เช่น DigitalOcean, Vultr, Linode หรือเซิร์ฟเวอร์ของบริษัท) และเข้าถึงด้วย SSH ได้

### 1. ติดตั้งด้วยคำสั่งเดียว (รันบนเซิร์ฟเวอร์ด้วย root)

```bash
curl -fsSL https://raw.githubusercontent.com/itjianchacenter-ai/order-mkt/main/deploy/install.sh | sudo bash
```

สคริปต์ติดตั้ง Node.js 22, pm2, Caddy (HTTPS อัตโนมัติ), clone โค้ดไว้ที่ `/opt/order-mkt`, สร้าง `.env` (สุ่ม `JWT_SECRET` ให้), เปิดบริการ, ตั้งไฟร์วอลล์ และสำรองฐานข้อมูลทุกคืน 03:00 ไว้ที่ `/opt/order-mkt/backups`

### 2. ใส่ค่าตั้งค่าใน `/opt/order-mkt/.env` แล้ว `pm2 restart jiancha-order`

| ค่า | ใช้ทำอะไร | จำเป็น |
|---|---|---|
| `PROMPTPAY_ID` | เบอร์/เลขนิติบุคคล PromptPay ที่รับเงิน (สร้าง QR) | ✅ |
| `GOOGLE_CLIENT_ID` | ปุ่ม Sign in with Google ของลูกค้า (OAuth Client ID ชนิด Web ใส่ origin `https://order.jianchatea.com`) | ✅ |
| `SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM` | ส่งอีเมลยืนยันเมื่อบัญชี Approve | แนะนำ |
| `SLIPOK_API_KEY / SLIPOK_BRANCH_ID` | ตรวจสลิปอัตโนมัติ (ว่าง = บัญชีตรวจเอง) | ไม่บังคับ |

ทดสอบอีเมล: `node scripts/send-test-mail.js you@example.com`

### 3. ชี้โดเมนมาที่เซิร์ฟเวอร์ผ่าน Cloudflare (jianchatea.com → DNS)

แก้ record `order` จาก CNAME `itjianchacenter-ai.github.io` เป็น **A record = IP ของเซิร์ฟเวอร์** รอ 1–5 นาที แล้วเปิด https://order.jianchatea.com

**ตั้งค่า Cloudflare เมื่อเปิด Proxied (เมฆส้ม) ให้ Cloudflare อยู่หน้าเซิร์ฟเวอร์** (แนะนำ ได้ CDN/กัน DDoS):

| เมนู Cloudflare | ตั้งค่า |
|---|---|
| DNS → `order` A record | IP เซิร์ฟเวอร์, Proxy status **Proxied** |
| SSL/TLS → Overview | **Full (strict)** (Caddy บนเซิร์ฟเวอร์มีใบรับรอง Let's Encrypt ผ่าน Cloudflare ได้ตามปกติ) |
| SSL/TLS → Edge Certificates | Always Use HTTPS = On |
| Caching → Cache Rules | เพิ่ม rule **Bypass cache** สำหรับ URI path starts with `/api/`, `/uploads/`, `/backend` (server ส่ง `Cache-Control: no-store` ให้ `/api` และ `/uploads` อยู่แล้ว rule นี้เป็นชั้นกันพลาด) |
| Speed → Optimization | ปิด Rocket Loader / Auto Minify JS (กันแก้ไฟล์ JS ของแอป) |

โค้ดตั้ง `trust proxy` ไว้แล้ว จึงอ่าน IP จริงของลูกค้าและรู้ว่าเป็น https ผ่าน Cloudflare ได้ถูกต้อง (cookie ล็อกอินทำงานปกติ)

> ทางนี้ใช้เมื่ออยากรัน `server.js` เอง (Node + SQLite + ไฟล์สลิปในเครื่อง) ถ้าใช้ Cloudflare Pages ตามหัวข้อก่อนหน้าไม่ต้องทำส่วนนี้ — ทั้งสองทางใช้ตรรกะร่วมกันใน `lib/` (เมนู/design, ช่วงเปิดรับออเดอร์, PromptPay, อีเมล)

### 4. ก่อนเปิดใช้งาน

- เข้า https://order.jianchatea.com/admin-page ด้วย it-admin แล้ว**เปลี่ยนรหัสผ่านทั้ง 3 บัญชี**ในหน้า Account
- หน้า Design: ตรวจรูป/ราคาของแคมเปญ (แม่แบบจาก `data/menu.json` ถูกติดตั้งมาให้แล้ว) กด Save
- ล้างข้อมูลทดสอบก่อนขายจริง: `node scripts/reset-data.js --yes`
- ทดลองสั่ง 1 ออเดอร์ → สแกน QR → ส่งสลิป → Approve → ได้อีเมล → รับ code

### อัปเดตโค้ดครั้งถัดไป

```bash
sudo /opt/order-mkt/deploy/update.sh     # backup → git pull → npm ci → restart
```

### ทางเลือก: Docker

`Dockerfile` + `docker-compose.yml` ใช้กับ Railway / Render / Fly.io หรือเครื่องที่มี Docker ได้ (`docker compose up -d`) ต้อง mount `data/` และ `uploads/` เป็น volume ถาวร

## ทดสอบ

```bash
npm test                        # smoke test ของ API ทั้งหมดบนฐานข้อมูลชั่วคราว (server.js)
npm run test:cf                 # smoke test ชุดเดียวกันกับ worker บน Cloudflare (wrangler pages dev + D1/R2 จำลอง)
node scripts/build-preview.js   # สร้าง dist/preview.html เวอร์ชันทดลองไม่ต้องมีเซิร์ฟเวอร์
```

`dist/preview.html` คือหน้าเว็บทุกหน้ารวมในไฟล์เดียว ใช้ API จำลองที่เก็บข้อมูลใน localStorage ของเบราว์เซอร์ (บัญชีหลังบ้านชุดเดียวกับด้านบน) ใช้สำหรับดู layout และ flow เท่านั้น
