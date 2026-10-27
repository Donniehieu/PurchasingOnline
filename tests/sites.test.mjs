// Đọc giá trên nhiều kiểu website (không chỉ Next.js): JSON-LD dạng đồ thị, vi dữ liệu, WooCommerce, Magento, Shopify,
// trang tự viết, trang ghi "Liên hệ", trang tải giá bằng JavaScript. Mẫu HTML mô phỏng cấu trúc của từng nền tảng.
import test from "node:test";
import assert from "node:assert/strict";
import { extractFacts, jsonLdProducts } from "../web/js/lib/extract.js";
import { DEFAULT_CFG, PRESETS, LIMITS, normalizeCfg, matchPreset, cfgFromSettings } from "../web/js/lib/config.js";

const page = (head, body) => `<html><head><title>x</title>${head}</head><body>${body}</body></html>`;
const facts = (html, name = "") => extractFacts(html, "https://shop.vn/p/abc", { model: "", name, brand: "" });

test("JSON-LD dạng đồ thị (ASP.NET lớn): Product.offers chỉ là tham chiếu @id, giá nằm ở nút Offer khác", () => {
  const ld = JSON.stringify({ "@context": "https://schema.org", "@graph": [
    { "@type": "ProductGroup", name: "Điện thoại Samsung Galaxy Z Fold8" },
    { "@type": "Product", name: "Samsung Galaxy Z Fold8 12GB/256GB", sku: "123", offers: { "@id": "https://shop.vn/p/abc?code=123#offer" } },
    { "@type": "Offer", "@id": "https://shop.vn/p/abc?code=123#offer", price: 48990000, priceCurrency: "VND" },
  ] });
  const f = facts(page(`<script type="application/ld+json">${ld}</script>`, "<h1>Samsung Galaxy Z Fold8</h1>"));
  assert.deepEqual(f.product.price, { value: 48990000, source: "jsonld" });
  assert.equal(f.product.sku, "123", "chọn sản phẩm có giá, không chọn nhóm biến thể không giá");
  assert.equal(jsonLdProducts(page(`<script type="application/ld+json">${ld}</script>`, "")).length, 2);
});

test("vi dữ liệu / thuộc tính giá: itemprop=price, data-price-amount (Magento), WooCommerce", () => {
  assert.equal(facts(page("", `<h1>Máy bơm</h1><span itemprop="price" content="1250000">1.250.000đ</span>`)).product.price.value, 1250000);
  assert.equal(facts(page("", `<h1>Tủ</h1><span class="price-wrapper" data-price-amount="8990000" data-price-type="finalPrice"><span class="price">8.990.000 ₫</span></span>`)).product.price.value, 8990000);
  assert.equal(facts(page("", `<h1>Áo</h1><p class="price"><span class="woocommerce-Price-amount amount"><bdi>350.000&nbsp;<span class="woocommerce-Price-currencySymbol">₫</span></bdi></span></p>`)).product.price.value, 350000);
});

test("Shopify/Haravan: meta og:price:amount; trang tự viết có giá cũ gạch và giá bán", () => {
  const f = facts(page(`<meta property="og:price:amount" content="250000"><meta property="og:price:currency" content="VND">`, "<h1>Sản phẩm</h1>"));
  assert.deepEqual(f.product.price, { value: 250000, source: "meta" });
  const sale = facts(page("", `<h1>Quạt công nghiệp</h1><div class="product-price"><del class="old-price">999.000đ</del> <span class="price">750.000đ</span></div>`));
  assert.equal(sale.product.price.value, 750000, "bỏ giá cũ gạch");
});

test("trang tự viết: giá đứng ngay sau tên sản phẩm, không gắn nhãn 'giá'; bỏ dòng giảm giá/trả góp", () => {
  const f = facts(page("", `<h1>Máy bơm nước Pentax CM 1HP</h1><div>Mã: CM100</div><div>Trả góp 0% từ 300.000đ/tháng</div><div>1.250.000 đ</div><div>Giảm 10%</div>`));
  assert.equal(f.product.price.value, 1250000);
  assert.equal(f.priceHint, "");
});

test("không đọc được giá thì nói rõ vì sao: 'Liên hệ báo giá' hoặc 'trang tải giá bằng JavaScript'", () => {
  const contact = facts(page("", `<h1>Đồng hồ áp suất Wika</h1><div>Giá: Liên hệ</div><div>Hotline 0901234567</div>`));
  assert.equal(contact.product.price, null);
  assert.equal(contact.priceHint, "contact");
  const spa = facts(page("", `<div id="root"></div><noscript>You need to enable JavaScript</noscript><script src="/app.js"></script>`));
  assert.equal(spa.product.price, null);
  assert.equal(spa.priceHint, "js");
  assert.equal(facts(page("", `<h1>Ghế</h1><div>Mô tả sản phẩm dài không có giá niêm yết ở đây.</div>`)).priceHint, "", "không phải SPA, không ghi liên hệ");
});

test("cấu hình tìm kiếm: mẫu có sẵn, ép vào khoảng an toàn, nhận ra mẫu, đổi từ cài đặt cũ", () => {
  assert.equal(matchPreset(DEFAULT_CFG), "balanced");
  assert.equal(matchPreset(PRESETS.fast.cfg), "fast");
  assert.equal(matchPreset(PRESETS.full.cfg), "full");
  assert.equal(matchPreset({ ...DEFAULT_CFG, images: 7 }), "custom");
  const c = normalizeCfg({ pagesFull: 999, images: 0, concurrency: "x", perHost: 3.4, contactPages: 0 });
  assert.equal(c.pagesFull, LIMITS.pagesFull[1]);
  assert.equal(c.images, LIMITS.images[0]);
  assert.equal(c.concurrency, DEFAULT_CFG.concurrency, "giá trị rác dùng mặc định");
  assert.equal(c.perHost, 3);
  assert.equal(c.contactPages, false);
  assert.equal(c.supplement, true, "thiếu thì dùng mặc định");
  assert.equal(cfgFromSettings({ pages: 20 }).pagesFull, 20, "cài đặt cũ chỉ có 'pages'");
  assert.deepEqual(cfgFromSettings({}), DEFAULT_CFG);
  for (const p of Object.values(PRESETS)) assert.deepEqual(normalizeCfg(p.cfg), p.cfg, "mẫu nằm trong khoảng cho phép");
});
