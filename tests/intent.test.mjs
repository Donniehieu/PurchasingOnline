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
  // chưa biết loại hàng: hỏi loại trước
  const unk = preCards(analyzeInput("quà tặng dưới 500k"));
  assert.equal(unk[0].kind, "type");
  assert.ok(unk[0].options.length >= 10);
  assert.equal(preCards(analyzeInput("Sony WH-1000XM5")).length, 0, "đủ thông tin thì không có thẻ");
  // chọn loại -> hỏi tiếp theo loại đó
  const picked = analyzeInput("quà tặng", { forcedType: "milk" });
  assert.equal(picked.type.id, "milk");
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
