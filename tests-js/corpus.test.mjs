import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../docs/js/core.js";
import * as knowledge from "../docs/js/knowledge.js";
import * as net from "../docs/js/net.js";
import * as flow from "../docs/js/flow.js";
import { Corpus, asDoc, makeDoc, packDoc, unpackDoc } from "../docs/js/corpus.js";
import { CancelledError, Crawler, pseudoDocs } from "../docs/js/crawl.js";

const html = (title, body, head = "") => `<html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;
const PRODUCT = "máy hút bụi cầm tay", TOKENS = core.queryKeywords(PRODUCT);
// Một bộ bài mẫu, mỗi bài trả lời một vài chủ đề: giá, ưu nhược điểm, công nghệ, phân loại, lưu ý khi mua.
const PAGES = {
  "https://a.vn/danh-gia": html("Đánh giá máy hút bụi cầm tay", "<h1>Đánh giá máy hút bụi cầm tay</h1><h2>Ưu điểm</h2><p>Máy hút bụi cầm tay có ưu điểm nhỏ gọn, nhược điểm là dung tích hộp bụi nhỏ nên cần đổ bụi thường xuyên.</p><p>Khi mua máy hút bụi cầm tay cần lưu ý công suất hút và thời lượng pin để chọn đúng nhu cầu.</p>"),
  "https://b.vn/cong-nghe": html("Công nghệ máy hút bụi cầm tay", "<p>Máy hút bụi cầm tay sử dụng công nghệ động cơ không chổi than, ưu điểm là bền và hút khỏe hơn công nghệ động cơ chổi than cũ.</p><p>Máy hút bụi cầm tay được phân loại thành loại có dây và loại không dây dùng pin sạc.</p>"),
  "https://c.vn/gia": html("Giá máy hút bụi cầm tay", "<p>Giá máy hút bụi cầm tay phổ biến khoảng 1.200.000đ đến 2.500.000đ tùy hãng và công suất.</p><p>Máy hút bụi cầm tay bán chạy nhất có giá khoảng 1.500.000đ.</p>"),
  "https://e.vn/tong-hop": html("Tổng hợp máy hút bụi cầm tay", "<p>Máy hút bụi cầm tay sử dụng công nghệ cảm biến thông minh, ưu điểm là tự điều chỉnh lực hút theo bề mặt.</p><p>Máy hút bụi cầm tay được phân loại theo nguồn điện gồm loại cắm điện và loại pin sạc, nhiều dòng mới.</p><p>Giá máy hút bụi cầm tay cao cấp khoảng 3.000.000đ, giá phổ thông khoảng 1.300.000đ.</p><p>Máy hút bụi cầm tay có nhược điểm là ồn khi hút, ưu điểm là dễ cất giữ.</p><p>Lưu ý khi mua máy hút bụi cầm tay là kiểm tra bảo hành và phụ kiện đi kèm, nên chọn hãng uy tín.</p>"),
  "https://d.vn/sp": html("Máy hút bụi cầm tay X1 | Shop D", "<p>Máy hút bụi cầm tay X1 600W. Giá: 1.490.000đ. Thêm vào giỏ.</p>", '<meta property="og:type" content="product">'),
};
const loadFrom = (counter) => async (url) => { counter.set(url, (counter.get(url) || 0) + 1); if (!PAGES[url]) throw new Error("404"); return PAGES[url]; };
const serpOf = (map) => async (query, page) => ({ results: ((map[query] || {})[page] || []).map((url) => ({ url, title: url, snippet: "" })) });

test("mỗi trang xử lý một lần thành tài liệu, không giữ HTML; kết quả tìm kiếm không ghi đè trang đã đọc thật", () => {
  const raw = { url: "https://a.vn/danh-gia", html: PAGES["https://a.vn/danh-gia"] };
  const d = asDoc(raw); assert.equal(asDoc(raw), d); assert.equal(asDoc(d), d); // xử lý một lần, nhớ kết quả
  assert.ok(d.sentences.length >= 2 && d.sentences[0].n === core.stripAccents(d.sentences[0].t)); assert.ok(!("html" in d)); assert.ok(d.summary.headings.includes("Ưu điểm"));
  const c = new Corpus(); c.add(d); c.add(makeDoc({ url: d.url, pseudo: true, html: html("t", "<p>chỉ mô tả</p>") }));
  assert.equal(c.get(d.url).pseudo, false); assert.equal(c.size, 1);
  const p = pseudoDocs([{ url: "https://x.vn", title: "A <b>", snippet: "Giá: 1.500.000đ" }, { url: "https://y.vn", title: "y", snippet: "" }], new Set(["https://y.vn"]));
  assert.equal(p.length, 1); assert.ok(p[0].pseudo);
});

test("mỗi URL chỉ mở một lần dù được nhiều lượt tìm và nhiều câu hỏi nhắc tới; trang đã có trong kho không phải chờ", async () => {
  const opened = new Map(), t0 = { w: 0 };
  const c = new Crawler({ getDelay: () => 40, loadHtml: loadFrom(opened), serp: serpOf({ q1: { 1: ["https://a.vn/danh-gia", "https://b.vn/cong-nghe"] }, q2: { 1: ["https://b.vn/cong-nghe", "https://c.vn/gia", "https://a.vn/danh-gia"] } }) });
  await c.google("q1", 1); const started = Date.now(); await c.google("q2", 1); void t0;
  for (const url of ["https://a.vn/danh-gia", "https://b.vn/cong-nghe", "https://c.vn/gia"]) assert.equal(opened.get(url), 1, `${url} bị mở ${opened.get(url)} lần`);
  assert.equal(c.fetched, 3); assert.equal(c.reused, 2); assert.equal(c.searches, 2); assert.deepEqual(c.queries, ["q1", "q2"]);
  const before = c.fetched; await c.readLinks([{ url: "https://a.vn/danh-gia" }, { url: "https://b.vn/cong-nghe" }]); assert.equal(c.fetched, before);
  const reread = Date.now(); await c.readLinks([{ url: "https://a.vn/danh-gia" }, { url: "https://c.vn/gia" }]); assert.ok(Date.now() - reread < 30, "trang đã có trong kho vẫn bị chờ"); void started;
  assert.equal((await c.visit("https://none.vn/x")), null); assert.equal(await c.visit("https://none.vn/x"), null); assert.equal(opened.get("https://none.vn/x"), 1); // trang lỗi không thử lại
});

test("google: nhiều trang kết quả, mở hết link từng trang, có nhịp chờ, dừng khi hết kết quả hoặc khi bị yêu cầu dừng", async () => {
  const events = [], opened = new Map();
  const serp = serpOf({ q: { 1: ["https://a.vn/danh-gia", "https://b.vn/cong-nghe"], 2: ["https://c.vn/gia", "https://d.vn/sp"], 3: [] } });
  const c = new Crawler({ getDelay: () => 30, onEvent: (e) => events.push(e), loadHtml: loadFrom(opened), serp });
  const t = Date.now(); const r = await c.google("q", 5);
  assert.equal(r.pagesDone, 2); assert.equal(r.items.length, 4); assert.equal(r.read.length, 4); assert.ok(events.some((e) => e.state === "end" && e.page === 3));
  assert.ok(Date.now() - t >= 60, "không có nhịp chờ giữa các lệnh");
  let stop = false; const c2 = new Crawler({ getDelay: () => 10, isCancelled: () => stop, loadHtml: async () => { stop = true; return PAGES["https://a.vn/danh-gia"]; }, serp });
  await assert.rejects(() => c2.google("q", 3), CancelledError);
});

test("một lượt quét trả lời đúng như từng câu hỏi riêng lẻ (chủ đề và câu hỏi gõ thêm)", () => {
  const docs = Object.entries(PAGES).map(([url, h]) => asDoc({ url, html: h }));
  const ids = ["price", "pros", "using", "types", "buy"], custom = ["dung tích hộp bụi bao nhiêu", "xyz qwerty abc"];
  const all = knowledge.answerAll({ product: PRODUCT, banks: knowledge.topicBanks(ids), custom }, docs, TOKENS);
  for (const id of ids) assert.deepEqual(all.topics[id].snippets, knowledge.answerTopic(id, PRODUCT, docs, TOKENS).snippets, id);
  assert.deepEqual(all.custom[0].snippets, knowledge.answerCustom(custom[0], docs, TOKENS).snippets);
  assert.ok(all.topics.pros.snippets.some((s) => /nhược điểm/.test(s.text)) && all.topics.types.snippets.some((s) => /phân loại/.test(s.text)) && all.custom[0].snippets.length >= 1 && all.custom[1].snippets.length === 0);
  assert.equal(all.topics.price.price.count >= 1, true); // khoảng giá từ giá từng trang, không phải mọi con số
  assert.ok(all.topics.price.price.min >= 1_000_000);
});

test("khối lượng lớn vẫn nhanh: 150 bài x 300 câu, 5 chủ đề + 5 câu hỏi trong một lượt", () => {
  const body = Array.from({ length: 300 }, (_, i) => `Máy hút bụi cầm tay mẫu ${i} có công suất ${300 + i}W và ưu điểm số ${i}, lưu ý khi mua loại số ${i} cần xem pin.`).join(" ");
  const docs = Array.from({ length: 150 }, (_, i) => asDoc({ url: `https://s${i}.vn/p`, html: html(`Máy hút bụi cầm tay ${i}`, `<p>${body}</p>`) }));
  const t = Date.now();
  const all = knowledge.answerAll({ product: PRODUCT, banks: knowledge.topicBanks(["price", "pros", "using", "types", "buy"]), custom: ["công suất bao nhiêu", "pin dùng bao lâu", "ưu điểm", "loại", "mua"] }, docs, TOKENS);
  assert.ok(Date.now() - t < 4000, `quá chậm: ${Date.now() - t}ms`); assert.equal(Object.keys(all.topics).length, 5); assert.equal(all.custom.length, 5);
});

test("kho lưu bền vững (nén gọn rồi nạp lại) cho cùng câu trả lời", () => {
  const docs = Object.entries(PAGES).map(([url, h]) => asDoc({ url, html: h }));
  const back = docs.map((d) => unpackDoc(JSON.parse(JSON.stringify(packDoc(d)))));
  assert.ok(back.every((d) => d.site instanceof Set && d.sentences.every((s) => s.n === core.stripAccents(s.t))));
  const a = knowledge.answerAll({ product: PRODUCT, banks: knowledge.topicBanks(["pros", "using", "types", "buy", "price"]), custom: ["dung tích hộp bụi"] }, docs, TOKENS);
  const b = knowledge.answerAll({ product: PRODUCT, banks: knowledge.topicBanks(["pros", "using", "types", "buy", "price"]), custom: ["dung tích hộp bụi"] }, back, TOKENS);
  assert.deepEqual(b.topics, a.topics); assert.deepEqual(b.custom, a.custom);
  const d = core.buildDiscovery(back, TOKENS, PRODUCT); assert.ok(d.total >= 3 && d.price);
});

test("bảng NCC lấy từ kho, không cần HTML thô", () => {
  const docs = Object.entries(PAGES).map(([url, h]) => asDoc({ url, html: h }));
  const b = flow.buildSuppliers({ query: PRODUCT, product_code: "", quantity: 2 }, docs);
  assert.ok(b.suppliers.some((s) => s.url === "https://d.vn/sp" && s.quantity === 2 && s.name === "Shop D")); assert.ok(b.others.some((o) => o.url === "https://a.vn/danh-gia"));
  assert.equal(typeof net.sleep, "function");
});
