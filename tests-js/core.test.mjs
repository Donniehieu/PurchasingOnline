import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../docs/js/core.js";
import * as knowledge from "../docs/js/knowledge.js";
import { asDoc } from "../docs/js/corpus.js";

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
const page = (title, body) => ({ url: `https://${title.split(" ")[0].toLowerCase()}.vn/p`, html: `<html><head><title>${title}</title></head><body>${body}</body></html>` });
const SHIRT = [
  page("Aodh Áo điều hòa YAMAKO GIFV F20 18V - Shop A", "<p>Áo điều hòa pin 20.000 mAh, 18V, công suất 30W. Sản phẩm phù hợp cho công nhân làm ngoài trời. Bảo hành 12 tháng. Giá: 1.190.000đ. Thương hiệu Yamako được nhiều người tin dùng.</p>"),
  page("Bshop Áo điều hòa YAMAKO GIFV F20 - Shop B", "<p>Áo điều hòa pin 20000mAh điện áp 18V, công suất 30W, dành cho công nhân làm ngoài trời. Bảo hành 12 tháng. Giá 1.350.000đ. Hãng Yamako bảo hành tốt.</p>"),
  page("Cshop Áo điều hòa Yamako - Shop C", "<p>Áo điều hòa pin 30000 mAh 12V. Giá 1.800.000đ</p>"),
  page("Quạt cầm tay mini", "<p>Quạt cầm tay mini 5V pin 2000 mAh</p>"), // sai sản phẩm, phải bị bỏ
];
const SHIRT_TOKENS = core.queryKeywords("áo điều hòa");

test("nhận diện nhóm ngành hàng theo cụm từ dài nhất", () => {
  assert.equal(core.detectCategory("áo điều hòa pin 20000mAh"), "gia_dung");
  assert.equal(core.detectCategory("máy khoan cầm tay Bosch"), "may_moc");
  assert.equal(core.detectCategory("áo khoác nam"), "tieu_dung");
  assert.equal(core.detectCategory("thứ gì đó lạ"), "chung");
});
test("tìm hiểu từ trang web: thông số, model, hãng, bảo hành, giá", () => {
  const d = core.buildDiscovery(SHIRT.map(asDoc), SHIRT_TOKENS, "áo điều hòa");
  assert.equal(d.read, 4); assert.equal(d.total, 3); assert.equal(d.category, "gia_dung");
  assert.equal(d.mah[0].value, "20000"); assert.equal(d.mah[0].count, 2); assert.equal(d.volt[0].value, "18");
  assert.ok(d.models.some((m) => m.value === "F20" && m.count === 2));
  assert.ok(d.brands.some((b) => /yamako/i.test(b.value) && b.count >= 2));
  assert.equal(d.warranty[0].value, "12"); assert.ok(d.specs.some((s) => s.id === "power" && s.values[0].value === "30"));
  assert.ok(d.purposes[0].value.includes("công nhân")); assert.deepEqual([d.price.min, d.price.max], [1190000, 1800000]);
});
test("question card nhận ra thông số trong tên và áp câu trả lời", () => {
  const cards = core.buildCards({ query: "quạt 20000mAh 18V", quantity: 5 }, null, "GIFV F20");
  const by = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.equal(by.mah.default, "20000"); assert.equal(by.volt.default, "18"); assert.ok(by.ocr);
  const job = { questions: cards }; core.applyAnswers(job, Object.fromEntries(cards.map((c) => [c.id, { value: c.default, custom: "" }])));
  assert.equal(job.quantity, 5); assert.equal(job.spec.mah, "20000"); assert.equal(job.spec.vat_required, true);
  assert.throws(() => core.applyAnswers({ questions: cards }, { product: { value: "x" }, quantity: { value: "abc" } }), /Số lượng/);
});
test("câu trả lời card bổ sung (ngân sách, hãng, thông số) vào spec, từ khóa và văn bản thông số", () => {
  const d = core.buildDiscovery(SHIRT.map(asDoc), SHIRT_TOKENS, "áo điều hòa");
  const cards = core.buildCards({ query: "áo điều hòa", quantity: 3 }, null, "", d);
  const answers = Object.fromEntries(cards.map((c) => [c.id, { value: c.default, custom: "" }]));
  answers.budget = { value: "1500000", custom: "" }; answers.brand = { value: "Yamako", custom: "" }; answers.vat = { value: "no", custom: "" };
  const job = { questions: cards, ocr_text: "", extra_keywords: "" }; core.applyAnswers(job, answers);
  assert.equal(job.spec.budget, 1500000); assert.equal(job.spec.brand, "Yamako"); assert.equal(job.spec.vat_required, false);
  assert.match(core.specText(job.spec), /ngân sách tối đa 1\.500\.000 đ/); assert.match(core.searchKeywords(job), /Yamako/);
  const r = core.scoreSuppliers([sup("a.vn", 1000000, null, 12, true), sup("b.vn", 2000000, null, 12, true)], true, job.spec.budget);
  assert.equal(r.find((x) => x.name === "b.vn").over_budget, true); assert.equal(r.find((x) => x.name === "a.vn").recommended, true); // không có mAh thì so giá trực tiếp
});
test("tìm hiểu theo ngành: kế hoạch câu hỏi, câu trả lời có nguồn, hãng, giá", () => {
  const plan = knowledge.planKnowledge("áo điều hòa", "gia_dung");
  const ids = plan.questions.map((q) => q.id);
  for (const id of ["price", "brands", "brand_pros", "pros", "buy", "using", "types", "tech", "power", "safety", "care"]) assert.ok(ids.includes(id), id);
  assert.ok(plan.queries.length >= 3);
  assert.ok(knowledge.planKnowledge("máy khoan", "may_moc").questions.some((q) => q.id === "standards"));
  assert.ok(knowledge.planKnowledge("áo khoác", "tieu_dung").questions.some((q) => q.id === "fake"));
  const pages = [...SHIRT, page("Dshop Áo điều hòa - lưu ý", "<p>Khi mua áo điều hòa cần lưu ý chọn đúng dung lượng pin và hãng Yamako chính hãng. Ưu điểm của áo điều hòa là mát ngay, nhược điểm là phải sạc pin thường xuyên. Công nghệ quạt gió kết hợp pin lithium cho thời gian dùng lâu hơn công nghệ cũ.</p>")];
  const r = knowledge.answerKnowledge(plan, pages, SHIRT_TOKENS);
  assert.ok(r.price.price && r.price.price.min === 1190000); assert.ok(r.brands.brands.some((b) => /yamako/i.test(b.value)));
  assert.ok(r.buy.snippets.length && r.buy.snippets[0].url.startsWith("https://")); assert.ok(r.pros.snippets.some((s) => /nhược điểm/.test(s.text)));
  assert.equal(r.price.group, "gia"); assert.equal(r.price.group_label, "Giá cả");
});
test("cột NCC mới: tên sản phẩm, số lượng, thông tin sản phẩm có thể sửa", () => {
  assert.equal(core.parseField("quantity", "12"), 12); assert.throws(() => core.parseField("quantity", "0"), /khoảng/);
  assert.equal(core.parseField("product_name", "  Áo điều hòa X  "), "Áo điều hòa X");
  assert.equal(core.supplierInfo({ mah: 20000, volt: 18, warranty_months: 12 }), "Pin 20.000 mAh · 18V · Bảo hành 12 tháng");
  assert.equal(core.supplierInfo({}), "Bảo hành chưa rõ");
  const s = core.parsePage("<html><head><title>Áo điều hòa Yamako F20 - Shop A</title></head><body>Áo điều hòa giá 1.190.000đ</body></html>", "https://a.vn", core.queryKeywords("áo điều hòa"));
  assert.equal(s.product_name, "Áo điều hòa Yamako F20");
});
test("giá bán: ưu tiên dữ liệu có cấu trúc, không lấy số nhỏ nhất (voucher, phí ship, phụ kiện)", () => {
  const noise = "Giảm 50.000đ cho đơn đầu tiên. Phí vận chuyển 55.000đ. Ốp lưng 99.000đ. Giá: 4.990.000đ.";
  const ld = `<html><head><title>Máy hút bụi X</title><script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"4590000","priceCurrency":"VND"}}</script></head><body>${noise}</body></html>`;
  assert.deepEqual(core.extractPrice(ld, core.htmlToText(ld)), { value: 4590000, source: "jsonld" });
  const plain = `<html><body>${noise}</body></html>`;
  assert.deepEqual(core.extractPrice(plain, core.htmlToText(plain)), { value: 4990000, source: "label" });
  const meta = `<html><head><meta property="product:price:amount" content="1.290.000"></head><body>${noise}</body></html>`;
  assert.deepEqual(core.extractPrice(meta, core.htmlToText(meta)), { value: 1290000, source: "meta" });
  const usd = `<html><head><script type="application/ld+json">{"offers":{"price":"199","priceCurrency":"USD"}}</script></head><body>Giá 2.000.000đ</body></html>`;
  assert.equal(core.extractPrice(usd, core.htmlToText(usd)).value, 2000000);
  const nolabel = "<p>Tặng voucher 50.000đ, bộ lọc 120.000đ, sản phẩm 3.200.000đ, trả góp từ 3.200.000đ</p>";
  assert.deepEqual(core.extractPrice(nolabel, core.htmlToText(nolabel)), { value: 3200000, source: "text" }); // số xuất hiện nhiều nhất
  assert.deepEqual(core.extractPrice("", "Máy hút bụi giá 3.500.000đ rẻ nhất", null, true), { value: 3500000, source: "snippet" });
  assert.equal(core.extractPrice("", "Từ 50.000đ phụ kiện", null, true).value, null); // đoạn mô tả không có chữ "giá" thì không đoán
  assert.equal(core.isConfidentPrice("jsonld"), true); assert.equal(core.isConfidentPrice("text"), false);
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
