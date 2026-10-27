import test from "node:test";
import assert from "node:assert/strict";
import { makePlan, extractModel } from "../web/js/lib/plan.js";
import { extractFacts } from "../web/js/lib/extract.js";
import { newEntry, ingestPage, PAGE_LOGIC_VERSION } from "../web/js/lib/entry.js";
import { suppliersOf, tableRows } from "../web/js/lib/offers.js";
import { normUrl } from "../web/js/lib/text.js";

const TEXT = "Đồng Hồ Đo Áp LIGI Inox 316, Chân Sau Có Vành D63mm Ren 13mm";

const page = (title, price, extra = "") => `<html><head><title>${title}</title>
<script type="application/ld+json">{"@type":"Product","name":"${title}","offers":{"@type":"Offer","price":"${price}","priceCurrency":"VND"}}</script></head>
<body><h1>${title}</h1><p>${extra}</p></body></html>`;

test("quy cách kích thước (D63mm, Ø63, DN15, G1/4, PN16) không bị coi là mã model; nhận ra hãng viết HOA", () => {
  const p = makePlan({ text: TEXT });
  assert.equal(p.query, TEXT);
  assert.equal(p.model, "", "D63mm là đường kính, không phải mã model");
  assert.equal(p.brand, "LIGI");
  assert.equal(p.generic, "đồng hồ đo áp", "tên loại không bị cắt thành 'đồng' khi viết Hoa Mỗi Chữ");
  for (const t of ["D63mm", "Ø63", "DN15", "PN16", "G1/4"]) assert.equal(extractModel("Van " + t), "", t);
  assert.equal(extractModel("Nikon D750 body"), "D750", "mã thật vẫn nhận");
  assert.equal(extractModel("Máy lọc Kangaroo KG100A"), "KG100A");
});

test("trang NCC viết quy cách khác đi (D63, Ø63) vẫn khớp; trang chỉ giống một phần vào bảng với dấu 'tương tự'", () => {
  const hint = { model: "", name: TEXT, brand: "LIGI" };
  const a = extractFacts(page("Đồng hồ đo áp suất LIGI inox 316 chân sau Ø63 ren 13", 185000), "https://a.vn/p", hint);
  assert.equal(a.relevant, true, "Ø63 khớp D63mm; điểm tên " + a.matched.nameScore);
  const b = extractFacts(page("Đồng hồ áp LIGI chân sau inox", 150000), "https://b.vn/p", hint);
  assert.equal(b.relevant, false);
  assert.ok(b.matched.nameScore >= 0.34, "giống một phần: " + b.matched.nameScore);
  const c = extractFacts(page("Nhiệt kế treo tường Wika", 90000), "https://c.vn/p", hint);
  assert.equal(c.relevant, false);
  assert.ok(c.matched.nameScore < 0.34);

  const e = newEntry(makePlan({ text: TEXT }), "k");
  for (const [f, u] of [[a, "https://a.vn/p"], [b, "https://b.vn/p"], [c, "https://c.vn/p"]]) ingestPage(e, { ...f, ok: true, url: u, finalUrl: u });
  const rows = tableRows(e);
  assert.deepEqual(rows.map((r) => r.domain).sort(), ["a.vn", "b.vn"], "trang không liên quan (c.vn) không có dòng");
  assert.equal(rows.find((r) => r.domain === "a.vn").weak, false);
  assert.equal(rows.find((r) => r.domain === "b.vn").weak, true);
  assert.equal(e.prices.length, 1, "trang tương tự không tính vào giá trung bình");
  assert.equal(suppliersOf(e).length, 3, "NCC của cả 3 trang vẫn được lưu");
});

test("có mã model: khớp mã HOẶC gần hết tên (nhà bán viết mã khác đi)", () => {
  const hint = { model: "KG100A", name: "Máy lọc nước Kangaroo KG100A 10 lõi", brand: "Kangaroo" };
  const same = extractFacts(page("Máy lọc nước Kangaroo KG-100A 10 lõi", 5000000), "https://s.vn/a", hint);
  assert.equal(same.relevant, true);
  const diffCode = extractFacts(page("Máy lọc nước Kangaroo Hydrogen 10 lõi", 5000000), "https://s.vn/b", hint);
  assert.equal(diffCode.relevant, false, "khác mã, tên chỉ khớp một phần");
});

test("trang tự viết giá (Đơn giá: 388,000 đ trong span.price): đọc được giá, quy cách đóng gói, có dòng trong bảng NCC", async () => {
  const { pickPages } = await import("../web/js/lib/pipeline.js");
  const html = `<html><head><title>Sữa bột pha sẵn Dielac Grow Plus hộp 110ml - suachobeyeu.vn</title></head><body>
<h1>Thùng sữa bột pha sẵn Dielac Grow Plus hộp 110ml</h1>
<div class="t-price">Đơn giá:
<span class="current prd-price text-danger">
388,000 đ</span></div>
<div><b>Thương hiệu: </b><span class="measure-item">Sữa bột Vinamilk</span></div>
<div><b>Trọng lượng: </b><span>1 Thùng =  48 Hộp x 110ml</span></div>
<div class="price_product"><span class="price-old">999,000 đ</span></div></body></html>`;
  const plan = makePlan({ text: "sữa vinamilk growplus pha sẵn 110ml" });
  assert.equal(plan.model, "", "110ml là dung tích, không phải model");
  const url = "https://suachobeyeu.vn/san-pham/sua-bot-pha-san-dielac-grow-plus-hop-110ml.html";
  const f = extractFacts(html, url, { model: plan.model, name: plan.name, brand: plan.brand });
  assert.equal(f.relevant, true, "điểm tên " + f.matched.nameScore);
  assert.deepEqual(f.product.price, { value: 388000, source: "markup" });
  assert.deepEqual(f.pack, { outer: "thùng", count: 48, unit: "hộp" });
  const e = newEntry(plan, "ks");
  ingestPage(e, { ...f, ok: true, url, finalUrl: url });
  const rows = tableRows(e);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, 388000);
  assert.equal(rows[0].read, true);
  assert.equal(rows[0].pack.count, 48);

  // trang từng bị loại ở bản cũ (chưa có dấu phiên bản) thì được đọc lại; trang đã đánh giá bằng cách nhận mới thì không
  const e2 = newEntry(plan, "ks2");
  const src = (u) => ({ id: e2.sources.length + 1, key: normUrl(u), url: u, title: "t", domain: "x.vn", via: "page", verified: true, kind: "shop" });
  e2.sources.push(src("https://old.vn/a"), src("https://new.vn/b"));
  e2.pages.push({ url: "https://old.vn/a", ok: true, relevant: false }, { url: "https://new.vn/b", ok: true, relevant: false, v: PAGE_LOGIC_VERSION });
  const urls = pickPages(e2, 10, 99).map((p) => p.url);
  assert.deepEqual(urls, ["https://old.vn/a"]);
});
