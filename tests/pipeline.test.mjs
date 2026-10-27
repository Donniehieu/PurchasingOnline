// Chạy toàn bộ luồng: pipeline -> API (handler thật, AI mẫu) -> đọc trang mẫu -> cache -> hỏi đáp.
import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../worker/index.js";
import { mockPages } from "../dev/mock-pages.mjs";
import { createApi } from "../web/js/lib/api.js";
import { research, ask, pickPages } from "../web/js/lib/pipeline.js";
import { createMemoryStore } from "../web/js/lib/store.js";
import { summarize, recommend, logBySection } from "../web/js/lib/aggregate.js";

const ORIGIN = "http://localhost:8787";
const pages = mockPages(ORIGIN);
const env = { MOCK: "1", ALLOW_LOCAL: "1" };
let fetched = [];

// fetch giả: /api/* chuyển cho handler thật; /mock/* trả trang mẫu; còn lại báo lỗi mạng
const realFetch = globalThis.fetch;
function fakeFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const u = new URL(url);
  if (u.pathname.startsWith("/api/")) return handle(new Request(url, init), env);
  if (u.pathname.startsWith("/mock/img/")) return Promise.resolve(new Response("png", { headers: { "content-type": "image/png" } }));
  fetched.push(u.pathname);
  const html = pages[u.pathname];
  if (!html) return Promise.resolve(new Response("nf", { status: 404 }));
  return Promise.resolve(new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }));
}
test.before(() => { globalThis.fetch = fakeFetch; });
test.after(() => { globalThis.fetch = realFetch; });

const api = createApi(() => ({ apiBase: ORIGIN }), fakeFetch);

test("research: AI trước, mở trang nguồn, ghi log từng trang, lưu cache", async () => {
  const store = createMemoryStore();
  const events = [];
  const entry = await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api, store, emit: (e) => events.push(e) });

  assert.equal(entry.status, "done");
  assert.equal(entry.product.brand, "Zeta");
  assert.equal(entry.category, "tech");
  assert.equal(entry.alternatives.length, 4);
  assert.ok(entry.ai.mock);

  const ids = events.filter((e) => e.type === "step").map((e) => e.id);
  assert.ok(ids.indexOf("product") < ids.indexOf("compare") && ids.indexOf("compare") < ids.indexOf("pages"));
  assert.ok(events.filter((e) => e.type === "entry").length >= 6, "giao diện nhận cập nhật từng bước");

  // log từng trang đã mở, kể cả trang hỏng bị bỏ qua
  assert.ok(entry.pages.length >= 5);
  assert.ok(entry.pages.some((p) => !p.ok && /404/.test(p.error)), "trang 404 bị bỏ qua và ghi log");
  assert.ok(entry.log.filter((l) => l.kind === "page").length === entry.pages.length);

  // dữ liệu từ trang thật được gộp: giá, ảnh, ưu/nhược điểm
  const s = summarize(entry);
  assert.ok(s.price.count >= 3);
  assert.ok(s.price.median >= 2390000 && s.price.median <= 2550000);
  assert.ok(entry.images.length >= 2);
  assert.ok(entry.pros.some((p) => p.via === "page"));
  assert.ok(entry.alternatives.every((a) => a.price > 0));
  assert.ok(entry.alternatives.some((a) => a.images.length));
  const sec = logBySection(entry);
  assert.ok(sec.price.length && sec.pros.length && sec.images.length);

  // nguồn chưa kiểm chứng (không có trong kết quả tìm kiếm) được đánh dấu
  assert.ok(entry.sources.some((x) => x.verified === false && /example\.org/.test(x.url)));

  const rec = recommend(entry);
  assert.equal(rec.rows.length, 5);
  assert.ok(rec.best && rec.reasons.length);

  assert.equal((await store.get(entry.key)).status, "done");
});

test("lần hỏi lại cùng sản phẩm dùng cache, không gọi AI hay mở trang", async () => {
  const store = createMemoryStore();
  await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api, store });
  const before = fetched.length;
  let apiCalls = 0;
  const spy = { ...api, search: (...a) => { apiCalls++; return api.search(...a); }, page: (...a) => { apiCalls++; return api.page(...a); } };
  const events = [];
  const again = await research({ text: "nồi chiên  không dầu zeta zf-500" }, { mode: "cache", perHostCap: 99, api: spy, store, emit: (e) => events.push(e) });
  assert.equal(apiCalls, 0);
  assert.equal(fetched.length, before);
  assert.ok(events.some((e) => e.type === "step" && e.id === "product" && e.status === "skip"));
  assert.equal(again.status, "done");
});

test("hỏi đáp: câu hỏi chuẩn lấy từ cache có nguồn; câu tự do qua AI chỉ với dữ liệu cache", async () => {
  const store = createMemoryStore();
  const entry = await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api, store });
  const price = await ask(entry, "giá trung bình bao nhiêu", { api });
  assert.equal(price.via, "cache");
  assert.match(price.text, /₫/);
  assert.match(price.text, /\[\d+\]/);
  const cons = await ask(entry, "nhược điểm?", { api });
  assert.match(cons.text, /ồn/);
  const free = await ask(entry, "bảo hành mấy tháng", { api });
  assert.equal(free.via, "ai");
  assert.ok(free.text.length > 10);
});

test("dừng giữa chừng giữ phần dữ liệu đã có", async () => {
  const store = createMemoryStore();
  const ctl = new AbortController();
  const events = [];
  await assert.rejects(
    research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api, store, signal: ctl.signal, emit: (e) => { events.push(e); if (e.type === "step" && e.id === "compare" && e.status === "done") ctl.abort(); } }),
    (e) => e.name === "AbortError"
  );
  const saved = (await store.list())[0];
  assert.equal(saved.status, "partial");
  assert.ok(saved.prices.length >= 3);
});

test("pickPages ưu tiên trang AI trích dẫn, giới hạn số trang và bỏ mạng xã hội", async () => {
  const store = createMemoryStore();
  const entry = await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api, store });
  entry.sources.push({ id: 99, key: "facebook.com/x", url: "https://facebook.com/x", domain: "facebook.com", title: "", via: "ai", verified: true });
  const picks = pickPages(entry, 6);
  assert.ok(picks.length <= 6);
  assert.ok(!picks.some((p) => /facebook/.test(p.url)));
});

test("API: sai mã truy cập bị từ chối, không khóa = chế độ miễn phí, SSRF bị chặn", async () => {
  const r1 = await handle(new Request(ORIGIN + "/api/search", { method: "POST", body: "{}" }), { APP_CODE: "abc" });
  assert.equal(r1.status, 401);
  const r2 = await handle(new Request(ORIGIN + "/api/ask", { method: "POST", body: JSON.stringify({ question: "x" }) }), {});
  assert.equal(r2.status, 501, "không có khóa = chế độ miễn phí, không có AI để hỏi tự do");
  const r3 = await handle(new Request(ORIGIN + "/api/page", { method: "POST", body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data" }) }), {});
  const j3 = await r3.json();
  assert.equal(j3.ok, false);
  assert.match(j3.error, /nội bộ/);
});
