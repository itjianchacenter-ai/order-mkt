/* data/menu.json + data/stores.json are bundled into the worker at build time (edit the JSON, push, Pages rebuilds) */
import menuJson from '../data/menu.json';
import storesJson from '../data/stores.json';
import { normalizeMenu, normalizeStores } from '../lib/menu.js';
export const MENU = normalizeMenu(menuJson);
export const STORES = normalizeStores(storesJson);
