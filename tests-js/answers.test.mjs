import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../docs/js/core.js";
import * as flow from "../docs/js/flow.js";
import { AnswerStore, searchKey } from "../docs/js/answers.js";
import { Corpus, asDoc } from "../docs/js/corpus.js";
import { Crawler } from "../docs/js/crawl.js";

const html = (title, body) => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const PRODUCT = "máy hút bụi cầm tay", TOKENS = core.queryKeywords(PRODUCT);
const URL_ = (n) => `https://site${n}.vn/bai-${n}`;
// Mỗi bài đóng góp đáp án cho NHIỀU câu hỏi cùng lúc.
const PAGES = {
  [URL_(1)]: html("Ưu nhược điểm máy hút bụi cầm tay", "<p>Máy hút bụi cầm tay có ưu điểm nhỏ gọn dễ cất giữ, nhược điểm là dung tích hộp bụi nhỏ nên phải đổ bụi thường xuyên.</p><p>Máy hút bụi cầm tay sử dụng công nghệ động cơ không chổi than cho tuổi thọ cao hơn.</p>"),
  [URL_(2)]: html("Mua máy hút bụi cầm tay cần biết gì", "<p>Khi mua máy hút bụi cầm tay cần lưu ý công suất hút, thời lượng pin và bảo hành chính hãng.</p><p>Máy hút bụi cầm tay được phân loại thành loại có dây và loại không dây dùng pin sạc.</p><p>Giá máy hút bụi cầm tay phổ biến khoảng 1.200.000đ đến 2.500.000đ tùy hãng.</p>"),
  [URL_(3)]: html("Tổng hợp máy hút bụi cầm tay", "<p>Máy hút bụi cầm tay có nhược điểm là ồn khi hoạt động, ưu điểm là hút khỏe trên mọi bề mặt.</p><p>Máy hút bụi cầm tay dùng công nghệ lọc HEPA giữ lại bụi mịn, đây là công nghệ phổ biến hiện nay.</p><p>Các loại máy hút bụi cầm tay gồm dòng hút khô và dòng hút ướt, phân loại theo chức năng.</p><p>Lưu ý khi mua máy hút bụi cầm tay là kiểm tra phụ kiện đi kèm và chính sách đổi trả.</p><p>Giá máy hút bụi cầm tay cao cấp khoảng 3.000.000đ, giá phổ thông khoảng 1.300.000đ.</p>"),
  [URL_(4)]: html("Đánh giá chi tiết máy hút bụi cầm tay", "<p>Ưu điểm của máy hút bụi cầm tay là tiện lợi, nhược điểm là pin chỉ dùng được 25 phút mỗi lần sạc đầy.</p><p>Máy hút bụi cầm tay hỗ trợ công nghệ cảm biến bụi tự động điều chỉnh lực hút.</p><p>Kinh nghiệm mua máy hút bụi cầm tay là thử lực hút trực tiếp và chọn hãng có trung tâm bảo hành gần nhà.</p>"),
};
const TOPICS = ["price", "pros", "using", "types", "buy"];
const mkStore = (questions = []) => new AnswerStore({ product: PRODUCT, queryTokens: TOKENS, topicIds: TOPICS, questions });

test("một bài được chấm cho TẤT CẢ câu hỏi: đáp án bổ sung đúng block từng câu", () => {
  const s = mkStore(["dung tích hộp bụi bao nhiêu"]);
  const added = s.ingest({ url: URL_(3), html: PAGES[URL_(3)] });
  assert.ok(added >= 5, `chỉ thêm ${added}`);
  for (const id of ["price", "pros", "using", "types", "buy"]) assert.ok(s.get(id).items.length >= 1, `block ${id} trống`);
  assert.match(s.get("using").items[0].text, /HEPA|công nghệ/); assert.match(s.get("types").items[0].text, /loại|dòng/);
  assert.equal(s.ingest({ url: URL_(3), html: PAGES[URL_(3)] }), 0, "cùng một bài bị chấm hai lần");
});

test("đáp án từ bài cũ không bao giờ bị xóa khi có bài mới", () => {
  const s = mkStore();
  s.ingest({ url: URL_(1), html: PAGES[URL_(1)] });
  const before = s.get("pros").items.map((i) => i.text);
  assert.ok(before.length >= 1);
  s.ingest({ url: URL_(3), html: PAGES[URL_(3)] }); s.ingest({ url: URL_(4), html: PAGES[URL_(4)] });
  const after = s.get("pros").items.map((i) => i.text);
  for (const t of before) assert.ok(after.includes(t), `mất đáp án cũ: ${t}`);
  assert.ok(after.length > before.length); assert.ok(s.pages(s.get("pros")) >= 3);
  const out = s.snippets(s.get("pros")); assert.equal(new Set(out.map((x) => x.url)).size, s.pages(s.get("pros")));
});

test("không trùng đáp án; giới hạn số đáp án mỗi câu; câu hỏi thêm sau chấm lại các bài đã lưu; lưu và nạp lại", () => {
  const s = mkStore();
  Object.entries(PAGES).forEach(([url, h]) => s.ingest({ url, html: h }));
  const texts = s.get("buy").items.map((i) => i.text.slice(0, 60)); assert.equal(new Set(texts).size, texts.length);
  const docs = Object.entries(PAGES).map(([url, h]) => asDoc({ url, html: h }));
  const e = s.addCustom("pin dùng được bao lâu mỗi lần sạc", docs); assert.ok(e.items.some((i) => /25 phút/.test(i.text)));
  const back = AnswerStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON())), { product: PRODUCT, queryTokens: TOKENS, topicIds: TOPICS });
  assert.deepEqual(back.topicsOut(docs), s.topicsOut(docs)); assert.deepEqual(back.customOut(), s.customOut());
  assert.equal(back.ingest({ url: URL_(1), html: PAGES[URL_(1)] }), 0, "bài đã chấm bị chấm lại sau khi nạp");
  assert.ok(s.topicsOut(docs).price.price.min >= 1_000_000); // khoảng giá từ giá từng trang
});

test("từ khóa tìm bài cho từng câu hỏi: câu hỏi + tên sản phẩm", () => {
  const s = mkStore(["pin dùng được bao lâu"]);
  assert.equal(searchKey(s.get("pros"), PRODUCT), `ưu nhược điểm ${PRODUCT}`); assert.equal(searchKey(s.get("buy"), PRODUCT), `lưu ý khi mua ${PRODUCT}`);
  assert.equal(searchKey(s.get("c:pin dùng được bao lâu"), PRODUCT), `pin dùng được bao lâu ${PRODUCT}`);
});

const SERP = {
  [`ưu nhược điểm ${PRODUCT}`]: { 1: [URL_(1), URL_(9), URL_(3)], 2: [URL_(4)] },
  [`giá ${PRODUCT}`]: { 1: [URL_(2), URL_(3)] },
  [`công nghệ ${PRODUCT}`]: { 1: [URL_(3), URL_(4)] },
  [`phân loại ${PRODUCT}`]: { 1: [URL_(2), URL_(3)] },
  [`lưu ý khi mua ${PRODUCT}`]: { 1: [URL_(2), URL_(4)] },
};
function fakeCrawler({ delay = 0, fail = [], serpCalls = [], opened = new Map(), corpus = new Corpus() } = {}) {
  return new Crawler({ getDelay: () => delay, corpus, serp: async (q, p) => { serpCalls.push(`${q}|${p}`); return { results: ((SERP[q] || {})[p] || []).map((url) => ({ url, title: url, snippet: "" })) }; },
    loadHtml: async (url) => { opened.set(url, (opened.get(url) || 0) + 1); if (fail.includes(url) || !PAGES[url]) throw new Error("không mở được"); return PAGES[url]; } });
}
const job = (extra = {}) => ({ id: "t", query: PRODUCT, product_code: "", quantity: 1, cfg: { pages: 2, topics: TOPICS, extra_q: [], ref_urls: [], delay: 0, album_n: 3 }, ...extra });

test("trả lời từng câu hỏi: tìm bài bằng câu hỏi + tên sản phẩm, mỗi bài mở một lần, bài đã mở không mở lại", async () => {
  const opened = new Map(), serpCalls = [], crawler = fakeCrawler({ opened, serpCalls });
  const j = job(); const log = [];
  const store = await flow.answerQuestions(j, crawler, { log: (m) => log.push(m), maxPages: 2 });
  for (const [url, n] of opened) assert.equal(n, 1, `${url} bị mở ${n} lần`);
  assert.ok(serpCalls[0].startsWith(`giá ${PRODUCT}|1`), serpCalls[0]); // câu hỏi đầu tiên: giá + tên sản phẩm
  for (const id of TOPICS) assert.ok(store.get(id).items.length >= 1, `câu ${id} không có đáp án`);
  // bài mở cho câu này bổ sung cho cả các câu khác: tổng số lượt tìm ít hơn số câu hỏi khi các câu đã đủ đáp án
  assert.ok(crawler.searches <= TOPICS.length, `${crawler.searches} lượt tìm`); assert.ok(log.some((m) => /đã đủ/.test(m)) || crawler.searches < TOPICS.length);
  assert.equal(j.research.pros.snippets.length, store.get("pros").items.length); assert.ok(j.answer_store && j.answer_store.entries.length === 5);
  // chạy lại: không mở thêm trang nào, không thêm lượt tìm vì kho đã đủ
  const c2 = fakeCrawler({ opened: new Map(), corpus: crawler.corpus }), s0 = c2.searches;
  await flow.answerQuestions(j, c2, { maxPages: 2 }); assert.equal(c2.fetched, 0); assert.ok(c2.searches <= s0 + TOPICS.length);
});

test("bài không mở được thì bỏ qua ngay (không chờ, không thử lại) và lấy bài khác; trang 2 chỉ tải khi trang 1 hết bài", async () => {
  const opened = new Map(), serpCalls = [], crawler = fakeCrawler({ delay: 60, fail: [URL_(1)], opened, serpCalls });
  const store = new AnswerStore({ product: PRODUCT, queryTokens: TOKENS, topicIds: ["pros"] });
  const t0 = Date.now(); const r = await flow.findAnswers(store, store.get("pros"), crawler, { product: PRODUCT, maxPages: 2 });
  assert.equal(r.skipped, 2); assert.ok(r.opened >= 1); // URL_(1) lỗi và URL_(9) không tồn tại assert.equal(opened.get(URL_(1)), 1); assert.ok(crawler.failed.has(URL_(1)));
  assert.ok(store.get("pros").items.length >= 1, "không lấy được đáp án từ bài khác");
  // trang 1 có 3 link (1 lỗi, 1 không tồn tại, 1 tốt): sau bài tốt vẫn thiếu thì mới tải trang 2
  assert.ok(serpCalls.includes(`ưu nhược điểm ${PRODUCT}|1`)); assert.ok(Date.now() - t0 < 2000);
  // bài lỗi không làm tăng thời gian chờ: chỉ bài mở thành công mới chờ
  const t1 = Date.now(), c2 = fakeCrawler({ delay: 120, fail: [URL_(1), URL_(3), URL_(4)], opened: new Map() });
  const s2 = new AnswerStore({ product: PRODUCT, queryTokens: TOKENS, topicIds: ["pros"] });
  await flow.findAnswers(s2, s2.get("pros"), c2, { product: PRODUCT, maxPages: 2 });
  assert.ok(Date.now() - t1 < 600, `chờ ${Date.now() - t1}ms dù mọi bài đều lỗi`); assert.equal(c2.fetched, 0);
  // trang 1 đủ đáp án thì không tải trang 2: chủ đề "công nghệ" có 3 bài tốt ngay ở trang 1
  SERP[`công nghệ ${PRODUCT}`] = { 1: [URL_(3), URL_(4), URL_(1)], 2: [URL_(2)] };
  const serp3 = [], c3 = fakeCrawler({ serpCalls: serp3 }), s3 = new AnswerStore({ product: PRODUCT, queryTokens: TOKENS, topicIds: ["using"] });
  await flow.findAnswers(s3, s3.get("using"), c3, { product: PRODUCT, maxPages: 2 });
  assert.ok(s3.enough(s3.get("using"))); assert.deepEqual(serp3, [`công nghệ ${PRODUCT}|1`], "đã đủ mà vẫn tải trang 2"); assert.equal(c3.fetched, 3);
});

test("hỏi thêm: chấm lại kho trước, chỉ tìm bài mới khi chưa đủ; bổ sung cả các block khác, đáp án cũ giữ nguyên", async () => {
  const corpus = new Corpus(); [URL_(1), URL_(2), URL_(3)].forEach((u) => corpus.addPage({ url: u, html: PAGES[u] }));
  const j = job(); const c0 = fakeCrawler({ corpus });
  await flow.answerQuestions(j, c0, { maxPages: 1 });
  const prosBefore = j.research.pros.snippets.map((s) => s.text);
  // câu hỏi đã có đáp án trong kho: không tìm, không mở trang
  const c1 = fakeCrawler({ corpus, serpCalls: [] });
  const r1 = await flow.askMore(j, "ưu điểm nhược điểm", c1, { allowSearch: true });
  assert.equal(r1.searched, false); assert.ok(r1.snippets.length >= 1); assert.equal(c1.fetched, 0);
  // câu hỏi chưa có đáp án: tìm bằng "câu hỏi + tên sản phẩm"
  SERP[`pin dùng được bao lâu mỗi lần sạc ${PRODUCT}`] = { 1: [URL_(4)] };
  const serpCalls = [], c2 = fakeCrawler({ corpus, serpCalls });
  const r2 = await flow.askMore(j, "pin dùng được bao lâu mỗi lần sạc", c2, { allowSearch: true });
  assert.equal(r2.searched, true); assert.ok(serpCalls[0].startsWith(`pin dùng được bao lâu mỗi lần sạc ${PRODUCT}`)); assert.ok(r2.snippets.some((s) => /25 phút/.test(s.text)));
  assert.ok(corpus.has(URL_(4)));
  for (const t of prosBefore) assert.ok(j.research.pros.snippets.some((s) => s.text === t), "mất đáp án cũ của block ưu nhược điểm"); // đáp án cũ giữ nguyên
  assert.ok(j.research.pros.snippets.some((s) => s.url === URL_(4)), "bài mới không bổ sung vào block ưu nhược điểm");
  assert.equal(j.custom_answers.length, 2);
});

test("thứ tự chạy: lấy ảnh trước, rồi mới tìm NCC và trả lời câu hỏi", async () => {
  const order = [], crawler = fakeCrawler(), ctx = { crawler, log: () => {}, step: (id, state) => { if (state === "start" || state === "skip") order.push(id); } };
  const j = job({ product_code: "VCE-9304", quantity: 2 }); j.cfg.ref_urls = [];
  const rec = await flow.run(j, ctx).then(() => order);
  const first = (id) => rec.indexOf(id);
  assert.equal(rec[0], "album"); assert.ok(first("album") < first("suppliers") && first("suppliers") < first("topics"), rec.join(">"));
  assert.equal(j.status, "done");
});
