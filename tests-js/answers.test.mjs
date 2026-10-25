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
  // trang 1 đủ đáp án thì không tải trang 2: chủ đề "công nghệ" có bài tốt ngay ở trang 1; đủ khi đã có đáp án từ 2 bài thì dừng
  SERP[`công nghệ ${PRODUCT}`] = { 1: [URL_(3), URL_(4), URL_(1)], 2: [URL_(2)] };
  const serp3 = [], c3 = fakeCrawler({ serpCalls: serp3 }), s3 = new AnswerStore({ product: PRODUCT, queryTokens: TOKENS, topicIds: ["using"] });
  await flow.findAnswers(s3, s3.get("using"), c3, { product: PRODUCT, maxPages: 2 });
  assert.ok(s3.enough(s3.get("using"))); assert.deepEqual(serp3, [`công nghệ ${PRODUCT}|1`], "đã đủ mà vẫn tải trang 2"); assert.equal(c3.fetched, 2);
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

/* ---------------- đúng sản phẩm/model, chữ Việt, menu ---------------- */
const AIRFRYER = "nồi chiên không dầu Sunhouse";
const FTOKENS = core.queryKeywords(AIRFRYER);
const menu = "Máy tính Trung tâm bảo hành uỷ quyền Apple Kênh thông tin giải trí công nghệ cho giới trẻ Trang thông tin công nghệ mới nhất iPhone 18 Pro";
const FPAGES = {
  // bài đúng model SHD4080, chữ Việt mã hóa bằng ký tự HTML như ngoài thực tế
  "https://a.vn/shd4080": html("N&#7891;i chi&ecirc;n kh&ocirc;ng d&#7847;u Sunhouse SHD4080 | Điện Máy A", `<header><p>${menu}</p></header><nav><a>Trang chủ</a></nav><p>N&#7891;i chi&ecirc;n kh&ocirc;ng d&#7847;u Sunhouse SHD4080 c&oacute; &#432;u &#273;i&#7875;m l&agrave; chi&ecirc;n n&#432;&#7899;ng &iacute;t d&#7847;u m&#7905;, nh&#432;&#7907;c &#273;i&#7875;m l&agrave; c&#7891;ng k&#7873;nh khi &#273;&#7863;t tr&ecirc;n b&agrave;n nh&#7887;.</p><p>N&#7891;i chi&ecirc;n kh&ocirc;ng d&#7847;u Sunhouse SHD4080 &#273;&#432;&#7907;c &#7913;ng d&#7909;ng c&ocirc;ng ngh&#7879; Rapid Air gi&uacute;p l&agrave;m ch&iacute;n th&#7921;c ph&#7849;m nhanh v&agrave; &#273;&#7873;u.</p><footer>${menu}</footer>`),
  // bài về model KHÁC: câu nhắc SHD4026 phải bị loại
  "https://b.vn/shd4026": html("Nồi chiên không dầu Sunhouse SHD4026 6L", "<p>Nồi chiên không dầu Sunhouse SHD4026 6L có ưu điểm là mặt trước thân nồi được cấu tạo từ chất liệu inox sáng bền, nhược điểm là giá cao hơn.</p><p>Nồi chiên không dầu Sunhouse SHD4026 sử dụng công nghệ nướng đối lưu hiện đại.</p>"),
  // bài chỉ nói về loại sản phẩm nói chung (không nhắc model): chỉ là tham khảo chung
  "https://c.vn/chung": html("Nồi chiên không dầu là gì", "<p>Nồi chiên không dầu Sunhouse và các hãng khác có ưu điểm là ít dầu mỡ, nhược điểm là dung tích nhỏ nên khó nấu cho đông người.</p><p>Nồi chiên không dầu thường sử dụng công nghệ đối lưu không khí nóng để làm chín thức ăn.</p>"),
};

test("ký tự HTML tiếng Việt được giải mã; menu và chân trang không thành đáp án", () => {
  const d = asDoc({ url: "https://a.vn/shd4080", html: FPAGES["https://a.vn/shd4080"] });
  assert.equal(d.title, "Nồi chiên không dầu Sunhouse SHD4080 | Điện Máy A"); assert.ok(!/&[a-z]+;|&#\d+;/i.test(d.text), d.text.slice(0, 120));
  assert.ok(d.sentences.length >= 2 && d.sentences.every((s) => !core.isBoilerplate(s.t) && !/Apple Kênh/.test(s.t) && !/&[a-z]+;/.test(s.t)), d.sentences.map((s) => s.t).join(" | "));
  assert.ok(d.sentences.some((x) => /Nồi chiên không dầu Sunhouse SHD4080 có ưu điểm/.test(x.t)));
  assert.equal(core.decodeEntities("chi&ecirc;n &amp;ecirc; &#x1EC7; &agrave; &Dstrok; &unknown;"), "chiên ê ệ à Đ &unknown;");
  assert.ok(core.isBoilerplate(menu)); assert.ok(!core.isBoilerplate("Nồi chiên không dầu Sunhouse được ứng dụng công nghệ Rapid Air tiên tiến, giúp làm chín thực phẩm nhanh."));
});

test("đúng model: câu nhắc model khác bị loại, bài không nhắc model chỉ là tham khảo chung và không tính là đủ đáp án", () => {
  const s = new AnswerStore({ product: `${AIRFRYER} SHD4080`, code: "SHD4080", queryTokens: FTOKENS, topicIds: ["pros", "using"] });
  const docs = Object.entries(FPAGES).map(([url, h]) => asDoc({ url, html: h })); s.prime(docs); docs.forEach((d) => s.ingest(d));
  const pros = s.get("pros"), main = s.snippets(pros), general = s.generalSnippets(pros);
  assert.ok(main.length >= 1 && main.every((x) => x.url === "https://a.vn/shd4080"), JSON.stringify(main));
  assert.ok(!pros.items.some((i) => /SHD4026/.test(i.text)), "đáp án nói về model SHD4026");
  assert.ok(general.length >= 1 && general.every((x) => x.url === "https://c.vn/chung")); assert.ok(!general.some((x) => /SHD4026/.test(x.text)));
  const using = s.get("using"); assert.ok(s.snippets(using).some((x) => /Rapid Air/.test(x.text))); assert.ok(!using.items.some((i) => /SHD4026/.test(i.text)));
  assert.equal(s.enough(pros), false, "đáp án chung không được tính là đủ");
  const out = s.topicsOut(docs); assert.ok(out.pros.snippets.length >= 1 && out.pros.general.length >= 1);
  // không có model thì không phân biệt: bài về model khác vẫn dùng được
  const any = new AnswerStore({ product: AIRFRYER, code: "", queryTokens: FTOKENS, topicIds: ["pros"] }); docs.forEach((d) => any.ingest(d));
  assert.ok(any.snippets(any.get("pros")).some((x) => x.url === "https://b.vn/shd4026") && any.general(any.get("pros")).length === 0);
});

test("chữ lặp ở nhiều bài (chân trang) không thành đáp án; lưu và nạp lại giữ nguyên tầng đáp án", () => {
  const boiler = "Nồi chiên không dầu Sunhouse có ưu điểm bảo hành 12 tháng và giao hàng toàn quốc miễn phí cho mọi đơn hàng.";
  const docs = [1, 2, 3, 4].map((i) => asDoc({ url: `https://s${i}.vn/p`, html: html(`Nồi chiên không dầu Sunhouse SHD4080 mẫu ${i}`, `<p>Nồi chiên không dầu Sunhouse SHD4080 mẫu ${i} có ưu điểm riêng số ${i} là chiên nhanh và tiết kiệm điện năng.</p><p>${boiler}</p>`) }));
  const s = new AnswerStore({ product: AIRFRYER, code: "SHD4080", queryTokens: FTOKENS, topicIds: ["pros"] });
  s.prime(docs); docs.forEach((d) => s.ingest(d));
  assert.ok(!s.get("pros").items.some((i) => i.text === boiler), "chữ lặp ở 4 bài vẫn thành đáp án");
  assert.ok(s.get("pros").items.length >= 3);
  const back = AnswerStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON())), { product: AIRFRYER, code: "SHD4080", queryTokens: FTOKENS, topicIds: ["pros"] });
  assert.deepEqual(back.topicsOut(docs), s.topicsOut(docs)); assert.ok(back.get("pros").items.every((i) => i.tier === "model"));
});

test("đủ đáp án khi đã được trả lời từ 2 bài khác nhau đúng sản phẩm; 1 bài thì chưa đủ", () => {
  const store = new AnswerStore({ product: PRODUCT, queryTokens: TOKENS, topicIds: ["pros"] }), e = store.get("pros");
  store.ingest({ url: URL_(1), html: PAGES[URL_(1)] });
  const one = store.pages(e); assert.equal(store.enough(e), one >= 2);
  store.ingest({ url: URL_(3), html: PAGES[URL_(3)] });
  assert.equal(store.enough(e), store.pages(e) >= 2);
  assert.ok(store.summary(e).length <= 3 && new Set(store.summary(e).map((s) => s.url)).size === store.summary(e).length, "tóm tắt mỗi bài một ý");
});
