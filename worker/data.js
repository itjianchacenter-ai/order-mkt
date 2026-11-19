/* data/menu.json + data/stores.json + data/member-stores.json are bundled into the worker at build time (edit the JSON, push, Pages rebuilds) */
import menuJson from '../data/menu.json';
import storesJson from '../data/stores.json';
import memberStoresJson from '../data/member-stores.json';
import { normalizeMenu, normalizeStores } from '../lib/menu.js';
export const MENU = normalizeMenu(menuJson);
export const STORES = normalizeStores(storesJson);
// สาขาให้เลือกที่หน้าสมัครสมาชิก (Location) — จากรายชื่อสาขา JIANCHA ทั้งหมด เรียงตามชื่อ
export const MEMBER_STORES = normalizeStores(memberStoresJson).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
