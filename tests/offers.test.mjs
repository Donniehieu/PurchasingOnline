// Bảng so sánh NCC: trích thông số/VAT/NCC, mô hình offer, lọc/sắp xếp, xuất xlsx.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractSpecs, detectVat, sellerOf, extractFacts } from "../web/js/lib/extract.js";
import { upsertOffer, offersOf, tableRows, applyView, priceFilter, cellValue, OFFER_COLUMNS, DEFAULT_VIEW, specText, vatText } from "../web/js/lib/offers.js";
import { buildWorkbook, xlsxFileName, exportOffersXlsx } from "../web/js/lib/xlsx-export.js";
import { newEntry, ingestProduct, ingestPage, ingestListing } from "../web/js/lib/entry.js";
import { makePlan, cacheKey } from "../web/js/lib/plan.js";
import { research } from "../web/js/lib/pipeline.js";
import { createMemoryStore } from "../web/js/lib/store.js";
import { createApi } from "../web/js/lib/api.js";
import { handle } from "../worker/index.js";
import { mockPages } from "../dev/mock-pages.mjs";

const O = "https://shop.test";
const pages = mockPages(O);
// package là "type: module" nên nạp bản UMD của ExcelJS như CommonJS
const ExcelJS = (() => { const m = { exports: {} }; new Function("module", "exports", readFileSync(new URL("../web/vendor/exceljs.min.js", import.meta.url), "utf8"))(m, m.exports); return m.exports; })();

test("extractSpecs đọc 3 kiểu markup thật: bảng, li hai ô, JSON-LD additionalProperty; bỏ trùng, ưu tiên thông số chính", () => {
  const html = `
    <table><tr><th>Điện áp</th><td>220V / 50Hz</td></tr><tr><th>Công suất</th><td>1700 W</td></tr><tr><th>Giá</th><td>1.000.000đ</td></tr></table>
    <ul><li><div class='text'>Dung tích</div><div class='val'>6.5 L</div></li><li><div class='text'>Công suất đầu ra</div><div class='val'>1700 W</div></li><li><div class='text'>Xuất xứ</div><div class='val'>Trung Quốc</div></li></ul>
    <dl><dt>Bảo hành</dt><dd>12 tháng</dd></dl><script>var x="<tr><th>a</th><td>b</td></tr>"</script>`;
  const specs = extractSpecs(html, { additionalProperty: [{ "@type": "PropertyValue", name: "Chất liệu", value: "Nhựa PP" }, { name: "Thương hiệu", value: "Sunhouse" }] });
  const names = specs.map((s) => s.k);
  assert.ok(["Điện áp", "Công suất", "Dung tích", "Xuất xứ", "Bảo hành", "Chất liệu", "Thương hiệu"].every((n) => names.includes(n)), names.join(","));
  assert.ok(!names.includes("Giá"), "không lấy dòng giá làm thông số");
  assert.ok(!names.includes("Công suất đầu ra"), "trùng giá trị với Công suất");
  assert.ok(!names.includes("a"), "không đọc trong <script>");
  assert.ok(names.indexOf("Thương hiệu") < names.indexOf("Bảo hành"), "thông số chính lên trước");
  assert.ok(specs.length <= 12);
});

test("detectVat: nhận 'đã gồm/chưa gồm/VAT x%/không ghi' và dữ liệu cấu trúc", () => {
  assert.equal(detectVat("Giá 2.490.000đ (đã bao gồm VAT)").state, "included");
  assert.equal(detectVat("Giá chưa bao gồm VAT, liên hệ báo giá").state, "excluded");
  assert.equal(detectVat("Đơn giá chưa VAT: 1.000.000").state, "excluded");
  assert.equal(detectVat("Giá + VAT 10%").state, "excluded");
  const r = detectVat("Thuế VAT 8% áp dụng cho đơn hàng");
  assert.deepEqual([r.state, r.rate], ["rate", 8]);
  assert.equal(detectVat("Giá bán 1.000.000đ, giao hàng toàn quốc").state, "unknown");
  assert.equal(detectVat("x", { offers: { priceSpecification: { valueAddedTaxIncluded: true } } }).state, "included");
  assert.equal(detectVat("giá đã bao gồm VAT", { offers: { priceSpecification: { valueAddedTaxIncluded: false } } }).state, "excluded", "dữ liệu cấu trúc thắng chữ");
  assert.equal(vatText({ state: "rate", rate: 8 }), "VAT 8%");
});

test("sellerOf: người bán trong dữ liệu > og:site_name ngắn > tên miền (bỏ tiêu đề/URL)", () => {
  assert.equal(sellerOf({ offers: { seller: { name: "Điện máy Chợ Lớn" } } }, {}, "x.vn"), "Điện máy Chợ Lớn");
  assert.equal(sellerOf(null, { "og:site_name": ["Điện máy XANH"] }, "dienmayxanh.com"), "Điện máy XANH");
  assert.equal(sellerOf(null, { "og:site_name": ["https://sunhouse.com.vn/"] }, "sunhouse.com.vn"), "sunhouse.com.vn");
  assert.equal(sellerOf(null, { "og:site_name": ["Nồi Chiên Không Dầu Sunhouse - Ưu đãi 2026"] }, "dienmaycholon.com"), "dienmaycholon.com");
});

test("extractFacts trả specs, vat, seller trên trang mẫu", () => {
  const a = extractFacts(pages["/mock/zeta-zf500-shop-a.html"], O + "/mock/zeta-zf500-shop-a.html", { model: "ZF-500", name: "Zeta ZF-500" });
  assert.ok(a.specs.some((s) => s.k === "Công suất" && /1700/.test(s.v)));
  assert.equal(a.seller, "shop.test");
  const b = extractFacts(pages["/mock/zeta-zf500-shop-b.html"], O + "/mock/zeta-zf500-shop-b.html", { model: "ZF-500", name: "Zeta ZF-500" });
  assert.equal(b.vat.state, "included");
  assert.ok(b.specs.some((s) => s.k === "Xuất xứ" && s.v === "Việt Nam"));
});

function entryWith() {
  const plan = makePlan({ text: "Nồi chiên không dầu Zeta ZF-500" });
  const e = newEntry(plan, cacheKey(plan));
  ingestProduct(e, { data: { category: "tech", product: { name: "Nồi chiên không dầu Zeta ZF-500", brand: "Zeta", model: "ZF-500" }, prices: [{ value: 2550000, source: "https://a.vn/p" }, { value: 2490000, source: "https://b.vn/p" }] }, sources: [{ url: "https://a.vn/p" }, { url: "https://b.vn/p" }] });
  return e;
}
const pg = (url, over = {}) => ({ ok: true, url, finalUrl: url, domain: new URL(url).hostname, title: "Zeta ZF-500", h1: "Nồi chiên Zeta ZF-500", relevant: true, seller: new URL(url).hostname, product: { name: "Nồi chiên Zeta ZF-500", brand: "Zeta", price: { value: 2400000, source: "jsonld" } }, specs: [{ k: "Công suất", v: "1700 W" }, { k: "Dung tích", v: "5,5 lít" }], vat: { state: "excluded", text: "Chưa gồm VAT" }, pros: [], cons: [], tech: [], images: [], ...over });

test("offer: giá AI tạo offer chưa xác nhận; đọc trang thì cập nhật giá/VAT/thông số, không nhân đôi", () => {
  const e = entryWith();
  assert.equal(e.offers.length, 2);
  assert.ok(e.offers.every((o) => o.priceVia === "ai" && o.vat.state === "unknown" && o.specs.length === 0));
  ingestPage(e, pg("https://a.vn/p"));
  assert.equal(e.offers.length, 2, "cùng trang cùng model: cập nhật chứ không thêm");
  const a = e.offers.find((o) => o.url === "https://a.vn/p");
  assert.equal(a.price, 2400000);
  assert.equal(a.priceVia, "jsonld");
  assert.equal(a.vat.state, "excluded");
  assert.equal(a.specs.length, 2);
  // trang không khớp model không tạo offer
  ingestPage(e, pg("https://c.vn/x", { relevant: false }));
  assert.equal(e.offers.length, 2);
  // trang khớp nhưng không có giá: vẫn là một NCC (liên hệ báo giá)
  ingestPage(e, pg("https://d.vn/x", { product: { name: "Zeta ZF-500", price: null } }));
  const d = e.offers.find((o) => o.url === "https://d.vn/x");
  assert.equal(d.price, null);
  // hãng khác từ trang liệt kê
  ingestListing(e, { ok: true, url: "https://l.vn/ds", finalUrl: "https://l.vn/ds", domain: "l.vn", title: "ds", seller: "l.vn", vat: { state: "unknown" }, listing: [{ name: "Aurora AF-300", brand: "Aurora", sku: "AF-300", price: 2000000, image: "", url: "https://l.vn/aurora" }] });
  const au = e.offers.find((o) => o.brand === "Aurora");
  assert.deepEqual([au.kind, au.price, au.url], ["other", 2000000, "https://l.vn/aurora"]);
});

test("offersOf: cache cũ (chưa có offers) vẫn ra bảng từ giá và hãng khác đã lưu", () => {
  const e = entryWith();
  const old = JSON.parse(JSON.stringify(e));
  delete old.offers;
  old.alternatives = [{ brand: "Aurora", name: "AF-300", model: "AF-300", price: 1990000, priceSrcId: old.sources[0].id, srcIds: [old.sources[0].id], pros: [], cons: [], tech: [], images: [] }];
  const rows = tableRows(old);
  assert.equal(rows.filter((r) => r.kind === "same").length, 2);
  assert.ok(rows.some((r) => r.kind === "other" && r.brand === "Aurora"));
  assert.ok(rows.every((r) => r.url && r.seller));
});

test("không trùng dòng: offer đã có thì không suy ra thêm từ giá/hãng khác đã lưu", () => {
  const e = entryWith();
  ingestPage(e, pg("https://a.vn/p"));
  ingestListing(e, { ok: true, url: "https://l.vn/ds", finalUrl: "https://l.vn/ds", domain: "l.vn", title: "ds", seller: "l.vn", vat: { state: "unknown" }, listing: [{ name: "Aurora AF-300", brand: "Aurora", sku: "AF-300", price: 2000000, image: "", url: "https://l.vn/aurora" }] });
  const n = e.offers.length;
  assert.equal(tableRows(e).length, n, "số dòng bằng số offer đã lưu");
  assert.equal(offersOf(e).length, n);
});

function rows3() {
  const e = entryWith();
  ingestPage(e, pg("https://a.vn/p", { seller: "Điện máy A", product: { name: "Zeta ZF-500", brand: "Zeta", price: { value: 2600000, source: "jsonld" } }, vat: { state: "included", text: "" } }));
  ingestPage(e, pg("https://b.vn/p", { seller: "Cửa hàng B", product: { name: "Zeta ZF-500", brand: "Zeta", price: { value: 2300000, source: "jsonld" } }, vat: { state: "excluded", text: "" }, specs: [{ k: "Điện áp", v: "220V" }] }));
  ingestPage(e, pg("https://c.vn/p", { seller: "Shop C", product: { name: "Zeta ZF-500", brand: "Zeta", price: null }, vat: { state: "unknown", text: "" }, specs: [] }));
  return tableRows(e);
}

test("lọc và sắp xếp: STT đánh lại, giá thiếu luôn ở cuối, lọc giá '<3tr' '2tr-2tr5' '>2500000'", () => {
  const rows = rows3();
  const asc = applyView(rows, { ...DEFAULT_VIEW });
  assert.deepEqual(asc.map((r) => r.price), [2300000, 2600000, null]);
  assert.deepEqual(asc.map((r) => r.stt), [1, 2, 3]);
  const desc = applyView(rows, { ...DEFAULT_VIEW, sort: { col: "price", dir: "desc" } });
  assert.deepEqual(desc.map((r) => r.price), [2600000, 2300000, null], "giá thiếu vẫn ở cuối khi giảm dần");
  assert.deepEqual(applyView(rows, { ...DEFAULT_VIEW, filters: { ...DEFAULT_VIEW.filters, price: "<2tr5" } }).map((r) => r.price), [2300000]);
  assert.deepEqual(applyView(rows, { ...DEFAULT_VIEW, filters: { ...DEFAULT_VIEW.filters, price: "2tr-2tr7" } }).map((r) => r.seller), ["Cửa hàng B", "Điện máy A"]);
  assert.deepEqual(applyView(rows, { ...DEFAULT_VIEW, filters: { ...DEFAULT_VIEW.filters, price: ">2500000" } }).map((r) => r.seller), ["Điện máy A"]);
  assert.deepEqual(applyView(rows, { ...DEFAULT_VIEW, filters: { ...DEFAULT_VIEW.filters, vat: "excluded" } }).map((r) => r.seller), ["Cửa hàng B"]);
  assert.deepEqual(applyView(rows, { ...DEFAULT_VIEW, q: "điện áp" }).map((r) => r.seller), ["Cửa hàng B"], "lọc nhanh tìm cả trong thông số, không phân biệt dấu");
  assert.deepEqual(applyView(rows, { ...DEFAULT_VIEW, q: "dien may a" }).map((r) => r.seller), ["Điện máy A"]);
  assert.equal(applyView(rows, { ...DEFAULT_VIEW, filters: { ...DEFAULT_VIEW.filters, ncc: "zeta" } }).length, 3, "lọc NCC/hãng gồm cả tên hãng");
  assert.deepEqual(applyView(rows, { ...DEFAULT_VIEW, sort: { col: "ncc", dir: "asc" } }).map((r) => r.seller), ["Cửa hàng B", "Điện máy A", "Shop C"]);
  assert.equal(applyView(rows, { ...DEFAULT_VIEW, kind: "other" }).length, 0);
  assert.equal(priceFilter(""), null);
  assert.equal(priceFilter("<3tr")(2500000), true);
  assert.equal(priceFilter("<3tr")(null), false);
});

test("cellValue khớp đúng các cột mẫu (7 cột yêu cầu + Liên hệ NCC)", () => {
  assert.deepEqual(OFFER_COLUMNS.map((c) => c.label), ["STT", "Tên sản phẩm / mã model", "Đơn giá", "VAT", "Thông tin kỹ thuật bổ sung", "NCC / hãng sản xuất", "Liên hệ NCC", "Link truy vấn thông tin"]);
  const r = applyView(rows3(), DEFAULT_VIEW)[0];
  assert.equal(cellValue(r, "stt"), 1);
  assert.match(cellValue(r, "name"), /Zeta/);
  assert.equal(cellValue(r, "price"), 2300000);
  assert.equal(cellValue(r, "vat"), "Chưa gồm VAT");
  assert.match(cellValue(r, "specs"), /Điện áp: 220V/);
  assert.match(cellValue(r, "ncc"), /NCC: Cửa hàng B\nHãng: Zeta/);
  assert.equal(cellValue(r, "link"), "https://b.vn/p");
  assert.equal(specText([{ k: "a", v: "1" }, { k: "b", v: "2" }], 1), "a: 1");
});

test("xuất xlsx thật (ExcelJS): đúng cột, giá là số, VAT, link bấm được, lọc + cố định dòng đầu, chỉ cột đang hiện", async () => {
  const shown = applyView(rows3(), DEFAULT_VIEW);
  const meta = { product: "Nồi chiên Zeta ZF-500", query: "zeta zf-500", filterText: "VAT: Chưa gồm VAT", generatedAt: Date.UTC(2026, 9, 27) };
  let saved;
  const out = await exportOffersXlsx(shown, OFFER_COLUMNS.map((c) => c.id), meta, { ExcelJS, download: (buf, name) => { saved = { buf, name }; } });
  assert.match(out.name, /^so-sanh-ncc-Noi-chien-Zeta-ZF-500-\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.ok(saved.buf.byteLength > 2000);
  assert.deepEqual([...new Uint8Array(saved.buf).slice(0, 2)], [0x50, 0x4b], "file zip/xlsx hợp lệ (PK)");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(saved.buf);
  const ws = wb.getWorksheet("So sánh NCC");
  assert.deepEqual(ws.getRow(1).values.slice(1), OFFER_COLUMNS.map((c) => c.label));
  assert.equal(ws.rowCount, 4);
  const r2 = ws.getRow(2);
  assert.equal(r2.getCell(1).value, 1);
  assert.equal(r2.getCell(3).value, 2300000);
  assert.match(r2.getCell(3).numFmt, /#,##0/);
  assert.equal(r2.getCell(4).value, "Chưa gồm VAT");
  assert.match(String(r2.getCell(5).value), /Điện áp: 220V/);
  assert.match(String(r2.getCell(6).value), /NCC: Cửa hàng B/);
  assert.equal(r2.getCell(7).value, "", "chưa có thông tin liên hệ");
  assert.equal(r2.getCell(8).value.hyperlink, "https://b.vn/p");
  assert.equal(ws.getRow(4).getCell(3).value, "Liên hệ", "không có giá");
  assert.ok(ws.autoFilter, "có bộ lọc Excel");
  assert.equal(ws.views[0].state, "frozen");
  const info = wb.getWorksheet("Thông tin");
  assert.equal(info.getCell("B1").value, "Nồi chiên Zeta ZF-500");
  assert.match(String(info.getCell("B5").value), /VAT/);

  // chỉ xuất các cột đang hiện (ví dụ ẩn thông số và link)
  const wb2 = buildWorkbook(ExcelJS, shown, ["stt", "name", "price", "vat", "ncc"], meta);
  assert.deepEqual(wb2.getWorksheet("So sánh NCC").getRow(1).values.slice(1), ["STT", "Tên sản phẩm / mã model", "Đơn giá", "VAT", "NCC / hãng sản xuất"]);
  assert.equal(xlsxFileName({ product: "Đèn LED 12W" }, new Date("2026-10-27")), "so-sanh-ncc-Den-LED-12W-2026-10-27.xlsx");
});

test("pipeline: bảng NCC được tạo từ các trang thật đã đọc (giá, VAT, thông số, NCC, link)", async () => {
  const real = globalThis.fetch;
  const fake = (input, init = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.pathname.startsWith("/api/")) return handle(new Request(u, init), { MOCK: "1", ALLOW_LOCAL: "1" });
    const html = pages[u.pathname];
    return Promise.resolve(html ? new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("nf", { status: 404 }));
  };
  globalThis.fetch = fake;
  try {
    const api = createApi(() => ({ apiBase: "http://localhost:8787" }), fake);
    const entry = await research({ text: "Nồi chiên không dầu Zeta ZF-500" }, { api, store: createMemoryStore(), perHostCap: 99, freeGapMs: 0 });
    const rows = applyView(tableRows(entry), DEFAULT_VIEW);
    assert.ok(rows.length >= 4, "nhiều NCC/hãng: " + rows.length);
    const same = rows.filter((r) => r.kind === "same");
    assert.ok(same.length >= 2);
    assert.ok(same.every((r) => r.url.startsWith("http://localhost:8787/mock/")), "link là trang thật đã đọc");
    const withSpecs = same.find((r) => r.specs.length);
    assert.ok(withSpecs && withSpecs.specs.some((s) => /Công suất|Xuất xứ/.test(s.k)));
    assert.ok(same.some((r) => r.vat.state === "included"), "trang ghi 'đã bao gồm VAT' được nhận ra");
    assert.ok(same.some((r) => r.priceVia === "jsonld" || r.priceVia === "meta"));
    assert.ok(rows.some((r) => r.kind === "other"));
    assert.deepEqual(rows.map((r) => r.stt), rows.map((_, i) => i + 1));
  } finally { globalThis.fetch = real; }
});
