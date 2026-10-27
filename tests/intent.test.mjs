// Kịch bản theo kiểu dữ liệu nhập, thẻ câu hỏi trước khi tìm, trang Next.js (WinMart), chế độ khám phá.
import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../worker/index.js";
import { mockPages } from "../dev/mock-pages.mjs";
import { createApi } from "../web/js/lib/api.js";
import { research } from "../web/js/lib/pipeline.js";
import { createMemoryStore } from "../web/js/lib/store.js";
import { analyzeInput, preCards, composeQuery, learnFromCache, detectType } from "../web/js/lib/intent.js";
import { extractFacts, embeddedProducts, packInfo } from "../web/js/lib/extract.js";
import { newEntry, ingestPage } from "../web/js/lib/entry.js";
import { makePlan } from "../web/js/lib/plan.js";
import { upsertOffer } from "../web/js/lib/offers.js";

const kind = (t, o) => { const a = analyzeInput(t, o); return `${a.scenario}/${a.sufficiency}/${a.mode}`; };

test("kịch bản 1: dữ liệu thô thiếu thông tin -> hỏi thẻ câu hỏi, bỏ qua thì chỉ khám phá", () => {
  assert.equal(kind("đồng hồ đo dầu"), "generic/insufficient/explore");
  assert.equal(kind("máy lọc nước"), "generic/insufficient/explore");
  assert.equal(kind("sữa vinamilk"), "branded/partial/explore");
  assert.equal(kind("quà tặng dưới 500k"), "need/insufficient/explore");
  assert.equal(kind("xyz"), "vague/insufficient/explore");
  const a = analyzeInput("đồng hồ đo dầu");
  assert.equal(a.needCards, true);
  assert.equal(a.type.id, "gauge");
});

test("kịch bản 2: đủ thông tin -> không hỏi, tìm thẳng và dựng bảng NCC", () => {
  assert.equal(kind("Sony WH-1000XM5"), "model/enough/full");
  assert.equal(kind("Máy lọc nước Kangaroo KG100A"), "model/enough/full");
  assert.equal(kind("Đồng Hồ Đo Áp LIGI Inox 316, Chân Sau Có Vành D63mm Ren 13mm"), "spec/enough/full");
  assert.equal(kind("sữa vinamilk growplus pha sẵn 110ml"), "spec/enough/full");
  assert.equal(kind("https://winmart.vn/products/vinamilk-sua-110ml--s10602909"), "url/enough/full");
  for (const t of ["Sony WH-1000XM5", "https://x.vn/p"]) assert.equal(analyzeInput(t).needCards, false);
});

test("thẻ câu hỏi: 3–5 thẻ theo loại hàng, bỏ câu đã trả lời trong chuỗi gõ, có câu ngân sách khi chưa có", () => {
  const cards = preCards(analyzeInput("đồng hồ đo dầu"));
  assert.ok(cards.length >= 3 && cards.length <= 5, "số thẻ " + cards.length);
  assert.ok(cards.some((c) => c.id === "size") && cards.some((c) => c.id === "budget"));
  assert.ok(!cards.some((c) => c.id === "measure"), "đã nói 'dầu' nên không hỏi đo đại lượng nào");
  const milk = preCards(analyzeInput("sữa vinamilk"));
  assert.ok(!milk.some((c) => c.id === "brand"), "đã có hãng thì không hỏi hãng");
  assert.ok(milk.some((c) => c.id === "volume"));
  const withBudget = preCards(analyzeInput("laptop dưới 15 triệu cho sinh viên"));
  assert.ok(!withBudget.some((c) => c.id === "budget"), "đã có ngân sách thì không hỏi lại");
  // chưa biết loại hàng: KHÔNG bắt chọn loại; dùng đúng chuỗi gõ, chỉ cho tự gõ thêm (bỏ qua được)
  const unk = preCards(analyzeInput("quà tặng dưới 500k"));
  assert.ok(!unk.some((c) => c.kind === "type"), "không hỏi loại sản phẩm");
  assert.equal(unk[0].id, "extra");
  assert.equal(unk[0].options.length, 0, "chỉ ô tự gõ");
  assert.equal(composeQuery("quà tặng dưới 500k", unk, { extra: { custom: "bình giữ nhiệt" } }), "quà tặng dưới 500k bình giữ nhiệt");
  assert.equal(composeQuery("quà tặng dưới 500k", unk, {}), "quà tặng dưới 500k", "bỏ qua thì giữ nguyên chuỗi gõ");
  assert.equal(preCards(analyzeInput("Sony WH-1000XM5")).length, 0, "đủ thông tin thì không có thẻ");
});

test("chuỗi tìm = chuỗi người dùng gõ + lựa chọn (giữ nguyên chữ gõ, không trùng lặp); thẻ nhu cầu không vào chuỗi tìm", () => {
  const a = analyzeInput("đồng hồ đo dầu");
  const cards = preCards(a);
  const q = composeQuery("đồng hồ đo dầu", cards, { size: { value: "D63", add: "D63mm" }, material: { value: "Inox 316", add: "Inox 316" }, budget: { value: "0:500000", add: "" } });
  assert.equal(q, "đồng hồ đo dầu D63mm Inox 316");
  assert.equal(composeQuery("đồng hồ đo dầu D63mm", cards, { size: { value: "D63", add: "D63mm" } }), "đồng hồ đo dầu D63mm", "đã có trong chuỗi gõ thì không thêm lại");
  assert.equal(composeQuery("đồng hồ đo dầu", cards, { size: { custom: "D80mm" } }), "đồng hồ đo dầu D80mm", "ô 'khác' tự nhập");
  assert.equal(composeQuery("đồng hồ đo dầu", cards, {}), "đồng hồ đo dầu");
  // trả lời đủ thì thành "đủ thông tin"
  const after = analyzeInput("đồng hồ đo dầu D63mm Inox 316 ren 13mm");
  assert.equal(after.mode, "full");
});

test("so sánh hai sản phẩm: hỏi tìm cái nào trước; nhận 'sữa' khác 'sửa'", () => {
  const a = analyzeInput("so sánh iPhone 15 với Samsung S24");
  assert.equal(a.scenario, "pair");
  const [c] = preCards(a);
  assert.deepEqual(c.options.map((o) => o.value), ["iPhone 15", "Samsung S24"]);
  assert.equal(composeQuery(a.typed, [c], { pick: { replace: "Samsung S24" } }), "Samsung S24");
  assert.equal(detectType("sữa tươi 110ml")?.type.id, "milk");
  assert.notEqual(detectType("sửa chữa tủ lạnh")?.type.id, "milk");
  assert.equal(detectType("sửa chữa tủ lạnh")?.type.id, "fridge");
});

test("thẻ câu hỏi học từ cache trên máy: hãng và thông số đã gặp của cùng loại hàng", () => {
  const e = newEntry(makePlan({ text: "Đồng hồ đo áp suất Wika" }), "k");
  e.product.brand = "Wika";
  upsertOffer(e, { kind: "same", name: "Đồng hồ áp Wika D80mm inox 316", model: "", brand: "Wika", price: 500000, priceVia: "page", readFromPage: true, url: "https://a.vn/p", seller: "a.vn", specs: [{ k: "Dải đo", v: "0-16 bar" }] });
  const hints = learnFromCache([e], "gauge");
  assert.ok(hints.brands.includes("Wika"));
  assert.ok(hints.facets.size.some((l) => /80/.test(l)));
  const cards = preCards(analyzeInput("đồng hồ đo dầu"), { hints });
  const size = cards.find((c) => c.id === "size");
  assert.ok(size.options[0].cached && /80/.test(size.options[0].label), "tuỳ chọn đã gặp đứng đầu");
  assert.deepEqual(learnFromCache([e], "milk"), { brands: [], facets: {} });
});

const NEXT = (p) => `<html><head><title>Sữa tươi tiệt trùng Vinamilk ít đường lốc 4 hộp x 110ml</title></head><body><div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { product: { name: "Sữa tươi tiệt trùng Vinamilk ít đường lốc 4 hộp x 110ml", sku: "10602909G4", price: p, salePrice: p, brandName: "VINAMILK", mediaItems: [{ mediaUrl: "https://img.test/a.jpg" }], uoms: [{ name: "x", price: 99999, sku: "other" }] } } } })}</script></body></html>`;

test("trang Next.js (WinMart): đọc giá, hãng, mã, ảnh từ __NEXT_DATA__; giá mỗi hộp theo quy cách lốc", () => {
  const prods = embeddedProducts(NEXT(21900));
  assert.equal(prods.length, 1, "không lấy các biến thể bên trong");
  const f = extractFacts(NEXT(21900), "https://winmart.vn/products/x", { model: "", name: "sữa tươi vinamilk ít đường 110ml", brand: "Vinamilk" });
  assert.equal(f.relevant, true);
  assert.deepEqual(f.product.price, { value: 21900, source: "jsonld" });
  assert.equal(f.product.brand, "VINAMILK");
  assert.equal(f.product.sku, "10602909G4");
  assert.equal(f.images[0].url, "https://img.test/a.jpg");
  assert.deepEqual(f.pack, { outer: "lốc", count: 4, unit: "hộp" });
  assert.deepEqual(packInfo("lốc 4 hộp x 110ml"), { outer: "lốc", count: 4, unit: "hộp" });
  assert.equal(packInfo("Sữa 110ml hộp"), null);
  const e = newEntry(makePlan({ text: "sữa tươi vinamilk ít đường 110ml" }), "kw");
  ingestPage(e, { ...f, ok: true, url: "https://winmart.vn/products/x", finalUrl: "https://winmart.vn/products/x" });
  assert.equal(e.offers[0].price, 21900);
  assert.equal(e.offers[0].pack.count, 4);
  assert.equal(embeddedProducts("<html></html>").length, 0);
});

// ---- chế độ khám phá chạy thật qua pipeline (AI mẫu) ----
const ORIGIN = "http://localhost:8787";
const pages = mockPages(ORIGIN);
const realFetch = globalThis.fetch;
function fakeFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const u = new URL(url);
  if (u.pathname.startsWith("/api/")) return handle(new Request(url, init), { MOCK: "1", ALLOW_LOCAL: "1" });
  if (u.pathname.startsWith("/mock/img/")) return Promise.resolve(new Response("png", { headers: { "content-type": "image/png" } }));
  const html = pages[u.pathname];
  return Promise.resolve(html ? new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("nf", { status: 404 }));
}
test.before(() => { globalThis.fetch = fakeFetch; });
test.after(() => { globalThis.fetch = realFetch; });
const api = createApi(() => ({ apiBase: ORIGIN }), fakeFetch);

test("kịch bản khám phá: mở ít trang hơn, không mở trang liên hệ, ghi entry.scenario; đủ thông tin thì 'full'", async () => {
  const explore = await research({ text: "Nồi chiên không dầu Zeta ZF-500", scenario: "explore" }, { perHostCap: 99, api, store: createMemoryStore(), pageLimit: 12 });
  assert.equal(explore.scenario, "explore");
  assert.ok(explore.pages.filter((p) => p.for !== "liên hệ").length <= 6, "tối đa 6 trang");
  assert.ok(!explore.pages.some((p) => p.for === "liên hệ"), "không mở trang liên hệ");
  const full = await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api, store: createMemoryStore() });
  assert.equal(full.scenario, "full");
  // đã có kết quả đầy đủ thì tìm lại ở chế độ khám phá không hạ cấp
  const store = createMemoryStore();
  await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api, store });
  const again = await research({ text: "Nồi chiên không dầu Zeta ZF-500", scenario: "explore" }, { perHostCap: 99, api, store });
  assert.equal(again.scenario, "full");
});

test("thiếu thông tin (khám phá): không tư vấn chọn, không NCC, không so sánh/báo giá; chỉ nội dung chung + nhắc bổ sung", async () => {
  const { renderAdvice } = await import("../web/js/advice-ui.js");
  const { renderVerdict, renderCompare, renderSuppliers, renderHeadline, renderSummary, renderBanner } = await import("../web/js/render.js");
  const store = createMemoryStore();
  const e = await research({ text: "Nồi chiên không dầu Zeta ZF-500", scenario: "explore" }, { perHostCap: 99, api, store });
  assert.equal(e.scenario, "explore");
  assert.ok(e.prices.length >= 1 && e.alternatives.length >= 1, "vẫn có dữ liệu chung để xem");
  const advice = renderAdvice(e, {}, "", {});
  assert.match(advice, /Cần bổ sung thông tin để tư vấn/);
  assert.match(advice, /chưa thể tư vấn chọn sản phẩm, nhà cung cấp hay so sánh báo giá/);
  assert.ok(!/Nên chọn|Phù hợp nhất|Chọn sản phẩm này|Bước 2/.test(advice), "không xếp hạng/đề xuất");
  assert.equal(renderVerdict(e), "", "không nêu lựa chọn tối ưu");
  const cmp = renderCompare(e);
  assert.match(cmp, /Chưa đủ thông tin để so sánh/);
  assert.ok(!/class="score"|Tối ưu/.test(cmp), "không có điểm/xếp hạng");
  assert.match(renderSuppliers(e), /Chưa đủ thông tin để nêu nhà cung cấp/);
  const head = renderHeadline(e);
  assert.match(head, /Khoảng giá tham khảo|Chưa có giá cụ thể/);
  assert.ok(!/Giá trung bình/.test(head), "không nêu giá trung bình");
  assert.match(renderSummary(e), /không dùng để so sánh báo giá/);
  assert.match(renderBanner(e), /Chưa đủ thông tin để tư vấn/);
  assert.match(renderBanner(e), /data-need-more/);
  // đủ thông tin thì vẫn tư vấn đầy đủ
  const full = await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api, store: createMemoryStore() });
  assert.ok(!/Cần bổ sung thông tin để tư vấn/.test(renderAdvice(full, {}, "", {})));
  assert.notEqual(renderVerdict(full), "");
});

test("cấu hình: số trang, số ảnh, tắt trang liên hệ có hiệu lực trong luồng chạy", async () => {
  const lean = await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api, store: createMemoryStore(), pageLimit: 3, imageLimit: 1, imageLimitAlt: 1, contactPages: false, stopEarly: false });
  assert.ok(lean.pages.filter((p) => p.for !== "liên hệ").length <= 3, "tối đa 3 trang");
  assert.ok(!lean.pages.some((p) => p.for === "liên hệ"), "không mở trang liên hệ");
  assert.ok(lean.images.length <= 1, "tối đa 1 ảnh chính: " + lean.images.length);
  assert.equal(lean.imageLimit, 1);
  const rich = await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api, store: createMemoryStore(), imageLimit: 12, imageLimitAlt: 8 });
  assert.ok(rich.images.length >= lean.images.length);
});

// ---- ảnh tham chiếu: ưu tiên ảnh giống hoặc gần giống ----
import { featuresFromRGBA, similarity, rankBySimilarity } from "../web/js/lib/imagesim.js";
import { fetchImage } from "../worker/safe-url.js";

const solid = (w, h, [r, g, b]) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } return d; };
const gradient = (w, h, flip, [r, g, b]) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = Math.round(255 * ((flip ? w - 1 - x : x) / (w - 1))); const i = (y * w + x) * 4; d[i] = Math.min(255, v * r / 255 + 20); d[i + 1] = Math.min(255, v * g / 255 + 20); d[i + 2] = Math.min(255, v * b / 255 + 20); d[i + 3] = 255; } return d; };
const feat = (flip, rgb) => featuresFromRGBA(gradient(16, 16, flip, rgb), gradient(9, 8, flip, rgb));

test("độ giống ảnh: ảnh cùng dáng/màu gần giống điểm cao; khác màu hoặc khác dáng điểm thấp; thiếu dữ liệu = 0", () => {
  const ref = feat(false, [255, 80, 40]);
  const same = similarity(ref, feat(false, [255, 80, 40]));
  const near = similarity(ref, feat(false, [235, 100, 60]));
  const otherColor = similarity(ref, feat(false, [40, 80, 255]));
  const mirrored = similarity(ref, feat(true, [255, 80, 40]));
  assert.equal(same, 1);
  assert.ok(near > otherColor && near > mirrored, `gần giống ${near} > khác màu ${otherColor}, khác dáng ${mirrored}`);
  assert.ok(near >= 0.8, "gần giống vẫn được điểm cao (không cần giống hệt): " + near);
  assert.equal(similarity(null, ref), 0);
  assert.equal(featuresFromRGBA(solid(16, 16, [10, 10, 10]), solid(9, 8, [10, 10, 10])).hash.length, 64);
});

test("rankBySimilarity: xếp giống nhất trước, giữ đúng số ảnh, ảnh không tải được xuống cuối (không bỏ)", async () => {
  const ref = feat(false, [255, 80, 40]);
  const table = { a: feat(false, [40, 80, 255]), b: feat(false, [250, 85, 45]), c: null, d: feat(false, [235, 100, 60]) };
  const imgs = ["a", "b", "c", "d"].map((u) => ({ url: u, score: 1 }));
  const r = await rankBySimilarity(imgs, ref, async (u) => table[u], { keep: 3 });
  assert.deepEqual(r.ranked.map((x) => x.url), ["b", "d", "a"]);
  assert.equal(r.failed, 1);
  assert.ok(r.best > 0.9);
  const all = await rankBySimilarity(imgs, ref, async (u) => table[u]);
  assert.equal(all.ranked.at(-1).url, "c");
});

test("pipeline có ảnh tham chiếu: giữ nhiều ứng viên rồi xếp theo độ giống, ghi độ giống vào ảnh", async () => {
  const ref = feat(false, [255, 80, 40]);
  const asked = [];
  const e = await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { perHostCap: 99, api, store: createMemoryStore(), imageLimit: 2, imageLimitAlt: 1, refImage: ref,
    imageFeatures: async (u) => { asked.push(u); return /img\/(\d)/.test(u) && Number(u.match(/img\/(\d)/)[1]) % 2 ? feat(false, [250, 85, 45]) : feat(true, [40, 80, 255]); } });
  assert.equal(e.refImage, true);
  assert.ok(asked.length >= 1, "đã so ảnh");
  assert.ok(e.images.length <= 2);
  assert.ok(e.images.every((i) => i.sim != null || e.images.length === 0));
  const sims = e.images.map((i) => i.sim ?? -1);
  assert.deepEqual(sims, [...sims].sort((a, b) => b - a), "giống nhất đứng trước");
  assert.ok(e.log.some((l) => /xếp theo độ giống ảnh tham chiếu/.test(l.msg)));
});

test("tải ảnh hộ trình duyệt: chặn địa chỉ nội bộ, chỉ nhận ảnh, giới hạn dung lượng", async () => {
  assert.equal((await fetchImage("http://10.0.0.5/a.png")).ok, false);
  assert.equal((await fetchImage("http://localhost/a.png")).ok, false);
  const png = new Uint8Array([137, 80, 78, 71]);
  const mk = (type, body, status = 200, len) => async () => new Response(body, { status, headers: { "content-type": type, ...(len ? { "content-length": String(len) } : {}) } });
  const ok = await fetchImage("https://img.vn/a.png", { fetchImpl: mk("image/png", png) });
  assert.equal(ok.ok, true); assert.equal(ok.type, "image/png"); assert.equal(ok.bytes.length, 4);
  assert.equal((await fetchImage("https://img.vn/a", { fetchImpl: mk("text/html", "<html>") })).ok, false);
  assert.equal((await fetchImage("https://img.vn/a.png", { fetchImpl: mk("image/png", png, 200, 9_999_999) })).ok, false);
  const redirect = async (u) => (String(u).includes("img.vn") ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1/x.png" } }) : new Response(png, { headers: { "content-type": "image/png" } }));
  assert.equal((await fetchImage("https://img.vn/a.png", { fetchImpl: redirect })).ok, false, "chuyển hướng vào mạng nội bộ bị chặn");
});
