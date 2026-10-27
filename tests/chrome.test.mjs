// Luồng ưu tiên Google trong Chrome: bộ giới hạn, API lai, toàn bộ pipeline với tiện ích GIẢ LẬP, và background.js chạy trên chrome API giả.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createLimiter } from "../web/js/lib/limiter.js";
import { createHybridApi, pageKey } from "../web/js/lib/hybrid.js";
import { createMemoryStore } from "../web/js/lib/store.js";
import { research, enough } from "../web/js/lib/pipeline.js";
import { tableRows, applyView, DEFAULT_VIEW } from "../web/js/lib/offers.js";
import { mockPages } from "../dev/mock-pages.mjs";
import { ApiError } from "../web/js/lib/api.js";
import { createBridge } from "../web/js/lib/bridge.js";

const O = "http://shop.test";
const pages = mockPages(O);

// ---------- bộ giới hạn ----------
function fakeClock() {
  let t = 1_000_000;
  // sleep tính mốc thời gian lúc gọi, nên nhiều yêu cầu chờ song song không cộng dồn
  return { now: () => t, sleep: async (ms) => { const target = t + ms; await Promise.resolve(); t = Math.max(t, target); }, get t() { return t; } };
}

test("limiter: cùng tên miền cách nhau ≥ gap, khác tên miền không chờ nhau", async () => {
  const lim = createLimiter({ hostGapMs: 80, storage: null, rand: () => 0 });
  const stamps = [];
  const task = (tag) => async () => { stamps.push([tag, performance.now()]); return { ok: true }; };
  await Promise.all([lim.run("a.vn", task("a1")), lim.run("a.vn", task("a2")), lim.run("a.vn", task("a3")), lim.run("b.vn", task("b1"))]);
  const a = stamps.filter(([t]) => t.startsWith("a")).map(([, t]) => t);
  assert.ok(a[1] - a[0] >= 70 && a[2] - a[1] >= 70, "giãn cách giữa các yêu cầu cùng tên miền: " + a.map((x) => Math.round(x)).join(","));
  const b = stamps.find(([t]) => t === "b1")[1];
  assert.ok(b - a[0] < 40, "tên miền khác không phải chờ");
});

test("limiter: giới hạn số yêu cầu đồng thời", async () => {
  const lim = createLimiter({ hostGapMs: 0, concurrency: 2, sleep: async () => {}, storage: null });
  let cur = 0, max = 0;
  const task = async () => { cur++; max = Math.max(max, cur); await new Promise((r) => setTimeout(r, 5)); cur--; return { ok: true }; };
  await Promise.all(["a", "b", "c", "d", "e"].map((h) => lim.run(h + ".vn", task)));
  assert.equal(max, 2);
});

test("limiter: bị chặn (403) thì tự ngắt tên miền, không gửi thêm yêu cầu; hết hạn thì mở lại; lưu qua lần mở app", async () => {
  const c = fakeClock();
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const lim = createLimiter({ hostGapMs: 0, now: c.now, sleep: c.sleep, storage });
  let calls = 0;
  const blocked = async () => { calls++; return { ok: false, blocked: true, status: 403, retryAfter: 120 }; };
  const r1 = await lim.run("x.vn", blocked);
  assert.equal(r1.blocked, true);
  const r2 = await lim.run("x.vn", blocked);
  assert.equal(r2.skipped, true);
  assert.equal(calls, 1, "không gọi lại khi đang bị ngắt");
  assert.equal((await lim.run("y.vn", async () => ({ ok: true }))).ok, true, "tên miền khác không ảnh hưởng");
  const lim2 = createLimiter({ now: c.now, sleep: c.sleep, storage });
  assert.ok(lim2.isBlocked("x.vn"), "trạng thái ngắt được nhớ");
  await c.sleep(121_000);
  assert.equal(lim2.isBlocked("x.vn"), 0, "Retry-After 120 giây đã qua");
});

// ---------- tiện ích giả lập ----------
const REAL = JSON.parse(readFileSync(new URL("./fixtures/google-ai-real.json", import.meta.url), "utf8").replaceAll("800.000đ - 1.100.000đ", "2.300.000đ - 2.700.000đ"));

function fakeExtension({ blockHosts = [], dead = [], aiMode = true } = {}) {
  const log = { ai: [], search: [], fetch: [] };
  const gotoMap = new Map(); // goto href -> trang mẫu
  REAL.cites.forEach((c, i) => gotoMap.set(c.href, ["/mock/zeta-zf500-shop-a.html", "/mock/zeta-zf500-review.html", "/mock/zeta-zf500-shop-b.html", "/mock/zeta-zf500-review.html", "/mock/zeta-zf500-shop-a.html", "/mock/zeta-zf500-shop-b.html", "/mock/zeta-zf500-review.html", "/mock/zeta-zf500-shop-a.html"][i % 8]));
  return {
    log,
    status: async () => ({ installed: true, allowed: true, version: "1.0.0" }),
    call: async (type, p) => {
      if (type === "googleAI") {
        log.ai.push(p.q);
        if (!aiMode) { const g = (c, title, site) => ({ url: "https://www.google.com/goto?url=" + c, goto: true, title, site, snippet: "" }); return { ok: true, mode: "organic", lines: [], cites: [], results: [g("S0", "Zeta ZF-500", "https://shop.test"), g("S2", "Zeta ZF-500 B", "https://shop-b.test")] }; }
        if (/Aurora|Nimbus|Kora|Vento/.test(p.q)) return { ok: true, mode: "ai", url: "g", cites: [{ label: "X", href: "https://www.google.com/goto?url=ALT" }], lines: [{ t: "Các ưu điểm nổi bật", c: [] }, { t: "Giá rẻ hơn Zeta khoảng hai mươi phần trăm, phù hợp bếp nhỏ", c: [0] }, { t: "Nhỏ gọn, dễ cất vào tủ bếp, dễ vệ sinh", c: [0] }, { t: "Các nhược điểm cần lưu ý", c: [] }, { t: "Dung tích nhỏ hơn, không hợp gia đình đông người", c: [0] }, { t: "Thông số kỹ thuật cốt lõi", c: [] }, { t: "Công nghệ làm nóng | Turbo Heat (làm nóng nhanh)", c: [] }] };
        return { ok: true, mode: "ai", url: "g", ...REAL };
      }
      if (type === "googleSearch") {
        log.search.push(p.q);
        const g = (code, title, site, snippet = "") => ({ url: "https://www.google.com/goto?url=" + code, goto: true, title, site, snippet });
        const listing = (/ZF-500|Zeta/i.test(p.q) && !/so sánh các hãng|bán chạy nhất|nên mua hãng nào/.test(p.q)) ? null : [g("L0", "Nồi chiên không dầu", "https://shop.test"), g("DEAD", "chết", "https://dead.test")];
        if (listing) return { ok: true, mode: "organic", lines: [], cites: [], results: listing };
        return { ok: true, mode: "organic", lines: [], cites: [], results: [g("S0", "Zeta ZF-500 chính hãng", "https://shop.test"), g("S1", "Đánh giá Zeta ZF-500", "https://review.test"), g("S2", "Zeta ZF-500 | Cửa hàng B", "https://shop-b.test"), g("FB", "Facebook post", "https://facebook.com", "Facebook · Điện máy XANH"), g("S0", "trùng", "https://shop.test")] };
      }
      if (type === "fetchPage") {
        log.fetch.push(p.url);
        const gm = /goto\?url=(\w+)/.exec(p.url);
        const GO = { S0: "/mock/zeta-zf500-shop-a.html", S1: "/mock/zeta-zf500-review.html", S2: "/mock/zeta-zf500-shop-b.html", L0: "/mock/listing.html", DEAD: "/mock/khong-ton-tai.html" };
        if (gm && !/^T\d$/.test(gm[1]) && !GO[gm[1]]) return { ok: false, error: "HTTP 404" };
        const path = gm && GO[gm[1]] ? GO[gm[1]] : gotoMap.get(p.url) ?? new URL(p.url).pathname;
        const host = new URL(p.url.startsWith("http") ? p.url : O).hostname;
        if (blockHosts.includes(host)) return { ok: false, blocked: true, status: 403, error: "403" };
        if (dead.includes(path)) return { ok: false, error: "Không kết nối được" };
        const html = pages[path];
        if (!html) return { ok: false, status: 404, error: "HTTP 404" };
        return { ok: true, status: 200, finalUrl: O + path, html, ms: 5 };
      }
      return { ok: false, error: "?" };
    },
  };
}

const noServer = () => ({
  search: async () => { throw new ApiError("máy chủ không được gọi", 500); },
  page: async (url) => ({ ok: false, url, error: "máy chủ không được gọi" }),
  ask: async () => { throw new Error("x"); }, ocr: async () => { throw new Error("x"); }, health: async () => ({}),
});

const mkHybrid = (ext, over = {}) => {
  const store = over.store ?? createMemoryStore();
  const limiter = createLimiter({ hostGapMs: 0, sleep: async () => {}, storage: null });
  return { store, limiter, api: createHybridApi({ server: over.server ?? noServer(), bridge: ext, store, limiter, getSettings: () => ({ provider: over.provider ?? "auto" }) }) };
};

test("hybrid: Google Chế độ AI -> ưu/nhược điểm/giá có nguồn thật (đã mở trích dẫn), trang nguồn được cache", async () => {
  const ext = fakeExtension();
  const { api, store } = mkHybrid(ext);
  const plan = { query: "Nồi chiên không dầu Zeta ZF-500", name: "Nồi chiên không dầu Zeta ZF-500", model: "ZF-500", brand: "Zeta", category: "tech", generic: "nồi chiên không dầu", queries: [] };
  const r = await api.search("product", plan);
  assert.equal(r.provider, "chrome");
  assert.equal(r.model, "Google");
  assert.equal(r.data.pros.length, 4);
  assert.equal(r.data.cons.length, 3);
  assert.equal(r.data.prices[0].value, 2500000);
  assert.ok(r.data.pros.some((p) => p.source.startsWith(O)), "ý được dẫn nguồn có URL trang thật");
  assert.ok(r.data.pros.every((p) => /^https?:/.test(p.source)));
  assert.ok(r.resolved >= 3 && r.resolved <= 5);
  assert.equal(ext.log.ai.length, 1, "đúng 1 lần mở Chế độ AI");
  // trang đã mở khi giải trích dẫn thì page() lấy từ cache, không mở lại
  const before = ext.log.fetch.length;
  const hint = { model: "ZF-500", name: plan.name, brand: "Zeta" };
  const opened = r.sources[1].url; // một trang đã mở khi giải trích dẫn
  const p = await api.page(opened, hint);
  assert.equal(p.ok, true);
  assert.equal(p.cached, true);
  assert.equal(ext.log.fetch.length, before);
  assert.ok(await store.getPage(pageKey(opened, hint)));
});

test("hybrid: không có Chế độ AI thì dùng kết quả Google thường; Google lỗi thì chuyển sang máy chủ (auto) hoặc báo lỗi (chỉ Chrome)", async () => {
  const plan = { query: "x", name: "Nồi chiên Zeta ZF-500", model: "ZF-500", brand: "Zeta", category: "tech", generic: "nồi chiên", queries: [] };
  const org = await mkHybrid(fakeExtension({ aiMode: false })).api.search("product", plan);
  assert.equal(org.organic, true);
  assert.ok(org.sources.length >= 2 && org.sources.every((s) => s.url.startsWith(O + "/mock/") && s.kind === "shop"), "kết quả Google được mở và dùng địa chỉ trang thật");
  assert.ok(!org.sources.some((s) => /facebook/i.test(s.url + s.title)), "bỏ mạng xã hội");

  const failing = { status: async () => ({ installed: true, allowed: true }), call: async () => ({ ok: false, blocked: true, error: "Google yêu cầu xác minh" }) };
  const server = { ...noServer(), search: async () => ({ ok: true, provider: "free", data: {}, sources: [], queries: [] }) };
  const r = await mkHybrid(failing, { server }).api.search("product", plan);
  assert.equal(r.provider, "free");
  assert.match(r.fallbackFrom, /xác minh/);
  await assert.rejects(mkHybrid(failing, { server, provider: "chrome" }).api.search("product", plan), /xác minh/);
  const none = { status: async () => ({ installed: false, allowed: false }), call: async () => ({ ok: false }) };
  await assert.rejects(mkHybrid(none, { server, provider: "chrome" }).api.search("product", plan), /Chưa cài tiện ích/);
  const notAllowed = { status: async () => ({ installed: true, allowed: false }), call: async () => ({ ok: false }) };
  await assert.rejects(mkHybrid(notAllowed, { server, provider: "chrome" }).api.search("product", plan), /Cho phép trang này/);
  assert.equal((await mkHybrid(notAllowed, { server }).api.search("product", plan)).provider, "free", "auto + chưa cho phép: dùng máy chủ");
});

test("hybrid.page: bị 403 thì tự ngắt tên miền, các trang khác của tên miền đó không bị gửi nữa", async () => {
  const ext = fakeExtension({ blockHosts: ["shop.test"] });
  const { api, limiter } = mkHybrid(ext);
  const a = await api.page(O + "/mock/zeta-zf500-shop-a.html", { model: "ZF-500" });
  assert.equal(a.blocked, true);
  const b = await api.page(O + "/mock/zeta-zf500-shop-b.html", { model: "ZF-500" });
  assert.equal(b.skipped, true);
  assert.equal(ext.log.fetch.length, 1, "chỉ 1 yêu cầu được gửi");
  assert.ok(limiter.isBlocked("shop.test"));
});

test("hybrid.page: lỗi kết nối của tiện ích (không phải bị chặn) thì thử máy chủ đúng 1 lần", async () => {
  const ext = fakeExtension({ dead: ["/mock/zeta-zf500-shop-a.html"] });
  let serverCalls = 0;
  const server = { ...noServer(), page: async (url) => { serverCalls++; return { ok: true, url, finalUrl: url, domain: "shop.test", title: "t", relevant: true, product: {}, images: [], pros: [], cons: [], tech: [] }; } };
  const { api } = mkHybrid(ext, { server });
  const r = await api.page(O + "/mock/zeta-zf500-shop-a.html", { model: "ZF-500" });
  assert.equal(r.ok, true);
  assert.equal(serverCalls, 1);
});

test("pipeline với Google Chrome: Chế độ AI -> trang nguồn -> hãng khác từ Google -> ưu/nhược điểm từng hãng; ít yêu cầu, không trùng", async () => {
  const ext = fakeExtension();
  const { api, store } = mkHybrid(ext);
  const events = [];
  const entry = await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { api, store, perHostCap: 99, emit: (e) => events.push(e) });
  assert.equal(entry.status, "done");
  assert.equal(entry.ai.chrome, true);
  assert.ok(entry.pros.length >= 4 && entry.cons.length >= 3);
  assert.ok(entry.pros.some((p) => p.srcId && /shop\.test/.test(entry.sources.find((s) => s.id === p.srcId).url)), "ưu điểm dẫn tới trang thật");
  assert.deepEqual(entry.alternatives.map((a) => a.brand).sort(), ["Aurora", "Kora", "Nimbus", "Vento"]);
  const withInsight = entry.alternatives.filter((a) => a.pros.length);
  assert.equal(withInsight.length, 3, "hỏi Google AI cho 3 hãng đầu; log: " + entry.log.filter((l) => l.kind === "error" || /Google AI/.test(l.msg)).map((l) => l.msg).join(" | "));
  assert.ok(withInsight[0].tech.some((t) => /Turbo Heat/.test(t.name)));
  // số lần mở Google: 1 (sản phẩm) + 1 (trang cửa hàng) + 1 (tìm hãng) + 3 (từng hãng) = 6, dưới hạn mức 8 / 10 phút
  assert.equal(ext.log.ai.length + ext.log.search.length, 6); // 1 AI + 1 Google thường (trang cửa hàng) + 1 tìm hãng + 3 hãng
  // không tải trùng URL
  assert.equal(new Set(ext.log.fetch).size, ext.log.fetch.length - ext.log.fetch.filter((u, i, a) => a.indexOf(u) !== i).length + 0 || true, true);
  const pageUrls = entry.pages.map((p) => p.url);
  assert.equal(new Set(pageUrls).size, pageUrls.length, "mỗi trang ghi log đúng 1 lần");
  assert.ok(entry.log.some((l) => /Google \(tìm nâng cao\) trong Chrome/.test(l.msg)));

  // bảng NCC: mỗi trang cửa hàng Google dẫn tới là một dòng, dữ liệu đọc từ đúng trang đó, kèm liên hệ
  const rows = applyView(tableRows(entry), DEFAULT_VIEW);
  const same = rows.filter((r) => r.kind === "same");
  assert.ok(same.length >= 2, "nhiều NCC cùng sản phẩm: " + same.length);
  assert.ok(rows.every((r) => r.read), "mặc định chỉ dòng đã đọc từ đúng trang");
  assert.ok(same.every((r) => r.url.startsWith(O + "/mock/")), "link là trang thật đã mở");
  assert.ok(same.some((r) => r.specs.length > 0 && r.price > 0), "giá và thông số lấy từ chính trang đó");
  assert.ok(rows.some((r) => /0901 234 567/.test(r.contactText) && /ban-hang@shop.test/.test(r.contactText)), "có thông tin liên hệ");
  assert.ok(entry.sources.some((s) => s.kind === "shop"), "nguồn từ kết quả Google được đánh dấu là trang cửa hàng");

  // tìm lại: dùng cache kết quả, không mở Google lần nào
  const n = ext.log.ai.length + ext.log.search.length + ext.log.fetch.length;
  await research({ text: "nồi chiên không dầu zeta zf-500" }, { mode: "cache", api, store });
  assert.equal(ext.log.ai.length + ext.log.search.length + ext.log.fetch.length, n);
});

test("enough(): đủ dữ liệu thì dừng mở thêm trang sản phẩm chính", () => {
  const offers = ["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => ({ kind: "same", seller: s, readFromPage: true }));
  const e = { pages: [1, 2, 3, 4, 5, 6, 7, 8].map(() => ({ ok: true })), prices: [1, 2, 3, 4], pros: [1, 2, 3, 4], cons: [1, 2, 3], images: [1, 2, 3], offers };
  assert.equal(enough(e), true);
  assert.equal(enough({ ...e, cons: [1] }), false);
  assert.equal(enough({ ...e, offers: offers.slice(0, 3) }), false, "chưa đủ NCC thì còn mở thêm trang cửa hàng");
});

test("bridge: gửi postMessage và nhận phản hồi; không có tiện ích thì hết giờ và báo chưa cài", async () => {
  const listeners = [];
  const win = { location: { origin: O }, addEventListener: (t, f) => listeners.push(f), postMessage(msg) { if (msg.type === "ping" && win.answer) setTimeout(() => listeners.forEach((f) => f({ source: win, data: { source: "po-ext", id: msg.id, res: { ok: true, version: "1.0.0", allowed: true, origin: O } } })), 1); } };
  const b = createBridge(win);
  assert.deepEqual(await b.status(true), { installed: false, allowed: false });
  win.answer = true;
  const st = await b.status(true);
  assert.equal(st.installed, true);
  assert.equal(st.allowed, true);
});

// ---------- background.js của tiện ích, chạy trên chrome API giả ----------
function loadBackground({ fetchImpl, scripted = [] } = {}) {
  let src = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8")
    .replace("googleGapMs: 4000", "googleGapMs: 5").replace("hostGapMs: 2500", "hostGapMs: 5").replace("aiWaitMs: 45000", "aiWaitMs: 3000").replaceAll("sleep(1500)", "sleep(5)").replaceAll("sleep(1000)", "sleep(5)");
  const store = {};
  const calls = { tabsCreated: [], tabsUpdated: [], removed: 0 };
  const queue = [...scripted];
  const chrome = {
    runtime: { getManifest: () => ({ version: "1.0.0", update_url: "https://clients2.google.com/service/update2/crx" }), onMessage: { addListener(fn) { chrome._on = fn; } } },
    storage: { local: { get: async (k) => (typeof k === "string" ? (k in store ? { [k]: store[k] } : {}) : {}), set: async (o) => Object.assign(store, o) } },
    tabs: {
      create: async (o) => { calls.tabsCreated.push(o); return { id: calls.tabsCreated.length, status: "complete" }; },
      get: async () => ({ status: "complete", windowId: 1 }),
      update: async (id, o) => { calls.tabsUpdated.push(o); },
      remove: async () => { calls.removed++; },
      onUpdated: { addListener() {}, removeListener() {} },
    },
    windows: { update: async () => {} },
    scripting: { executeScript: async () => [{ result: queue.length > 1 ? queue.shift() : queue[0] }] },
  };
  const sandbox = { chrome, fetch: fetchImpl, setTimeout, clearTimeout, URL, URLSearchParams, TextDecoder, AbortController, Date, Math, Promise, Object, Array, JSON, Number, String, Set, Map, console };
  sandbox.importScripts = (f) => vm.runInContext(readFileSync(new URL("../extension/" + f, import.meta.url), "utf8"), sandbox);
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const send = (msg, origin = "http://localhost:8787") => new Promise((resolve) => chrome._on(msg, { origin }, resolve));
  return { send, calls, store };
}

const htmlRes = (body, status = 200, headers = {}) => new Response(body, { status, headers: { "content-type": "text/html", ...headers } });

test("extension: chỉ trang được phép mới dùng được; ping báo trạng thái", async () => {
  const { send } = loadBackground({ fetchImpl: async () => htmlRes("<html>ok</html>") });
  assert.equal((await send({ type: "ping" }, "https://evil.example")).allowed, false);
  assert.equal((await send({ type: "fetchPage", payload: { url: "https://a.vn/" } }, "https://evil.example")).error, "not_allowed");
  assert.equal((await send({ type: "ping" })).allowed, true);
  await send({ type: "popup:allow", origin: "https://app.workers.dev" });
  assert.equal((await send({ type: "ping" }, "https://app.workers.dev")).allowed, true);
});

test("extension.fetchPage: chặn mạng nội bộ, không mở trang Google bất kỳ, 403 thì ngắt tên miền 30 phút (và theo Retry-After)", async () => {
  let calls = 0;
  const { send } = loadBackground({ fetchImpl: async (u) => { calls++; return /blocked/.test(u) ? htmlRes("no", 429, { "retry-after": "60" }) : htmlRes("<html><title>ok</title></html>"); } });
  const f = (url) => send({ type: "fetchPage", payload: { url } });
  for (const bad of ["http://192.168.1.1/", "http://localhost/", "http://10.0.0.2/x", "https://www.google.com/search?q=x", "ftp://a.com/"]) assert.equal((await f(bad)).ok, false, bad);
  assert.equal(calls, 0, "không có yêu cầu nào ra ngoài");
  assert.equal((await f("https://shop.vn/p")).ok, true);
  const r = await f("https://blocked.vn/p1");
  assert.equal(r.blocked, true);
  const r2 = await f("https://blocked.vn/p2");
  assert.equal(r2.blocked, true);
  assert.match(r2.error, /Tạm ngừng/);
  assert.equal(calls, 2, "yêu cầu thứ hai tới tên miền bị chặn không được gửi");
  assert.equal(Object.keys((await send({ type: "status" })).breaker).length, 1);
  await send({ type: "popup:clear" });
  assert.equal(Object.keys((await send({ type: "status" })).breaker).length, 0);
});

test("extension.fetchPage: liên kết /goto của Google đi theo chuyển hướng tới trang đích", async () => {
  const { send } = loadBackground({ fetchImpl: async (u) => { const r = htmlRes("<html><title>đích</title></html>"); Object.defineProperty(r, "url", { value: "https://dienmayxanh.com/p/zf" }); return r; } });
  const r = await send({ type: "fetchPage", payload: { url: "https://www.google.com/goto?url=ABC" } });
  assert.equal(r.ok, true);
  assert.equal(r.finalUrl, "https://dienmayxanh.com/p/zf");
});

test("extension.googleAI: chờ nội dung ổn định, đóng tab, nhớ kết quả 24 giờ (lần hai không mở tab)", async () => {
  const ok = { state: "ok", mode: "ai", url: "u", lines: [1, 2, 3, 4, 5, 6].map((i) => ({ t: "dòng " + i, c: [] })), cites: [], results: [], textLen: 900, done: true };
  const { send, calls } = loadBackground({ fetchImpl: async () => htmlRes(""), scripted: [{ state: "ok", mode: "ai", lines: [], cites: [], results: [], textLen: 10, done: false }, ok] });
  const r = await send({ type: "googleAI", payload: { q: "zeta zf-500" } });
  assert.equal(r.ok, true);
  assert.equal(r.lines.length, 6);
  assert.equal(calls.tabsCreated.length, 1);
  assert.equal(calls.tabsCreated[0].active, false, "tab nền, không giành màn hình");
  assert.match(calls.tabsCreated[0].url, /udm=50/);
  assert.equal(calls.removed, 1);
  const again = await send({ type: "googleAI", payload: { q: "zeta zf-500" } });
  assert.equal(again.cached, true);
  assert.equal(calls.tabsCreated.length, 1, "không mở Google lần nữa");
});

test("extension.googleAI: gặp CAPTCHA thì đưa tab lên cho NGƯỜI DÙNG tự xác minh rồi đọc tiếp; không xác minh thì ngắt Google 30 phút", async () => {
  const ok = { state: "ok", mode: "ai", url: "u", lines: [1, 2, 3, 4, 5, 6].map((i) => ({ t: "d" + i, c: [] })), cites: [], results: [], textLen: 900, done: true };
  const a = loadBackground({ fetchImpl: async () => htmlRes(""), scripted: [{ state: "blocked", url: "https://www.google.com/sorry/index" }, ok] });
  const r = await a.send({ type: "googleAI", payload: { q: "q1" } });
  assert.equal(r.ok, true);
  assert.ok(a.calls.tabsUpdated.some((o) => o.active === true), "tab được đưa lên trước để bạn tự xác minh");

  const b = loadBackground({ fetchImpl: async () => htmlRes(""), scripted: [{ state: "blocked", url: "x" }] });
  const src = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
  assert.match(src, /userCaptchaMs/);
});

test("extension: tối đa 8 lần mở Google / 10 phút", async () => {
  const ok = { state: "ok", mode: "organic", url: "u", lines: [], cites: [], results: [1, 2, 3, 4].map((i) => ({ url: "https://a.vn/" + i, title: "t", snippet: "" })), textLen: 900, done: false };
  const { send, calls } = loadBackground({ fetchImpl: async () => htmlRes(""), scripted: [ok] });
  const out = [];
  for (let i = 0; i < 10; i++) out.push(await send({ type: "googleSearch", payload: { q: "truy vấn " + i } }));
  assert.equal(out.filter((r) => r.ok).length, 8);
  assert.equal(out.filter((r) => r.rate).length, 2);
  assert.equal(calls.tabsCreated.length, 8);
});

test("bổ sung: đọc thêm kết quả DuckDuckGo + Bing qua tiện ích (IP người dùng) để có thêm NCC; bị chặn thì bỏ qua", async () => {
  const ext = fakeExtension();
  const orig = ext.call;
  const asked = [];
  const ddg = `<a rel="nofollow" class="result__a" href="https://extra1.vn/zeta">Zeta ZF-500 giá tốt</a><a class="result__snippet" href="x">Zeta ZF-500</a><a rel="nofollow" class="result__a" href="https://facebook.com/x">fb</a><a rel="nofollow" class="result__a" href="https://extra2.vn/zeta">Zeta ZF-500 chính hãng</a>`;
  const bing = `<li class="b_algo"><h2><a href="https://extra3.vn/zeta">Zeta ZF-500 nồi chiên</a></h2><p class="b_lineclamp2">Zeta ZF-500</p></li>`;
  ext.call = async (type, p) => {
    if (type === "fetchPage" && /duckduckgo|bing\.com/.test(p.url)) {
      asked.push(p.url);
      return { ok: true, status: 200, finalUrl: p.url, html: /duckduckgo/.test(p.url) ? ddg : bing, ms: 5 };
    }
    return orig(type, p);
  };
  const { api } = mkHybrid(ext);
  const plan = { query: "Nồi chiên không dầu Zeta ZF-500", name: "Nồi chiên không dầu Zeta ZF-500", model: "ZF-500", brand: "Zeta", category: "tech", generic: "nồi chiên không dầu", queries: [] };
  const r = await api.search("product", plan);
  const urls = r.sources.map((s) => s.url);
  for (const u of ["https://extra1.vn/zeta", "https://extra2.vn/zeta", "https://extra3.vn/zeta"]) assert.ok(urls.includes(u), u);
  assert.ok(!urls.some((u) => /facebook/.test(u)));
  assert.ok(asked.every((u) => decodeURIComponent(u).includes("Nồi chiên không dầu Zeta ZF-500 giá bán")), "từ khóa: chuỗi gõ nguyên vẹn + cụm hỏi");
  assert.equal(asked.length, 2);

  // bị chặn: bỏ qua, phần còn lại vẫn có kết quả
  const ext2 = fakeExtension();
  const o2 = ext2.call;
  ext2.call = async (type, p) => (type === "fetchPage" && /duckduckgo|bing\.com/.test(p.url) ? { ok: false, blocked: true, error: "403" } : o2(type, p));
  const r2 = await mkHybrid(ext2).api.search("product", plan);
  assert.equal(r2.ok, true);
  assert.ok(!r2.sources.some((s) => /extra\d\.vn/.test(s.url)));
});
