// Liên hệ NCC, trang cửa hàng từ Google, dữ liệu chỉ từ đúng link, nhóm theo NCC/hãng, chẩn đoán khi không có dữ liệu.
import test from "node:test";
import assert from "node:assert/strict";
import { extractContacts, normalizePhone, mergeContact, contactText, hasContact } from "../web/js/lib/contact.js";
import { newEntry, ingestProduct, ingestPage, ingestCompare, ingestContactPage, sellersNeedingContact, mergeSellerContact } from "../web/js/lib/entry.js";
import { pickPages, enough } from "../web/js/lib/pipeline.js";
import { tableRows, applyView, DEFAULT_VIEW, cellValue, diagnose, isRead } from "../web/js/lib/offers.js";
import { makePlan, cacheKey } from "../web/js/lib/plan.js";

const SHOP = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Điện máy A","telephone":"+84 24 3736 6676","email":"info@dienmay-a.vn","address":{"@type":"PostalAddress","streetAddress":"Số 35 Mạc Thái Tổ","addressLocality":"Cầu Giấy","addressRegion":"Hà Nội"}}</script></head>
<body><header><a href="tel:0901234567">Gọi ngay</a> Hotline: <b>1800 6680</b> <a href="/lien-he.html">Liên hệ</a></header>
<main><h1>Nồi chiên Zeta ZF-500</h1><p>Giá 1.190.000đ, mã 0901234567890 không phải số điện thoại 2.490.000</p></main>
<footer>Địa chỉ: Tầng 12, Tòa nhà Richy, Số 35 Mạc Thái Tổ, Cầu Giấy, Hà Nội Điện thoại: 0243 736 6676 Email: ban-hang@dienmay-a.vn
<a href="https://zalo.me/0912345678">Zalo</a> <a href="https://zalo.me/share">chia sẻ</a> <img src="logo@2x.png"></footer></body></html>`;

test("normalizePhone: di động, máy bàn, tổng đài; bỏ số không đúng dạng (giá, mã)", () => {
  assert.equal(normalizePhone("+84 912 345 678"), "0912 345 678");
  assert.equal(normalizePhone("0901.234.567"), "0901 234 567");
  assert.equal(normalizePhone("024 3736 6676"), "0243 736 6676");
  assert.equal(normalizePhone("1800 6680"), "1800 6680");
  assert.equal(normalizePhone("1900232461"), "1900 232461");
  assert.equal(normalizePhone("1190000"), "");
  assert.equal(normalizePhone("0123456789"), "", "đầu số 01 không còn dùng");
});

test("extractContacts: tel:/mailto:/zalo, dữ liệu cấu trúc, header/footer, trang liên hệ; không nhầm giá và ảnh", () => {
  const c = extractContacts(SHOP, "https://dienmay-a.vn/noi-chien/zf500");
  assert.ok(c.phones.includes("0901 234 567") && c.phones.includes("1800 6680") && c.phones.includes("0243 736 6676"), c.phones.join(","));
  assert.ok(!c.phones.some((p) => /119|249|0901 234 567 890/.test(p)), "không lấy giá/mã làm số điện thoại");
  assert.deepEqual(c.emails.sort(), ["ban-hang@dienmay-a.vn", "info@dienmay-a.vn"]);
  assert.ok(!c.emails.some((e) => /png/.test(e)));
  assert.deepEqual(c.zalo, ["0912 345 678"], "bỏ liên kết chia sẻ của Zalo");
  assert.match(c.address, /Mạc Thái Tổ/);
  assert.equal(c.contactUrl, "https://dienmay-a.vn/lien-he.html");
  assert.equal(extractContacts("<html><body>không có gì</body></html>", "https://x.vn").phones.length, 0);
  assert.equal(hasContact(c), true);
  assert.match(contactText(c), /SĐT: .*\nEmail: .*\nZalo: .*\nĐịa chỉ: /);
});

test("extractContacts: không nhận Zalo plugin/widget và không lấy nhãn 'Điện thoại:' làm địa chỉ", () => {
  const c = extractContacts('<footer><a href="https://zalo.me/plugins">z</a> <a href="https://sp.zalo.me/plugins/sdk.js">z</a> <a href="https://zalo.me/0988776655">chat</a> Địa chỉ: Điện thoại: 0243 736 6676 Email: a@b.vn</footer>', "https://x.vn");
  assert.deepEqual(c.zalo, ["0988 776 655"]);
  assert.equal(c.address, "");
});

test("mergeContact: gộp nhiều trang cùng NCC, không trùng, giữ trang liên hệ", () => {
  const a = mergeContact(null, { phones: ["0901 234 567"], emails: [], zalo: [], address: "", contactUrl: "https://x.vn/lien-he" }, "https://x.vn/p1");
  const b = mergeContact(a, { phones: ["0901 234 567", "1800 6680"], emails: ["a@x.vn"], zalo: [], address: "Hà Nội, Việt Nam", contactUrl: "" }, "https://x.vn/p2");
  assert.deepEqual(b.phones, ["0901 234 567", "1800 6680"]);
  assert.equal(b.contactUrl, "https://x.vn/lien-he");
  assert.deepEqual(b.srcUrls, ["https://x.vn/p1", "https://x.vn/p2"]);
});

const plan = makePlan({ text: "Nồi chiên không dầu Zeta ZF-500" });
const mk = () => newEntry(plan, cacheKey(plan));
const pg = (url, over = {}) => ({ ok: true, url, finalUrl: url, domain: new URL(url).hostname, title: "Zeta ZF-500", h1: "Zeta ZF-500", relevant: true, seller: new URL(url).hostname, product: { name: "Nồi chiên Zeta ZF-500", brand: "Zeta", price: { value: 2400000, source: "jsonld" } }, specs: [{ k: "Công suất", v: "1700 W" }], vat: { state: "unknown" }, contact: { phones: [], emails: [], zalo: [], address: "", contactUrl: "" }, pros: [], cons: [], tech: [], images: [], ...over });

test("liên hệ theo NCC: gộp từ mọi trang cùng website, hiện ở mọi dòng của NCC đó; mở trang Liên hệ một lần cho NCC thiếu SĐT", () => {
  const e = mk();
  ingestPage(e, pg("https://a.vn/p1", { contact: { phones: [], emails: [], zalo: [], address: "", contactUrl: "https://a.vn/lien-he" } }));
  ingestPage(e, pg("https://b.vn/p1", { contact: { phones: ["0901 234 567"], emails: ["b@b.vn"], zalo: [], address: "", contactUrl: "https://b.vn/lien-he" } }));
  assert.deepEqual(sellersNeedingContact(e, 5), [{ domain: "a.vn", url: "https://a.vn/lien-he" }], "chỉ NCC chưa có SĐT/email mà biết trang liên hệ");
  ingestContactPage(e, "a.vn", pg("https://a.vn/lien-he", { contact: { phones: ["1800 6680"], emails: [], zalo: [], address: "Hà Nội, Việt Nam", contactUrl: "" }, relevant: false, product: {} }));
  assert.deepEqual(sellersNeedingContact(e, 5), [], "không mở lại");
  const rows = tableRows(e);
  assert.match(rows.find((r) => r.seller === "a.vn").contactText, /1800 6680/);
  assert.match(rows.find((r) => r.seller === "b.vn").contactText, /b@b\.vn/);
  assert.match(cellValue(rows[0], "contact"), /SĐT|Email/);
  // trang liên hệ lỗi: ghi nhận, không thử lại
  const f = mk();
  ingestPage(f, pg("https://c.vn/p", { contact: { phones: [], emails: [], zalo: [], address: "", contactUrl: "https://c.vn/lh" } }));
  ingestContactPage(f, "c.vn", { ok: false, url: "https://c.vn/lh", error: "HTTP 404" });
  assert.equal(sellersNeedingContact(f).length, 0);
  assert.ok(f.log.some((l) => /Trang liên hệ c\.vn: bỏ qua/.test(l.msg)));
});

test("NCC chỉ có SĐT (chưa có email/địa chỉ) cũng được mở trang Liên hệ một lần", () => {
  const e = mk();
  ingestPage(e, pg("https://c.vn/p", { contact: { phones: ["0901 234 567"], emails: [], zalo: [], address: "", contactUrl: "https://c.vn/lien-he" } }));
  assert.deepEqual(sellersNeedingContact(e), [{ domain: "c.vn", url: "https://c.vn/lien-he" }]);
  ingestContactPage(e, "c.vn", pg("https://c.vn/lien-he", { contact: { phones: [], emails: ["sale@c.vn"], zalo: [], address: "", contactUrl: "" }, relevant: false, product: {} }));
  assert.match(tableRows(e)[0].contactText, /0901 234 567\nEmail: sale@c\.vn/);
});

test("dữ liệu của dòng chỉ lấy từ đúng link; AI/Google/danh sách là 'chưa xác nhận' và mặc định bị ẩn", () => {
  const e = mk();
  ingestProduct(e, { data: { category: "tech", product: { name: "Zeta ZF-500", brand: "Zeta", model: "ZF-500" }, prices: [{ value: 2000000, source: "https://ai.vn/p" }] }, sources: [{ url: "https://ai.vn/p" }] });
  ingestPage(e, pg("https://real.vn/zf500"));
  const rows = tableRows(e);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.url === "https://real.vn/zf500").read, true);
  assert.equal(rows.find((r) => r.url === "https://ai.vn/p").read, false);
  const shown = applyView(rows, DEFAULT_VIEW);
  assert.deepEqual(shown.map((r) => r.url), ["https://real.vn/zf500"]);
  assert.equal(applyView(rows, { ...DEFAULT_VIEW, source: "all" }).length, 2);
  assert.equal(isRead({ priceVia: "jsonld" }), true, "dữ liệu cũ chưa có cờ: suy từ nguồn giá");
  assert.equal(isRead({ priceVia: "ai" }), false);
  // khi đọc đúng trang đó thì dòng được xác nhận và lấy giá/thông số của trang
  ingestPage(e, pg("https://ai.vn/p", { product: { name: "Zeta ZF-500", brand: "Zeta", price: { value: 2100000, source: "jsonld" } } }));
  const r = tableRows(e).find((x) => x.url === "https://ai.vn/p");
  assert.deepEqual([r.read, r.price, r.specs.length], [true, 2100000, 1]);
});

test("nhóm theo NCC (website) hoặc theo hãng; STT liên tục", () => {
  const e = mk();
  ingestPage(e, pg("https://a.vn/1", { product: { name: "Zeta", brand: "Zeta", price: { value: 3, source: "jsonld" } } }));
  ingestPage(e, pg("https://b.vn/1", { product: { name: "Zeta", brand: "Zeta", price: { value: 1, source: "jsonld" } } }));
  ingestPage(e, pg("https://a.vn/2", { product: { name: "Zeta 2", brand: "Zeta", price: { value: 2, source: "jsonld" } }, finalUrl: "https://a.vn/2" }));
  const rows = tableRows(e);
  const bySeller = applyView(rows, { ...DEFAULT_VIEW, group: "seller" });
  assert.deepEqual(bySeller.map((r) => r.seller), ["b.vn", "a.vn", "a.vn"], "nhóm đứng cạnh nhau, nhóm có giá thấp nhất lên đầu");
  assert.deepEqual(bySeller.map((r) => r.group), ["b.vn", "a.vn", "a.vn"]);
  assert.deepEqual(bySeller.map((r) => r.stt), [1, 2, 3]);
  assert.equal(applyView(rows, { ...DEFAULT_VIEW, group: "brand" }).every((r) => r.group === "Zeta"), true);
});

function shopEntry() {
  const e = mk();
  e.product.model = "ZF-500";
  const add = (url, title, kind) => { const id = (e.sources.push({ id: e.sources.length + 1, key: url, url, title, domain: new URL(url).hostname, via: "ai", verified: true, kind }), e.sources.length); return id; };
  const cited = add("https://blog.vn/danh-gia", "Đánh giá Zeta", "");
  e.pros.push({ text: "Làm nóng nhanh chỉ hai phút", srcId: cited, verified: true, via: "ai" });
  e.prices.push({ value: 1, srcId: cited, via: "ai" });
  for (const [u, t] of [["https://shop1.vn/zf500", "Zeta ZF-500 chính hãng"], ["https://shop2.vn/khac", "Nồi chiên khác"], ["https://shop3.vn/zf-500-gia", "Mua ZF-500 giá tốt"], ["https://shop4.vn/a", "Zeta ZF-500 4"], ["https://shop5.vn/a", "Zeta ZF-500 5"], ["https://shop6.vn/a", "Zeta ZF-500 6"], ["https://shop7.vn/a", "Zeta ZF-500 7"]]) add(u, t, "shop");
  return e;
}

test("pickPages: trang CỬA HÀNG trong kết quả Google được mở trước (không bị nguồn AI trích dẫn chiếm chỗ), trang có model lên trước", () => {
  const e = shopEntry();
  const picks = pickPages(e, 10, 2);
  const urls = picks.map((p) => p.url);
  assert.ok(urls.slice(0, 3).every((u) => /shop/.test(u)), "ưu tiên trang cửa hàng: " + urls.join(","));
  assert.ok(urls.indexOf("https://shop2.vn/khac") > urls.indexOf("https://shop3.vn/zf-500-gia"), "trang có mã model đứng trước");
  assert.ok(urls.filter((u) => /shop/.test(u)).length >= 6, "mở nhiều cửa hàng cho bảng NCC");
  assert.ok(urls.includes("https://blog.vn/danh-gia"), "vẫn mở bài đánh giá được trích dẫn");
  assert.ok(picks.length <= 10);
});

test("enough(): cần đủ NCC (≥5) đã đọc từ đúng trang mới dừng mở thêm", () => {
  const e = mk();
  for (let i = 0; i < 5; i++) ingestPage(e, pg(`https://s${i}.vn/p`, { pros: ["Ưu điểm số " + i + " dài đủ"], cons: ["Nhược điểm số " + i + " dài đủ"], images: [{ url: `https://s${i}.vn/i.jpg`, alt: "", score: 3 }] }));
  e.prices.push(...[1, 2, 3, 4].map((v) => ({ value: v })));
  e.pros.push(...[1, 2, 3, 4].map((v) => ({ text: "p" + v })));
  e.cons.push(...[1, 2, 3].map((v) => ({ text: "c" + v })));
  e.images.push(...[1, 2, 3].map((v) => ({ url: "i" + v })));
  assert.equal(enough(e), true);
  e.offers = e.offers.slice(0, 3);
  assert.equal(enough(e), false);
});

test("diagnose: nói rõ vì sao không có dữ liệu và cách khắc phục", () => {
  const blocked = mk();
  blocked.log.push({ ts: 1, kind: "error", msg: "Công cụ tìm kiếm miễn phí không trả kết quả (DuckDuckGo yêu cầu xác minh)" });
  const d1 = diagnose(blocked, 0, 0);
  assert.match(d1.title, /DuckDuckGo/);
  assert.ok(d1.tips.some((t) => /tiện ích Chrome/.test(t)) && d1.tips.some((t) => /dán link/i.test(t)));
  const cap = mk();
  cap.pages.push({ ok: true, url: "https://a.vn" });
  cap.log.push({ ts: 1, kind: "error", msg: "Google yêu cầu xác minh (CAPTCHA)" });
  assert.match(diagnose(cap, 0, 0).title, /CAPTCHA/);
  const hidden = mk();
  hidden.pages.push({ ok: true, url: "https://a.vn" });
  assert.match(diagnose(hidden, 0, 3).title, /3 dòng chưa đọc/);
  const none = mk();
  none.pages.push({ ok: true, url: "https://a.vn" });
  assert.match(diagnose(none, 0, 0).title, /khác model/);
  const b = mk();
  b.pages.push({ ok: true, url: "https://a.vn" }, { ok: false, url: "https://b.vn", error: "Trang chặn truy cập tự động (HTTP 403)" });
  assert.ok(diagnose(b, 2, 0).tips.some((t) => /1 trang chặn/.test(t)));
});
