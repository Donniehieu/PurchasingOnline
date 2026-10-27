import test from "node:test";
import assert from "node:assert/strict";
import { parseNeed, needSummary } from "../web/js/lib/need.js";
import { adviseProducts, adviseSuppliers } from "../web/js/lib/advisor.js";
import { specFilter, suppliersOf, upsertOffer, applyView, tableRows } from "../web/js/lib/offers.js";
import { newEntry, ingestPage, keepBestImages, MAX_IMAGES } from "../web/js/lib/entry.js";
import { makePlan } from "../web/js/lib/plan.js";
import { createStore } from "../web/js/lib/store.js";

test("parseNeed: cắt ngân sách, mục đích, số người từ câu gõ (chỉ để điền ô, không dùng để tìm)", () => {
  const a = parseNeed("Máy lọc nước dưới 5 triệu cho gia đình 4 người");
  assert.equal(a.budgetMax, 5_000_000);
  assert.equal(a.budgetMin, null);
  assert.equal(a.people, 4);
  assert.equal(a.purpose, "gia đình 4 người");
  const b = parseNeed("tủ lạnh 3-5 triệu");
  assert.deepEqual([b.budgetMin, b.budgetMax], [3_000_000, 5_000_000]);
  const c = parseNeed("laptop khoảng 15tr dùng để học online");
  assert.equal(c.purpose, "học online");
  assert.ok(c.budgetMin < 15_000_000 && c.budgetMax > 15_000_000);
  const d = parseNeed("ghế gaming trên 2 triệu");
  assert.equal(d.budgetMin, 2_000_000);
  assert.deepEqual(parseNeed("Sony WH-1000XM5"), { budgetMin: null, budgetMax: null, purpose: "", people: null, area: null });
  assert.match(needSummary(a), /5 triệu.*gia đình/);
  // từ khóa tìm không bị ảnh hưởng bởi việc cắt nhu cầu
  assert.equal(makePlan({ text: "Máy lọc nước dưới 5 triệu cho gia đình 4 người" }).query, "Máy lọc nước dưới 5 triệu cho gia đình 4 người");
});

test("specFilter: lọc thông số đúng (số khớp trọn, so sánh số, nhiều điều kiện)", () => {
  const S = [{ k: "Công suất", v: "1.500W" }, { k: "Dung tích", v: "5,5 lít" }, { k: "Công nghệ", v: "Inverter tiết kiệm điện" }];
  const t = (q) => specFilter(q)(S);
  assert.equal(t("1500"), true);
  assert.equal(t("150"), false, "150 không khớp 1500");
  assert.equal(t("55"), false);
  assert.equal(t("inv"), true);
  assert.equal(t("công suất>=1500"), true);
  assert.equal(t("công suất>2000"), false);
  assert.equal(t("công suất: 1500w"), true);
  assert.equal(t("dung tích<=6 lít"), true);
  assert.equal(t("dung tích>=6"), false);
  assert.equal(t("dung tích: 5,5; inverter"), true);
  assert.equal(t("dung tích: 5,5; quạt"), false, "mọi điều kiện đều phải đúng");
  assert.equal(specFilter(""), null);
});

function entryWith(offers, contacts = {}) {
  const e = newEntry(makePlan({ text: "Máy hút bụi XYZ-100" }), "k");
  for (const o of offers) upsertOffer(e, { kind: "same", name: "Máy hút bụi XYZ-100", model: "XYZ-100", brand: "XYZ", priceVia: "page", readFromPage: true, ...o });
  e.contacts = contacts;
  return e;
}

test("adviseSuppliers: xếp NCC theo giá, ngân sách, đọc từ trang, VAT, liên hệ", () => {
  const e = entryWith([
    { seller: "A.vn", price: 2_000_000, url: "https://a.vn/p", vat: { state: "included" } },
    { seller: "B.vn", price: 1_800_000, url: "https://b.vn/p", vat: { state: "excluded" } },
    { seller: "C.vn", price: 3_500_000, url: "https://c.vn/p", vat: { state: "unknown" } },
  ], { "a.vn": { phones: ["0901 234 567"], emails: [], zalo: [], address: "" } });
  const adv = adviseSuppliers(e, { budgetMax: 2_500_000 });
  assert.equal(adv.list.length, 3);
  assert.equal(adv.cheapest.seller, "B.vn");
  assert.equal(adv.best.seller, "A.vn", "A: trong ngân sách, đã gồm VAT, có SĐT");
  assert.equal(adv.list.at(-1).seller, "C.vn");
  assert.ok(adv.list.at(-1).warns.includes("ngoài ngân sách"));
  assert.ok(adv.best.reasons.includes("có SĐT"));
  const cheap = adviseSuppliers(e, { priority: "cheap" });
  assert.ok(cheap.list.find((x) => x.seller === "B.vn").score > cheap.list.find((x) => x.seller === "C.vn").score);
});

test("adviseProducts: chưa rõ model thì hướng dẫn chọn sản phẩm theo ngân sách; đã rõ model thì sang chọn NCC", () => {
  const e = newEntry(makePlan({ text: "Máy hút bụi dưới 3 triệu" }), "k2");
  upsertOffer(e, { kind: "same", name: "Máy hút bụi AAA-10", model: "AAA-10", brand: "AAA", price: 2_500_000, priceVia: "page", readFromPage: true, url: "https://a.vn/1", seller: "a.vn", specs: [{ k: "Công suất", v: "800W" }] });
  upsertOffer(e, { kind: "other", name: "Máy hút bụi BBB-20", model: "BBB-20", brand: "BBB", price: 6_000_000, priceVia: "page", readFromPage: true, url: "https://b.vn/1", seller: "b.vn", specs: [{ k: "Công suất", v: "1500W" }] });
  const adv = adviseProducts(e, { budgetMax: 3_000_000 });
  assert.equal(adv.mode, "product");
  assert.equal(adv.candidates[0].model, "AAA-10", "sản phẩm trong ngân sách đứng đầu");
  assert.ok(adv.candidates[1].warns.includes("ngoài ngân sách"));
  assert.ok(adv.questions.some((q) => /chưa nhập mã model/.test(q)));
  assert.ok(adv.questions.some((q) => /Công suất/.test(q)), "hỏi thu hẹp theo thông số khác nhau");
  const sup = adviseSuppliers(e, { budgetMax: 3_000_000 }, adv.candidates[0].key);
  assert.equal(sup.product.model, "AAA-10");
  assert.equal(sup.list.length, 1);
  // đã rõ model: chuyển thẳng sang chọn NCC
  const known = entryWith([{ seller: "A.vn", price: 2_000_000, url: "https://a.vn/p" }]);
  assert.equal(adviseProducts(known, {}).mode, "supplier");
});

test("NCC của mọi trang đã đọc đều được lưu (kể cả trang không khớp model) và có trong danh sách NCC", () => {
  const e = newEntry(makePlan({ text: "Máy hút bụi XYZ-100" }), "k3");
  ingestPage(e, { ok: true, url: "https://shop1.vn/a", finalUrl: "https://shop1.vn/a", title: "Shop 1 XYZ-100", domain: "shop1.vn", seller: "Cửa hàng Một", relevant: true, product: { price: { value: 2_000_000, source: "jsonld" }, name: "Máy hút bụi XYZ-100" }, contact: { phones: ["0901 234 567"], emails: [], zalo: [], address: "", contactUrl: "" }, specs: [], images: [] });
  ingestPage(e, { ok: true, url: "https://shop2.vn/blog", finalUrl: "https://shop2.vn/blog", title: "Bài viết khác", domain: "shop2.vn", seller: "Cửa hàng Hai", relevant: false, contact: { phones: ["0912 345 678"], emails: [], zalo: [], address: "", contactUrl: "" }, specs: [], images: [] });
  assert.equal(e.suppliers["shop2.vn"].name, "Cửa hàng Hai");
  assert.equal(e.suppliers["shop2.vn"].matched, false);
  assert.equal(e.suppliers["shop1.vn"].matched, true);
  const list = suppliersOf(e);
  assert.deepEqual(list.map((s) => s.domain), ["shop1.vn", "shop2.vn"]);
  assert.equal(list[1].contact.phones[0], "0912 345 678");
  assert.equal(list[0].minPrice, 2_000_000);
});

test("ảnh: chỉ giữ tối đa 5 ảnh tốt nhất", () => {
  assert.equal(MAX_IMAGES, 5);
  const list = Array.from({ length: 9 }, (_, i) => ({ url: "u" + i, score: i === 7 ? 9 : i === 8 ? 5 : 1 }));
  keepBestImages(list);
  assert.equal(list.length, 5);
  assert.ok(list.some((x) => x.url === "u7") && list.some((x) => x.url === "u8"));
  const e = newEntry(makePlan({ text: "Máy hút bụi XYZ-100" }), "k4");
  const images = Array.from({ length: 12 }, (_, i) => ({ url: `https://img.test/${i}.jpg`, alt: "", score: i }));
  ingestPage(e, { ok: true, url: "https://s.vn/a", finalUrl: "https://s.vn/a", title: "t", domain: "s.vn", relevant: true, product: {}, specs: [], images });
  assert.equal(e.images.length, 5);
  assert.deepEqual(e.images.map((x) => x.score).sort((a, b) => b - a), [11, 10, 9, 8, 7]);
});

test("danh bạ NCC dùng chung: lưu tên + liên hệ, gộp không mất dữ liệu cũ", async () => {
  const store = createStore();
  await store.saveSuppliers([{ domain: "a.vn", name: "A Shop", contact: { phones: ["0901 234 567"], emails: [], zalo: [], address: "" }, pages: [] }]);
  await store.saveSuppliers([{ domain: "a.vn", name: "", contact: null, pages: [] }, { domain: "b.vn", name: "B", contact: null, pages: [] }]);
  const dir = await store.suppliers();
  assert.equal(dir["a.vn"].name, "A Shop");
  assert.equal(dir["a.vn"].contact.phones[0], "0901 234 567");
  assert.ok(dir["b.vn"]);
  const exp = await store.exportAll();
  assert.equal(exp.suppliers.length, 2);
});

test("applyView lọc thông số dùng bộ lọc đúng", () => {
  const e = entryWith([
    { seller: "A.vn", price: 2_000_000, url: "https://a.vn/p", specs: [{ k: "Công suất", v: "1500W" }] },
    { seller: "B.vn", price: 1_800_000, url: "https://b.vn/p", specs: [{ k: "Công suất", v: "15000W" }] },
  ]);
  const rows = tableRows(e);
  const out = applyView(rows, { source: "all", filters: { specs: "công suất: 1500" }, sort: { col: "price", dir: "asc" } });
  assert.deepEqual(out.map((r) => r.seller), ["A.vn"]);
});
