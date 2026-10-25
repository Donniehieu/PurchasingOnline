import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../docs/js/core.js";

const sup = (name, price, mah = null, months = null, vat = null) => ({ name, price, mah, warranty_months: months, vat, vat_included: false, relevance: 1, url: "https://" + name, title: name, contacts: {} });

test("NCC không có VAT bị loại, NCC còn lại được khuyến nghị", () => {
  const r = core.scoreSuppliers([sup("a.vn", 100000, 20000, 12, false), sup("b.vn", 200000, 20000, 6, true)]);
  assert.equal(r.find((x) => x.name === "a.vn").eligible, false);
  assert.equal(r.find((x) => x.name === "b.vn").recommended, true);
});
test("chấm điểm lại xóa khuyến nghị cũ", () => {
  const first = core.scoreSuppliers([sup("a.vn", 100000, 20000, 12, true), sup("b.vn", 300000, 20000, 12, true)]);
  first.find((x) => x.name === "b.vn").price = 10000;
  assert.deepEqual(core.scoreSuppliers(first).filter((x) => x.recommended).map((x) => x.name), ["b.vn"]);
});
test("trích xuất trang: giá sau chữ giá, mAh, bảo hành, VAT, ngày, liên hệ", () => {
  const html = `<html><head><title>Áo điều hòa Yamako</title><meta property="article:modified_time" content="2026-09-24T10:00:00Z">
    <meta name="description" content="Mô tả sản phẩm"></head><body><p>Áo điều hòa pin 20.000 mAh 18V. Giá: 1.190.000đ. Bảo hành 12 tháng. Có hóa đơn VAT.</p>
    <a href="tel:0946769119">gọi</a><a href="https://zalo.me/0946769119">zalo</a><a href="mailto:a@b.vn">mail</a></body></html>`;
  const s = core.parsePage(html, "https://shop.vn/p", core.queryKeywords("áo điều hòa"));
  assert.equal(s.price, 1190000); assert.equal(s.mah, 20000); assert.equal(s.volt, 18); assert.equal(s.warranty_months, 12);
  assert.equal(s.vat, true); assert.equal(s.date, "2026-09-24"); assert.deepEqual(s.contacts.phones, ["0946769119"]);
  assert.deepEqual(s.contacts.emails, ["a@b.vn"]); assert.equal(s.contacts.zalo_guess, false);
});
test("trang không đúng sản phẩm bị loại", () => {
  assert.equal(core.parsePage("<p>Quạt cầm tay mini giá 199.000đ</p>", "https://x.vn", core.queryKeywords("áo điều hòa")), null);
});
test("zalo suy từ số điện thoại được đánh dấu chưa xác nhận", () => {
  const c = core.extractContacts("", "https://shop.vn", "Gọi 0912 345 678");
  assert.equal(c.zalo_guess, true); assert.equal(c.phones[0], "0912345678");
});
test("question card nhận ra thông số trong tên và áp câu trả lời", () => {
  const cards = core.buildCards({ query: "quạt 20000mAh 18V", quantity: 5 }, null, "GIFV F20");
  const by = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.equal(by.mah.default, "20000"); assert.equal(by.volt.default, "18"); assert.ok(by.ocr);
  const job = {}; core.applyAnswers(job, Object.fromEntries(cards.map((c) => [c.id, { value: c.default, custom: "" }])));
  assert.equal(job.quantity, 5); assert.equal(job.spec.mah, "20000");
  assert.throws(() => core.applyAnswers({}, { product: { value: "x" }, quantity: { value: "abc" } }), /Số lượng/);
});
test("từ khóa không lặp thông số đã có", () => {
  assert.equal(core.searchKeywords({ query: "áo điều hòa pin 20000mAh", spec: { mah: "20000", volt: "18" } }), "áo điều hòa pin 20000mAh 18V");
});
test("parseField", () => {
  assert.equal(core.parseField("price", "1.190.000"), 1190000); assert.equal(core.parseField("date", "01/07/2024"), "2024-07-01");
  assert.equal(core.parseField("vat", "Có"), true); assert.equal(core.parseField("vat", "Chưa rõ"), null);
  assert.throws(() => core.parseField("price", "abc")); assert.throws(() => core.parseField("warranty_months", "9999")); assert.throws(() => core.parseField("score", "1"));
});
test("lịch sử gộp theo tên sản phẩm bỏ dấu, không phân biệt hoa thường", () => {
  const job = (id, q, price, n) => ({ id, status: "done", query: q, keywords: q, created: `2026-01-0${n}T10:00:00`, engines: [], suppliers: [sup("a.vn", price)], sites_searched: ["https://a.vn/x", "https://b.vn/y"], research: {}, quantity: 10, edits: [] });
  const groups = core.groupHistory([job("1", "Áo điều hòa", 100, 1), job("2", "ao dieu hoa", 300, 2), job("3", "Quạt", 50, 3)]);
  assert.equal(groups.length, 2);
  const g = groups.find((x) => x.searches === 2);
  assert.equal(g.avg_price, 200); assert.equal(g.price_change_pct, 200); assert.deepEqual(g.sites.map((s) => s.domain).sort(), ["a.vn", "b.vn"]);
});
test("thuyết phục theo quy trình mua hàng", () => {
  const s = core.scoreSuppliers([sup("a.vn", 100000, 20000, 12, true), sup("b.vn", 300000, 20000, 6, true)]);
  const r = core.buildInsights(s, 10, { product: "quạt", spec: "20.000 mAh", purpose: "ngoài trời", research: {} });
  assert.ok(r.persuasion.sections[0].heading.startsWith("1. Nhu cầu")); assert.ok(r.negotiation[0].steps.length === 6);
  assert.ok(core.persuasionText(r.persuasion).includes("a.vn"));
});
