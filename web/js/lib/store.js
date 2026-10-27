// Cache lưu trong trình duyệt (IndexedDB), có thể xuất/nạp thành một file JSON duy nhất.
//  - entries: kết quả mỗi lần tìm hiểu
//  - pages:   kết quả đọc từng trang (giữ 7 ngày) để không tải lại cùng một trang
//  - suppliers: danh bạ nhà cung cấp (tên, liên hệ, trang đã đọc) theo tên miền, dùng chung cho mọi lần tìm, không tự xóa theo kết quả
const DB = "po-cache";
const STORE = "entries";
const PAGES = "pages";
const SUPPLIERS = "suppliers";
export const MAX_ENTRIES = 40;
export const PAGE_DAYS = 7;
export const MAX_PAGES = 400;

export function createMemoryStore() {
  const m = new Map(), pg = new Map(), sp = new Map();
  const clone = (x) => JSON.parse(JSON.stringify(x));
  return wrap({
    async get(k) { return m.get(k) ?? null; },
    async put(e) { m.set(e.key, clone(e)); },
    async del(k) { m.delete(k); },
    async all() { return [...m.values()].map(clone); },
    async clear() { m.clear(); pg.clear(); sp.clear(); },
    async pget(k) { return pg.has(k) ? clone(pg.get(k)) : null; },
    async pput(r) { pg.set(r.key, clone(r)); },
    async pdel(k) { pg.delete(k); },
    async pall() { return [...pg.values()].map(clone); },
    async sput(r) { sp.set(r.key, clone(r)); },
    async sall() { return [...sp.values()].map(clone); },
  });
}

export function createIdbStore() {
  let dbp = null;
  const open = () => dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(PAGES)) db.createObjectStore(PAGES, { keyPath: "key" });
      if (!db.objectStoreNames.contains(SUPPLIERS)) db.createObjectStore(SUPPLIERS, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (name, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(name, mode);
      const r = fn(t.objectStore(name));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return wrap({
    get: (k) => tx(STORE, "readonly", (s) => s.get(k)).then((v) => v ?? null),
    put: (e) => tx(STORE, "readwrite", (s) => s.put(e)),
    del: (k) => tx(STORE, "readwrite", (s) => s.delete(k)),
    all: () => tx(STORE, "readonly", (s) => s.getAll()).then((v) => v ?? []),
    clear: async () => { await tx(STORE, "readwrite", (s) => s.clear()); await tx(PAGES, "readwrite", (s) => s.clear()); await tx(SUPPLIERS, "readwrite", (s) => s.clear()); },
    pget: (k) => tx(PAGES, "readonly", (s) => s.get(k)).then((v) => v ?? null),
    pput: (r) => tx(PAGES, "readwrite", (s) => s.put(r)),
    pdel: (k) => tx(PAGES, "readwrite", (s) => s.delete(k)),
    pall: () => tx(PAGES, "readonly", (s) => s.getAll()).then((v) => v ?? []),
    sput: (r) => tx(SUPPLIERS, "readwrite", (s) => s.put(r)),
    sall: () => tx(SUPPLIERS, "readonly", (s) => s.getAll()).then((v) => v ?? []),
  });
}

export function createStore() {
  try { if (typeof indexedDB !== "undefined") return createIdbStore(); } catch { /* dùng bộ nhớ tạm */ }
  return createMemoryStore();
}

function wrap(b) {
  return {
    ...b,
    async list() {
      const all = await b.all();
      return all.sort((x, y) => y.updatedAt - x.updatedAt);
    },
    async save(entry) {
      try { await b.put(entry); }
      catch (e) {
        // đầy bộ nhớ trình duyệt: xóa bớt dữ liệu cũ rồi lưu lại
        await this.prune({ days: 7, max: 10 });
        await b.put(entry);
      }
      await this.prune({ days: Infinity, max: MAX_ENTRIES });
    },
    // Tự dọn dữ liệu cũ: quá `days` ngày hoặc vượt `max` mục (giữ mục mới nhất). Cũng dọn cache trang.
    async prune({ days = 30, max = MAX_ENTRIES } = {}) {
      const all = await this.list();
      const cutoff = Date.now() - days * 864e5;
      let n = 0;
      for (const [i, e] of all.entries()) {
        if (i >= max || (e.updatedAt ?? 0) < cutoff) { await b.del(e.key); n++; }
      }
      n += await this.prunePages();
      return n;
    },

    // ----- cache trang đã đọc -----
    async getPage(key, maxAgeDays = PAGE_DAYS) {
      const r = await b.pget(key);
      if (!r) return null;
      if (Date.now() - r.ts > maxAgeDays * 864e5) { await b.pdel(key); return null; }
      return r.facts;
    },
    async putPage(key, facts) {
      try { await b.pput({ key, ts: Date.now(), facts }); }
      catch { await this.prunePages({ days: 1, max: 50 }); }
    },
    async prunePages({ days = PAGE_DAYS, max = MAX_PAGES } = {}) {
      const all = (await b.pall()).sort((x, y) => y.ts - x.ts);
      const cutoff = Date.now() - days * 864e5;
      let n = 0;
      for (const [i, r] of all.entries()) if (i >= max || r.ts < cutoff) { await b.pdel(r.key); n++; }
      return n;
    },

    // ----- danh bạ nhà cung cấp (theo tên miền) -----
    async suppliers() {
      const all = await b.sall().catch(() => []);
      return Object.fromEntries(all.map((r) => [r.key, r]));
    },
    /** Ghi các NCC của một lần tìm vào danh bạ: gộp thông tin liên hệ, không mất dữ liệu cũ. */
    async saveSuppliers(list) {
      const cur = await this.suppliers();
      for (const s of list) {
        if (!s?.domain) continue;
        const old = cur[s.domain] ?? {};
        await b.sput({ ...old, ...s, key: s.domain, name: s.name || old.name || s.domain, contact: s.contact ?? old.contact ?? null, firstTs: old.firstTs ?? s.firstTs ?? Date.now(), ts: Date.now() }).catch(() => {});
      }
    },

    // Một file duy nhất chứa toàn bộ cache kết quả (không gồm cache trang)
    async exportAll() {
      return { app: "purchasing-online", version: 2, exportedAt: new Date().toISOString(), entries: await this.list(), suppliers: Object.values(await this.suppliers()) };
    },
    async importAll(data) {
      if (!data || data.app !== "purchasing-online" || !Array.isArray(data.entries)) throw new Error("File không phải cache của ứng dụng này");
      let n = 0;
      for (const e of data.entries) {
        if (!e?.key || !e.plan) continue;
        const cur = await b.get(e.key);
        if (!cur || (cur.updatedAt ?? 0) < (e.updatedAt ?? 0)) { await b.put(e); n++; }
      }
      for (const s of data.suppliers ?? []) if (s?.key) await b.sput(s).catch(() => {});
      return n;
    },
  };
}
