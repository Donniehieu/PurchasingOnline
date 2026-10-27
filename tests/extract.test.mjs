import test from "node:test";
import assert from "node:assert/strict";
import { extractFacts, parseOfferPrice, proConSections, techNames } from "../web/js/lib/extract.js";
import { checkUrl } from "../worker/safe-url.js";
import { mockPages } from "../dev/mock-pages.mjs";

const O = "https://shop.test";
const pages = mockPages(O);
const HINT = { model: "ZF-500", name: "Nồi chiên không dầu Zeta ZF-500", brand: "Zeta" };

test("trang có JSON-LD: lấy giá, hãng, ảnh, ưu/nhược điểm, công nghệ; bỏ logo", () => {
  const f = extractFacts(pages["/mock/zeta-zf500-shop-a.html"], O + "/mock/zeta-zf500-shop-a.html", HINT);
  assert.equal(f.relevant, true);
  assert.equal(f.product.price.value, 2490000);
  assert.equal(f.product.price.source, "jsonld");
  assert.equal(f.product.brand, "Zeta");
  assert.equal(f.product.rating.value, 4.6);
  assert.equal(f.pros.length, 3);
  assert.match(f.pros[0], /5,5 lít/);
  assert.equal(f.cons.length, 2);
  assert.ok(f.tech.includes("Công nghệ Rapid Air"));
  assert.ok(f.images.length >= 2);
  assert.ok(!f.images.some((i) => /logo/.test(i.url)));
  assert.ok(f.images[0].url.endsWith("/1.png") || f.images[0].url.endsWith("/2.png"));
});

test("bài đánh giá: ưu/nhược trong đoạn văn dạng gạch đầu dòng, giá trong câu", () => {
  const f = extractFacts(pages["/mock/zeta-zf500-review.html"], O + "/mock/zeta-zf500-review.html", HINT);
  assert.equal(f.relevant, true);
  assert.equal(f.pros.length, 3);
  assert.equal(f.cons.length, 2);
  assert.equal(f.product.price.value, 2550000);
  assert.equal(f.product.price.source, "text");
  assert.deepEqual(f.tech.sort(), ["Công nghệ Eco Heat", "Công nghệ Rapid Air"]);
});

test("giá từ meta, ảnh lazy data-src", () => {
  const f = extractFacts(pages["/mock/zeta-zf500-shop-b.html"], O + "/mock/zeta-zf500-shop-b.html", HINT);
  assert.equal(f.product.price.value, 2390000);
  assert.equal(f.product.price.source, "meta");
  assert.ok(f.images.length >= 1);
});

test("trang sản phẩm khác model bị coi là không khớp và không đóng góp ưu/nhược/công nghệ", () => {
  const f = extractFacts(pages["/mock/aurora-af300.html"], O + "/mock/aurora-af300.html", HINT);
  assert.equal(f.relevant, false);
  assert.deepEqual(f.pros, []);
  assert.deepEqual(f.tech, []);
});

test("parseOfferPrice: định dạng Việt Nam và ngoại tệ", () => {
  assert.deepEqual(parseOfferPrice("2.490.000", "VND"), { value: 2490000, currency: "VND" });
  assert.deepEqual(parseOfferPrice("2490000.00", "VND"), { value: 2490000, currency: "VND" });
  assert.deepEqual(parseOfferPrice(1990000), { value: 1990000, currency: "VND" });
  assert.equal(parseOfferPrice("199.99", "USD").value, undefined);
  assert.equal(parseOfferPrice("", "VND"), null);
});

test("proConSections: dòng inline và dừng ở tiêu đề kế tiếp", () => {
  const r = proConSections(["Ưu điểm: chạy rất êm khi vận hành; tiết kiệm điện năng đáng kể; dễ vệ sinh bộ lọc", "Tổng kết", "Nhược điểm", "- Giá cao so với mặt bằng chung", "- Phụ kiện khó mua ở tỉnh", "Kết luận"]);
  assert.equal(r.pros.length, 3);
  assert.equal(r.cons.length, 2);
});

test("techNames dừng ở từ nối", () => {
  assert.deepEqual(techNames("Máy dùng công nghệ Inverter giúp tiết kiệm điện và Công nghệ Plasma Cluster của hãng"), ["Công nghệ Inverter", "Công nghệ Plasma Cluster"]);
});

test("checkUrl chặn địa chỉ nội bộ", () => {
  for (const bad of ["http://localhost/x", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest", "http://[::1]/", "http://intranet/", "ftp://a.com/", "https://a.com:8443/", "http://user:pw@a.com/", "http://2130706433/"]) {
    assert.equal(checkUrl(bad).ok, false, bad);
  }
  assert.equal(checkUrl("https://www.thegioididong.com/may-chien").ok, true);
  assert.equal(checkUrl("http://localhost:8787/x", { allowLocal: true }).ok, true);
});
