// Chế độ miễn phí: tìm bằng DuckDuckGo/Bing (giả lập), tự mở trang, tìm hãng khác từ trang liệt kê.
import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../worker/index.js";
import { parseDuckDuckGo, parseBing, webSearch } from "../worker/websearch.js";
import { extractFacts } from "../web/js/lib/extract.js";
import { mockPages } from "../dev/mock-pages.mjs";
import { createApi } from "../web/js/lib/api.js";
import { research } from "../web/js/lib/pipeline.js";
import { createMemoryStore } from "../web/js/lib/store.js";
import { newEntry } from "../web/js/lib/entry.js";
import { summarize, recommend } from "../web/js/lib/aggregate.js";

const O = "http://localhost:8787";
const pages = mockPages(O);

const DDG = (items) => `<html><body>${items.map(([u, t, s]) => `<div class="result results_links"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(u)}&amp;rut=x">${t}</a></h2><a class="result__snippet" href="x">${s}</a></div>`).join("")}</body></html>`;

test("parseDuckDuckGo giải link bọc và lấy đoạn trích; parseBing giải link ck/a", () => {
  const r = parseDuckDuckGo(DDG([["https://shop.vn/a?x=1", "Nồi &amp; chiên", "Giá <b>2.490.000đ</b>"], ["https://b.vn/", "B", "s"]]));
  assert.equal(r.length, 2);
  assert.equal(r[0].url, "https://shop.vn/a?x=1");
  assert.equal(r[0].title, "Nồi & chiên");
  assert.match(r[0].snippet, /2\.490\.000đ/);
  const enc = Buffer.from("https://real.vn/p").toString("base64url");
  const b = parseBing(`<li class="b_algo" data-id><h2><a href="https://www.bing.com/ck/a?!&&p=1&u=a1${enc}&ntb=1">Tiêu đề</a></h2><div class="b_caption"><p>Mô tả giá 1.000.000đ</p></div></li>`);
  assert.equal(b[0].url, "https://real.vn/p");
  assert.match(b[0].snippet, /Mô tả/);
});

test("webSearch: DuckDuckGo bị chặn thì chuyển sang Bing, cả hai lỗi thì báo rõ", async () => {
  const bing = `<li class="b_algo"><h2><a href="https://x.vn/1">X</a></h2><p class="b_lineclamp2">mô tả</p></li>`;
  const f1 = async (u) => (String(u).includes("duckduckgo") ? new Response("anomaly challenge", { status: 202 }) : new Response(bing));
  const r = await webSearch("q", { fetchImpl: f1 });
  assert.equal(r.engine, "bing");
  assert.equal(r.results[0].url, "https://x.vn/1");
  const r2 = await webSearch("q", { fetchImpl: async () => new Response("", { status: 503 }) });
  assert.equal(r2.results.length, 0);
  assert.match(r2.error, /DuckDuckGo/);
});

test("parseDuckLite đọc link và đoạn trích; relevantTo loại kết quả rác", async () => {
  const { parseDuckLite, relevantTo } = await import("../worker/websearch.js");
  const html = `<tr><td><a rel="nofollow" href="https://shop.vn/a" class='result-link'>Nồi <b>chiên</b> SHD4030</a></td></tr><tr><td class='result-snippet'>Giá <b>1.190.000đ</b></td></tr><tr><td><a rel="nofollow" href="https://b.vn/" class='result-link'>B</a></td></tr>`;
  const r = parseDuckLite(html);
  assert.equal(r.length, 2);
  assert.equal(r[0].url, "https://shop.vn/a");
  assert.match(r[0].snippet, /1.190.000đ/);
  assert.equal(relevantTo("nồi chiên Sunhouse SHD4030 giá", { title: "Google Dịch", snippet: "", url: "https://translate.google.com/" }), false);
  assert.equal(relevantTo("nồi chiên Sunhouse SHD4030 giá", { title: "Nồi chiên Sunhouse SHD4030", snippet: "", url: "https://x.vn" }), true);
});

test("trang liệt kê: extractFacts trả danh sách sản phẩm (hãng, giá, ảnh)", () => {
  const f = extractFacts(pages["/mock/listing.html"], O + "/mock/listing.html", { name: "nồi chiên không dầu" });
  assert.equal(f.listing.length, 7);
  assert.equal(f.listing[1].brand, "Aurora");
  assert.equal(f.listing[1].price, 1990000);
  assert.ok(f.listing[1].image.endsWith("/4.png"));
});

// ---- luồng đầy đủ không AI ----
const realFetch = globalThis.fetch;
let searches = [];
function fakeFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const u = new URL(url);
  if (u.pathname.startsWith("/api/")) return handle(new Request(url, init), {});
  if (u.hostname === "html.duckduckgo.com") {
    const q = decodeURIComponent(String(init.body).split("&")[0].slice(2));
    searches.push(q);
    const items = q.includes("ZF-500") || q.includes("zf-500")
      ? [[O + "/mock/zeta-zf500-shop-a.html", "Zeta ZF-500 chính hãng", "Nồi chiên Zeta ZF-500. Giá 2.490.000đ"], [O + "/mock/zeta-zf500-review.html", "Đánh giá Zeta ZF-500", "Có đáng mua không"], [O + "/mock/zeta-zf500-shop-b.html", "Zeta ZF-500 | Cửa hàng B", "Giá ưu đãi"], [O + "/mock/aurora-af300.html", "Aurora AF-300", "không liên quan"]]
      : [[O + "/mock/listing.html", "Nồi chiên không dầu", "Danh sách"], [O + "/mock/khong-ton-tai.html", "Trang chết", "x"]];
    return Promise.resolve(new Response(DDG(items), { headers: { "content-type": "text/html" } }));
  }
  const html = pages[u.pathname];
  return Promise.resolve(html ? new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("nf", { status: 404 }));
}
test.before(() => { globalThis.fetch = fakeFetch; });
test.after(() => { globalThis.fetch = realFetch; });
const api = createApi(() => ({ apiBase: O, provider: "free" }), fakeFetch);
// handler dùng env rỗng nhưng cần cho phép trang cục bộ của bài test
const apiLocal = createApi(() => ({ apiBase: O, provider: "free" }), (u, i) => (new URL(u).pathname.startsWith("/api/") ? handle(new Request(u, i), { ALLOW_LOCAL: "1", SEARCH_GAP_MS: "0" }) : fakeFetch(u, i)));

test("không khóa AI: tìm miễn phí -> giá từ đoạn trích -> mở trang -> hãng khác từ trang liệt kê -> chọn tối ưu", async () => {
  const store = createMemoryStore();
  const events = [];
  const entry = await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, freeGapMs: 0, api: apiLocal, store, emit: (e) => events.push(e) });
  assert.equal(entry.status, "done");
  assert.equal(entry.ai.free, true);
  assert.ok(searches.some((q) => q.includes("ZF-500")), "tìm theo mã model");
  assert.ok(searches.some((q) => q.includes("nồi chiên không dầu") && !q.includes("ZF-500")), "tìm hãng khác theo tên loại");

  // giá: đoạn trích rồi được thay bằng giá đọc từ trang
  const s = summarize(entry);
  assert.ok(s.price.count >= 2);
  assert.ok(entry.prices.some((p) => p.via === "page"));
  // ưu/nhược điểm lấy từ trang đánh giá thật, không phải AI
  assert.ok(entry.pros.length >= 3 && entry.pros.every((p) => p.via === "page"));
  assert.ok(entry.cons.length >= 2);
  // trang không liên quan (Aurora) không đóng góp ưu/nhược điểm cho sản phẩm chính
  assert.ok(!entry.pros.some((p) => /Aurora/i.test(p.text)));

  // hãng khác: mỗi hãng một sản phẩm, loại phụ kiện giá lệch và hãng của sản phẩm chính
  const brands = entry.alternatives.map((a) => a.brand).sort();
  assert.deepEqual(brands, ["Aurora", "Kora", "Nimbus", "Vento"]);
  assert.equal(entry.alternatives.find((a) => a.brand === "Aurora").model, "AF-500", "chọn sản phẩm Aurora gần giá nhất, không phải phụ kiện 59.000đ");
  assert.ok(entry.alternatives.every((a) => a.price > 0 && a.images.length === 1));
  assert.ok(entry.pages.some((p) => !p.ok), "trang chết bị bỏ qua và ghi log");
  assert.equal(recommend(entry).rows.length, 5);

  // không mở lại một trang hai lần
  const urls = entry.pages.map((p) => p.url);
  assert.equal(new Set(urls).size, urls.length);
});

test("free: hỏi tự do báo rõ cần khóa Gemini; OCR báo rõ; công cụ tìm lỗi thì báo lỗi dễ hiểu", async () => {
  await assert.rejects(apiLocal.ask("bảo hành?", {}), (e) => e.status === 501 && /miễn phí/.test(e.message));
  await assert.rejects(apiLocal.ocr({ mime: "image/jpeg", data: "AAAA" }), (e) => e.status === 501);
  globalThis.fetch = async () => new Response("", { status: 503 });
  const r = await handle(new Request(O + "/api/search", { method: "POST", headers: { "x-ai-provider": "free" }, body: JSON.stringify({ task: "product", plan: { query: "abc", name: "abc", queries: ["abc"] } }) }), { SEARCH_GAP_MS: "0" });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /không trả kết quả/);
  globalThis.fetch = fakeFetch;
});

test("store.prune: xóa mục quá hạn và mục vượt số lượng, giữ mục mới nhất", async () => {
  const st = createMemoryStore();
  const mk = (k, ageDays) => { const e = newEntry({ category: "tech", name: k, model: "", brand: "", query: k }, k); e.updatedAt = Date.now() - ageDays * 864e5; return e; };
  for (const [k, d] of [["a", 1], ["b", 5], ["c", 40], ["d", 100]]) await st.put?.(mk(k, d)) ?? await st.save(mk(k, d));
  assert.equal(await st.prune({ days: 30 }), 2);
  assert.deepEqual((await st.list()).map((e) => e.key), ["a", "b"]);
  assert.equal(await st.prune({ days: 30, max: 1 }), 1);
  assert.deepEqual((await st.list()).map((e) => e.key), ["a"]);
});

test("dán link sản phẩm khi công cụ tìm kiếm bị chặn: vẫn đọc được trang, lấy tên, giá, ảnh, ưu/nhược điểm", async () => {
  const blocked = async (u, i) => (new URL(u).hostname.includes("duckduckgo") || new URL(u).hostname.includes("bing") ? new Response("anomaly challenge", { status: 202 }) : fakeFetch(u, i));
  globalThis.fetch = blocked;
  const a = createApi(() => ({ apiBase: O, provider: "free" }), (u, i) => (new URL(u).pathname.startsWith("/api/") ? handle(new Request(u, i), { ALLOW_LOCAL: "1", SEARCH_GAP_MS: "0" }) : blocked(u, i)));
  const store = createMemoryStore();
  const entry = await research({ text: O + "/mock/zeta-zf500-shop-a.html" }, { perHostCap: 99, freeGapMs: 0, api: a, store });
  globalThis.fetch = fakeFetch;
  assert.equal(entry.status, "done");
  assert.match(entry.product.name, /Zeta ZF-500/);
  assert.equal(entry.product.model, "ZF-500");
  assert.ok(entry.prices.some((p) => p.value === 2490000 && p.via === "page"));
  assert.ok(entry.pros.length >= 3);
  assert.ok(entry.images.length >= 1);
  assert.ok(entry.log.some((l) => l.kind === "error" && /xác minh/.test(l.msg)), "ghi log việc công cụ tìm kiếm bị chặn");
  assert.equal(entry.pages[0].url, O + "/mock/zeta-zf500-shop-a.html", "link người dùng dán được mở đầu tiên");
});

test("không có link, không có kết quả tìm: báo lỗi hướng dẫn dán link hoặc nhập khóa Gemini", async () => {
  const blocked = async (u, i) => (new URL(u).pathname.startsWith("/api/") ? handle(new Request(u, i), { SEARCH_GAP_MS: "0" }) : new Response("anomaly challenge", { status: 202 }));
  const a = createApi(() => ({ apiBase: O, provider: "free" }), blocked);
  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response("anomaly challenge", { status: 202 });
  await assert.rejects(research({ text: "Nồi chiên Zeta ZF-500" }, { perHostCap: 99, freeGapMs: 0, api: a, store: createMemoryStore() }), /dán link|Gemini/);
  globalThis.fetch = saved;
});
