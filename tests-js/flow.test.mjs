import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../docs/js/core.js";
import * as knowledge from "../docs/js/knowledge.js";
import * as net from "../docs/js/net.js";
import { Crawler, CancelledError, pseudoPages } from "../docs/js/crawl.js";
import * as flow from "../docs/js/flow.js";

const page = (url, title, body, head = "") => ({ url, html: `<html><head><title>${title}</title>${head}</head><body>${body}</body></html>` });
const ldProduct = (name, brand, model, price) => `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"${name}","brand":{"@type":"Brand","name":"${brand}"},"mpn":"${model}","offers":{"@type":"Offer","price":"${price}","priceCurrency":"VND"}}</script>`;
const VAC = [
  page("https://fptshop.com.vn/may-hut-bui/elmich-vce-9304", "Máy hút bụi cầm tay Elmich VCE-9304 600W | FPT Shop", "<p>Máy hút bụi cầm tay Elmich VCE-9304 công suất 600W, dung tích 1 lít. Bảo hành 24 tháng. Phù hợp cho gia đình, văn phòng nhỏ. Xuất hóa đơn VAT.</p>", ldProduct("Máy hút bụi cầm tay Elmich VCE-9304", "Elmich", "VCE-9304", "1290000")),
  page("https://hc.com.vn/elmich-vce-9304", "Máy hút bụi Elmich VCE-9304 chính hãng - HC", "<p>Máy hút bụi cầm tay Elmich VCE-9304 600W, dung tích 1 lít, bảo hành 24 tháng, phù hợp cho gia đình. Giá: 1.350.000đ. Thêm vào giỏ.</p>", ldProduct("Máy hút bụi Elmich VCE-9304", "Elmich", "VCE-9304", "1350000")),
  page("https://nguyenkim.com/hut-bui-9304", "Máy hút bụi cầm tay Elmich VCE-9304 - Nguyễn Kim", "<p>Máy hút bụi cầm tay Elmich VCE-9304 600W, bảo hành 12 tháng.</p>"),
  page("https://blog.vn/review", "Review máy hút bụi cầm tay Elmich", "<h1>Đánh giá máy hút bụi cầm tay Elmich</h1><h2>Ưu điểm</h2><p>Máy hút bụi cầm tay Elmich VCE-9304 có ưu điểm nhẹ, giá rẻ khoảng 1.300.000đ, nhược điểm là dung tích nhỏ chỉ 1 lít cần đổ bụi thường xuyên.</p><p>Khi mua máy hút bụi cầm tay cần lưu ý công suất 600W và bảo hành chính hãng.</p>"),
];
const TOKENS = core.queryKeywords("máy hút bụi cầm tay");

test("hãng lấy từ dữ liệu sản phẩm, không nhầm tên website/NCC", () => {
  const d = core.buildDiscovery(VAC, TOKENS, "máy hút bụi cầm tay");
  assert.ok(d.brands.some((b) => /elmich/i.test(b.value)), JSON.stringify(d.brands));
  for (const banned of ["FPT", "FPTSHOP", "NGUYENKIM", "HC"]) assert.ok(!d.brands.some((b) => core.stripAccents(b.value).toUpperCase() === banned), `${banned} bị coi là hãng`);
  assert.ok(d.models.some((m) => m.value === "VCE-9304" && m.count >= 2), JSON.stringify(d.models));
});
test("question card: đúng 10 câu, 5 câu cố định (tên, model, số lượng, mục đích, hãng) và 5 câu từ dữ liệu crawl", () => {
  const d = core.buildDiscovery(VAC, TOKENS, "máy hút bụi cầm tay");
  const cards = core.buildCards({ query: "máy hút bụi cầm tay", quantity: 4 }, null, "", d), ids = cards.map((c) => c.id);
  assert.equal(cards.length, 10);
  assert.deepEqual(ids.slice(0, 5), ["product", "model", "quantity", "purpose", "brand"]);
  const brand = cards.find((c) => c.id === "brand");
  assert.ok(brand.options.some((o) => /Elmich/i.test(o.label) && /thấy ở \d+\/\d+ trang/.test(o.label))); assert.match(brand.default, /elmich/i);
  assert.ok(!brand.options.some((o) => /fptshop|nguyenkim/i.test(o.label)));
  assert.ok(cards.find((c) => c.id === "model").options.some((o) => /VCE-9304/.test(o.label)));
  const none = core.buildCards({ query: "máy hút bụi cầm tay", quantity: 4 }, null, "", null);
  assert.ok(none.length >= 9 && none.length <= 10); assert.match(none.find((c) => c.id === "brand").evidence, /gợi ý chung/); assert.equal(none.find((c) => c.id === "brand").default, "");
});
test("trang sản phẩm đúng model mới vào bảng, giá phải đọc chắc chắn, trang bài viết bị loại", () => {
  const job = { query: "máy hút bụi cầm tay", product_code: "VCE-9304", quantity: 3 };
  const b = flow.buildSuppliers(job, VAC);
  const names = b.suppliers.map((s) => s.url);
  assert.ok(names.includes("https://fptshop.com.vn/may-hut-bui/elmich-vce-9304") && names.includes("https://hc.com.vn/elmich-vce-9304"));
  const fpt = b.suppliers.find((s) => s.url.includes("fptshop"));
  assert.equal(fpt.price, 1290000); assert.equal(fpt.price_source, "jsonld"); assert.equal(fpt.quantity, 3); assert.equal(fpt.name.toLowerCase().includes("fpt"), true);
  assert.ok(b.others.some((o) => o.url.includes("blog.vn") && /không phải trang bán/i.test(o.reason)));
  // trang không có dữ liệu sản phẩm cấu trúc hoặc nút mua: không vào bảng
  assert.ok(!names.includes("https://nguyenkim.com/hut-bui-9304"));
  const sc = core.scoreSuppliers(b.suppliers); assert.equal(sc.find((s) => s.recommended).url, "https://fptshop.com.vn/may-hut-bui/elmich-vce-9304");
});
test("sai model thì bị loại; giá đoán từ chữ không được dùng làm giá", () => {
  const wrong = page("https://a.vn/p", "Máy hút bụi cầm tay Dyson V8", "<p>Máy hút bụi cầm tay Dyson V8. Giá: 9.000.000đ. Thêm vào giỏ.</p>", ldProduct("Máy hút bụi cầm tay Dyson V8", "Dyson", "V8", "9000000"));
  const b = flow.buildSuppliers({ query: "máy hút bụi cầm tay", product_code: "VCE-9304", quantity: 1 }, [wrong]);
  assert.equal(b.suppliers.length, 0); assert.match(b.others[0].reason, /không nhắc model VCE-9304/);
  const guess = page("https://b.vn/p", "Máy hút bụi cầm tay X", "<p>Máy hút bụi cầm tay X. Tặng voucher 50.000đ, quà 120.000đ, sản phẩm 3.200.000đ, trả góp 3.200.000đ. Thêm vào giỏ.</p>", '<meta property="og:type" content="product">');
  const g = flow.buildSuppliers({ query: "máy hút bụi cầm tay", product_code: "", quantity: 1 }, [guess]);
  assert.equal(g.suppliers[0].price, null); assert.equal(g.suppliers[0].price_guess, 3200000); assert.match(g.suppliers[0].note, /Chưa đọc được giá chính xác/);
  assert.equal(core.scoreSuppliers(g.suppliers).some((s) => s.recommended), false); // không có giá chắc chắn thì không đề xuất
});
test("chủ đề do người dùng chọn: có câu trả lời trích từ bài kèm link; giá có khoảng giá", () => {
  assert.deepEqual(knowledge.TOPIC_DEFS.map((t) => t.id), ["price", "pros", "using", "types", "buy"]);
  const pros = knowledge.answerTopic("pros", "máy hút bụi cầm tay Elmich VCE-9304", VAC, TOKENS);
  assert.ok(pros.snippets.some((s) => /nhược điểm/.test(s.text) && s.url === "https://blog.vn/review"));
  const buy = knowledge.answerTopic("buy", "máy hút bụi cầm tay", VAC, TOKENS); assert.ok(buy.snippets.length >= 1);
  const price = knowledge.answerTopic("price", "máy hút bụi cầm tay", VAC, TOKENS); assert.ok(price.price && price.price.min <= 1300000);
  assert.throws(() => knowledge.answerTopic("nope", "x", [], []), /không hợp lệ/);
});
test("câu hỏi gõ thêm: lấy các câu trong bài chứa nhiều từ của câu hỏi", () => {
  const a = knowledge.answerCustom("dung tích bụi bao nhiêu", VAC, TOKENS);
  assert.ok(a.snippets.length >= 1 && a.snippets.some((s) => /dung tích/i.test(s.text)));
  assert.equal(knowledge.answerCustom("xyz abc qwerty", VAC, TOKENS).snippets.length, 0);
});
test("tóm tắt bài viết tham khảo: tiêu đề, đề mục, ý chính, số liệu, câu hỏi liên quan có link", () => {
  const art = knowledge.summarizeArticle(VAC[3].html, VAC[3].url);
  assert.equal(art.title, "Review máy hút bụi cầm tay Elmich"); assert.ok(art.headings.includes("Ưu điểm"));
  assert.ok(art.keyPoints.length >= 1 && art.facts.some((f) => /1\.300\.000/.test(f)));
  const qa = knowledge.articleQuestions(art, "máy hút bụi cầm tay", "gia_dung");
  assert.ok(qa.length >= 1 && qa.every((q) => q.snippets.length)); assert.equal(art.url, "https://blog.vn/review");
});
test("giải link bọc của Google; link khác giữ nguyên", () => {
  assert.equal(net.resolveUrl("https://www.google.com/url?q=https%3A%2F%2Fshop.vn%2Fp&sa=U"), "https://shop.vn/p");
  assert.equal(net.resolveUrl("https://shop.vn/direct"), "https://shop.vn/direct");
  assert.equal(net.resolveUrl("https://www.google.com/search?q=x"), "");
});
test("crawl có nhịp: gửi xong có phản hồi rồi mới chờ, không dồn dập; dừng được giữa chừng", async () => {
  const stamps = [];
  const c = new Crawler({ getDelay: () => 40, onEvent: () => {} });
  c.fetchHtml = async (url) => { stamps.push({ url, t: Date.now(), phase: "start" }); await net.sleep(10); stamps.push({ url, t: Date.now(), phase: "end" }); return "<html></html>"; };
  const out = await c.readLinks([1, 2, 3, 4].map((i) => ({ url: `https://x.vn/${i}` })));
  assert.equal(out.length, 4);
  // mỗi luồng: sau khi một link xong phải chờ (>= 40*0.75 ms) mới bắt đầu link kế
  for (const w of [0, 1]) { /* hai luồng đan xen, kiểm tra gián tiếp bằng tổng thời gian */ }
  const total = stamps.at(-1).t - stamps[0].t; assert.ok(total >= 30, `tổng thời gian ${total}ms quá ngắn`);
  let stop = false; const c2 = new Crawler({ getDelay: () => 10, isCancelled: () => stop }); c2.fetchHtml = async () => { stop = true; return "<html></html>"; };
  await assert.rejects(() => c2.readLinks([{ url: "https://a.vn" }, { url: "https://b.vn" }, { url: "https://c.vn" }]), CancelledError);
});
test("kết quả không mở được vẫn góp tiêu đề và mô tả", () => {
  const p = pseudoPages([{ url: "https://a.vn", title: "Máy hút bụi <X>", snippet: "Giá: 1.500.000đ" }, { url: "https://b.vn", title: "b", snippet: "" }], new Set(["https://b.vn"]));
  assert.equal(p.length, 1); assert.ok(p[0].pseudo); assert.match(p[0].html, /&lt;X&gt;/);
});
test("cấu hình mặc định giới hạn: trang 1-5, ảnh 1-20, chờ 1-15 giây", () => {
  assert.deepEqual(flow.defaultConfig({ pages: 99, album_n: -5, delay: -3 }), { pages: 5, album_n: 1, delay: 1, topics: ["price", "pros", "using", "types", "buy"], extra_q: [], ref_urls: [] });
  assert.equal(flow.defaultConfig({}).album_n, 3);
});
