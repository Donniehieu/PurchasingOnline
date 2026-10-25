// Tìm hiểu sản phẩm theo nhóm ngành hàng và tư vấn mua hàng. Không dùng AI: bộ câu hỏi cố định theo ngành,
// câu trả lời là các câu trích nguyên văn từ các trang đã crawl (kèm nguồn), nên cần người mua đọc và đánh giá lại.
import { CATEGORIES, brandsIn, findPrices, normKey, phraseRelevance, priceSummary, stripAccents } from "./core.js";
import { MIN_LEN, asDoc } from "./corpus.js";

export const GROUPS = {
  gia: "Giá cả",
  hang: "Hãng sản xuất",
  san_pham: "Ưu nhược điểm của sản phẩm",
  mua: "Lưu ý khi mua",
  cong_nghe: "Công nghệ, phân loại",
  nganh: "Câu hỏi riêng của ngành hàng",
  khac: "Thay thế và rủi ro",
};

const Q = (id, group, label, ask, patterns, min, extra = {}) => ({ id, group, label, ask, patterns, min: min ?? patterns.length, ...extra });

// Câu hỏi dùng cho mọi ngành hàng.
const COMMON = [
  Q("price", "gia", "Giá cả", (p) => `${p} giá bao nhiêu, khoảng giá phổ biến là bao nhiêu?`, [/giá/i, /\d[\d.,]*\s*(?:đ|₫|vnđ|vnd|triệu|nghìn|k)(?![\p{L}\d])/iu], 2, { kind: "price" }), // không dùng \b vì JavaScript không coi "đ" là chữ
  Q("brands", "hang", "Các hãng sản xuất", (p) => `${p} có những hãng, thương hiệu nào?`, [/hãng|thương hiệu|nhãn hiệu|nhà sản xuất|brand/i], 1, { kind: "brands" }),
  Q("brand_pros", "hang", "Ưu nhược điểm của từng hãng", (p) => `Ưu điểm, nhược điểm của từng hãng ${p} là gì?`, [/ưu điểm|nhược điểm|điểm mạnh|điểm yếu|uy tín|chất lượng|hậu mãi|đánh giá/i], 1, { needsBrand: true }),
  Q("pros", "san_pham", "Ưu nhược điểm của sản phẩm", (p) => `${p} có ưu điểm, nhược điểm gì?`, [/ưu điểm|nhược điểm|hạn chế|điểm mạnh|điểm yếu|tiện lợi|bất tiện|khuyết điểm/i], 1),
  Q("buy", "mua", "Lưu ý khi mua", (p) => `Cần lưu ý gì khi mua ${p}?`, [/lưu ý|chú ý|cần biết|nên chọn|nên mua|khi mua|kinh nghiệm|cách chọn|tránh|đừng|cẩn thận/i], 1),
  Q("using", "cong_nghe", "Sản phẩm thường dùng công nghệ gì", (p) => `${p} thường sử dụng công nghệ gì?`, [/công nghệ|nguyên lý|cấu tạo|cảm biến|động cơ|vi xử lý|inverter|hoạt động dựa/i], 1),
  Q("types", "cong_nghe", "Phân loại sản phẩm", (p) => `${p} được phân loại như thế nào?`, [/phân loại|các loại|có \d+ loại|gồm có|dòng|kiểu/i, /loại|dòng|kiểu/i], 2),
  Q("tech", "cong_nghe", "Ưu nhược điểm của từng công nghệ", (p) => `Ưu nhược điểm của các công nghệ dùng trong ${p}?`, [/công nghệ|động cơ|cảm biến|chất liệu|nguyên lý/i, /ưu điểm|nhược điểm|hạn chế|vượt trội|so với|tiết kiệm/i], 2),
  Q("alternatives", "khac", "Sản phẩm thay thế, so sánh", (p) => `Có sản phẩm nào thay thế ${p} không, so sánh ra sao?`, [/thay thế|so sánh|tương tự|khác nhau|nên chọn|hay là/i], 1),
  Q("risks", "khac", "Rủi ro thường gặp", (p) => `Rủi ro, lỗi thường gặp khi dùng ${p}?`, [/rủi ro|lỗi thường gặp|hư hỏng|khuyết điểm|vấn đề|sự cố|lừa đảo|hàng giả/i], 1),
];

// Câu hỏi riêng cho từng nhóm ngành hàng.
const BY_CATEGORY = {
  gia_dung: [
    Q("power", "nganh", "Công suất, mức tiêu thụ điện", (p) => `${p} công suất bao nhiêu, tốn điện không?`, [/công suất|tiêu thụ|tiết kiệm điện|kwh|điện năng|\d+\s*W\b/i], 1),
    Q("safety", "nganh", "An toàn khi sử dụng", (p) => `Dùng ${p} cần lưu ý an toàn gì?`, [/an toàn|cháy nổ|chập|rò điện|chống|bảo vệ|quá nhiệt/i], 1),
    Q("care", "nganh", "Bảo hành, bảo trì, vệ sinh", (p) => `${p} bảo hành, bảo trì, vệ sinh thế nào?`, [/bảo hành|bảo trì|vệ sinh|linh kiện|sửa chữa|bảo dưỡng/i], 1),
  ],
  may_moc: [
    Q("specs", "nganh", "Thông số kỹ thuật cần chú ý", (p) => `Khi chọn ${p} cần chú ý thông số kỹ thuật nào?`, [/công suất|tải trọng|điện áp|tốc độ|áp suất|lưu lượng|kích thước|thông số/i, /cần|chú ý|quan trọng|lựa chọn|chọn/i], 2),
    Q("standards", "nganh", "Tiêu chuẩn, chứng nhận an toàn", (p) => `${p} cần đạt tiêu chuẩn, chứng nhận nào?`, [/tiêu chuẩn|chứng nhận|\biso\b|tcvn|\bce\b|an toàn lao động|kiểm định|co\/cq/i], 1),
    Q("parts", "nganh", "Bảo trì, phụ tùng thay thế", (p) => `${p} bảo trì, thay phụ tùng thế nào?`, [/bảo trì|bảo dưỡng|phụ tùng|linh kiện|thay thế|sửa chữa|bảo hành/i], 1),
    Q("opcost", "nganh", "Chi phí vận hành", (p) => `Chi phí vận hành ${p} khoảng bao nhiêu?`, [/chi phí|tiêu hao|điện năng|tiết kiệm|vận hành|nhiên liệu/i, /\d/], 2),
  ],
  tieu_dung: [
    Q("material", "nganh", "Chất liệu, kích cỡ", (p) => `${p} chất liệu gì, chọn kích cỡ ra sao?`, [/chất liệu|kích cỡ|\bsize\b|kích thước|vải|cách chọn/i], 1),
    Q("fake", "nganh", "Nhận biết hàng chính hãng", (p) => `Làm sao nhận biết ${p} chính hãng, tránh hàng giả?`, [/chính hãng|hàng giả|hàng nhái|nhận biết|phân biệt|tem chống giả|uy tín/i], 1),
    Q("returns", "nganh", "Đổi trả, bảo hành", (p) => `Chính sách đổi trả, bảo hành ${p} thế nào?`, [/đổi trả|hoàn tiền|hoàn trả|bảo hành|chính sách/i], 1),
    Q("audience", "nganh", "Phù hợp với ai", (p) => `${p} phù hợp với đối tượng nào?`, [/phù hợp|dành cho|đối tượng|nên dùng|thích hợp/i], 1),
  ],
  chung: [],
};

const QUERY_HINT = { gia_dung: "công suất tiêu thụ điện bảo hành", may_moc: "thông số kỹ thuật tiêu chuẩn bảo trì", tieu_dung: "chất liệu hàng chính hãng đổi trả", chung: "kinh nghiệm chọn mua" };

/** Kế hoạch tìm hiểu: danh sách câu hỏi của ngành hàng và các lượt tìm bổ sung (ngoài lượt tìm sản phẩm). */
export function planKnowledge(product, category) {
  const cat = BY_CATEGORY[category] ? category : "chung";
  const bank = [...COMMON, ...BY_CATEGORY[cat]];
  return {
    category: cat, categoryLabel: CATEGORIES[cat].label,
    questions: bank.map((q) => ({ id: q.id, group: q.group, label: q.label, ask: q.ask(product) })),
    queries: [
      { id: "market", query: `${product} giá bao nhiêu hãng nào tốt` },
      { id: "tech", query: `${product} ưu nhược điểm các loại công nghệ` },
      { id: "buy", query: `${product} lưu ý khi mua ${QUERY_HINT[cat]}` },
    ],
    _bank: bank,
  };
}

/* ------------------------------------------------------------------ chủ đề tìm hiểu do người dùng chọn */
/** Năm chủ đề người dùng có thể bật/tắt. suffix là cụm từ thêm vào truy vấn Google để ra các bài viết đúng chủ đề. */
export const TOPIC_DEFS = [
  { id: "price", label: "Giá trung bình", key: "giá", suffix: "giá bao nhiêu giá bán" },
  { id: "pros", label: "Ưu nhược điểm", key: "ưu nhược điểm", suffix: "ưu nhược điểm đánh giá" },
  { id: "using", label: "Công nghệ sử dụng", key: "công nghệ", suffix: "công nghệ sử dụng nguyên lý" },
  { id: "types", label: "Phân loại", key: "phân loại", suffix: "phân loại các loại" },
  { id: "buy", label: "Lưu ý khi mua", key: "lưu ý khi mua", suffix: "lưu ý khi mua kinh nghiệm chọn mua" },
];
const ALL_QUESTIONS = [...COMMON, ...Object.values(BY_CATEGORY).flat()];

/* ------------------------------------------------------------------ trả lời nhiều câu hỏi trong MỘT lượt quét kho dữ liệu */
const relevant = (pages, tokens) => pages.map(asDoc).filter(Boolean).map((d) => ({ d, rel: phraseRelevance(tokens, d.norm) })).filter((x) => x.rel >= 0.5);

/** Chọn câu trả lời tốt nhất: điểm cao, độ dài vừa phải, không trùng, mỗi bài tối đa `perPage` câu. */
export function pickSnippets(cands, max = 4, perPage = 2) {
  cands.sort((a, b) => b.score - a.score || Math.abs(a.text.length - 140) - Math.abs(b.text.length - 140));
  const out = [], per = new Map(), seen = new Set();
  for (const c of cands) {
    const key = normKey(c.text).slice(0, 60);
    if (seen.has(key) || (per.get(c.url) || 0) >= perPage) continue;
    seen.add(key); per.set(c.url, (per.get(c.url) || 0) + 1); out.push({ text: c.text, url: c.url, score: c.score });
    if (out.length >= max) break;
  }
  return out;
}
const QSTOP = new Set(["va", "la", "cua", "cho", "co", "khong", "nhu", "the", "nao", "gi", "duoc", "nay", "mot", "cac", "nhung", "bao", "nhieu", "khi", "hay", "voi", "trong", "thi", "da", "se", "ra", "vao", "can", "nen", "hon"]);
export const questionTokens = (q) => [...new Set(stripAccents(q).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !QSTOP.has(t)))];

/** Spec cho các câu hỏi chủ đề và câu hỏi gõ thêm; mỗi spec gom các câu ứng viên (cands) tìm được. */
export const makeTopicSpecs = (banks) => banks.map((q) => ({ q, cands: [] }));
/** productTokens: các từ của tên sản phẩm, không dùng để so khớp câu hỏi (câu nào cũng nhắc sản phẩm nên sẽ khớp nhầm). */
export const makeCustomSpecs = (questions, productTokens = []) => questions.map((question) => {
  const all = questionTokens(question), drop = new Set(productTokens), own = all.filter((t) => !drop.has(t)), qTokens = own.length ? own : all;
  return { question, qTokens, need: Math.max(1, Math.ceil(qTokens.length * 0.5)), cands: [] };
});

/** Chấm MỘT tài liệu cho TẤT CẢ câu hỏi: mỗi câu của tài liệu được duyệt đúng một lần và đẩy ứng viên vào từng spec. */
export function scoreDoc(d, rel, tspecs, cspecs, queryTokens, brandKeys = []) {
  for (const s of d.sentences) {
    if (rel >= 0.8 || queryTokens.some((t) => s.n.includes(t))) { // trang chỉ liên quan một phần thì câu phải nhắc sản phẩm
      for (const sp of tspecs) {
        const q = sp.q;
        if (s.t.length < MIN_LEN && q.kind !== "price") continue;
        if (q.needsBrand && !brandKeys.some((k) => s.n.includes(k))) continue;
        const score = q.patterns.reduce((n, re) => n + (re.test(s.t) ? 1 : 0), 0);
        if (score >= q.min) sp.cands.push({ text: s.t, url: d.url, score: score + (q.kind === "price" && findPrices(s.t).length ? 1 : 0) });
      }
    }
    if (s.t.length >= MIN_LEN) for (const sp of cspecs) {
      if (!sp.qTokens.length) continue;
      const hit = sp.qTokens.filter((t) => s.n.includes(t)).length;
      if (hit >= sp.need) sp.cands.push({ text: s.t, url: d.url, score: hit });
    }
  }
}

/**
 * Trả lời TẤT CẢ câu hỏi cùng lúc: các chủ đề (banks) và các câu hỏi gõ thêm (custom). Mỗi câu của mỗi tài liệu được duyệt đúng một lần
 * và chấm cho mọi câu hỏi, nên thêm câu hỏi không làm tăng số lần đọc trang. pages: tài liệu hoặc trang thô {url, html}.
 * Trả về { topics: {id: entry}, custom: [{question, snippets, pages}], docs }.
 */
export function answerAll({ product = "", banks = [], custom = [] }, pages, queryTokens) {
  const docs = relevant(pages, queryTokens);
  let brands = [], brandKeys = [];
  if (banks.some((q) => q.kind === "brands" || q.needsBrand)) { // đếm hãng một lần, chỉ khi có câu hỏi cần
    const count = new Map();
    for (const { d } of docs) for (const b of new Set(brandsIn(d.title, d.text, queryTokens, d.site))) { const k = stripAccents(b); const e = count.get(k) || { value: b, count: 0 }; e.count++; count.set(k, e); }
    brands = [...count.values()].sort((a, b) => b.count - a.count).slice(0, 6); brandKeys = brands.slice(0, 5).map((b) => stripAccents(b.value));
  }
  const tspecs = makeTopicSpecs(banks), cspecs = makeCustomSpecs(custom, queryTokens);
  for (const { d, rel } of docs) scoreDoc(d, rel, tspecs, cspecs, queryTokens, brandKeys);
  const topics = {};
  for (const sp of tspecs) {
    const q = sp.q, snippets = pickSnippets(sp.cands), def = TOPIC_DEFS.find((t) => t.id === q.id);
    const entry = { label: def ? def.label : q.label, group: q.group, group_label: GROUPS[q.group], query: q.ask(product), snippets, pages: new Set(snippets.map((s) => s.url)).size };
    if (q.kind === "brands") entry.brands = brands;
    if (q.kind === "price") { // khoảng giá từ giá đọc chắc chắn của từng trang (đã loại phụ kiện, voucher), không quét mọi con số trên trang
      const ps = priceSummary(docs.map((x) => x.d)), v = [...ps.values].sort((a, b) => a - b);
      if (v.length) entry.price = { min: v[0], max: v.at(-1), median: v[Math.floor((v.length - 1) / 2)], count: v.length, confident: ps.sure };
    }
    topics[q.id] = entry;
  }
  return { topics, custom: cspecs.map((sp) => { const snippets = pickSnippets(sp.cands, 6); return { question: sp.question, snippets, pages: new Set(snippets.map((s) => s.url)).size }; }), docs: docs.length };
}

/** Câu trả lời còn thiếu (ít hơn 2 câu trích): chỉ những câu này mới cần tìm thêm trên Google. */
export const isWeak = (entry) => !entry || entry.snippets.length < 2;
export const weakTopicIds = (topics) => Object.keys(topics).filter((id) => isWeak(topics[id]) && !(topics[id].price && id === "price" && topics[id].snippets.length >= 1));
export const weakCustomIdx = (custom) => custom.map((c, i) => (isWeak(c) ? i : -1)).filter((i) => i >= 0);

/** Từ khóa Google gộp cho nhiều chủ đề còn thiếu: một lượt tìm thay cho mỗi chủ đề một lượt (VD "máy hút bụi giá công nghệ phân loại"). */
export function combinedQuery(product, topicIds) {
  const keys = topicIds.map((id) => (TOPIC_DEFS.find((t) => t.id === id) || {}).key).filter(Boolean);
  return `${product} ${keys.join(" ")}`.trim();
}

/** Trả lời các chủ đề đã chọn, một lượt quét. */
export function answerTopics(topicIds, product, pages, queryTokens) {
  const banks = topicIds.map((id) => ALL_QUESTIONS.find((q) => q.id === id)).filter(Boolean);
  return answerAll({ product, banks }, pages, queryTokens).topics;
}
/** Trả lời một chủ đề (dùng cho test và nơi chỉ cần một chủ đề). */
export function answerTopic(topicId, product, pages, queryTokens) {
  if (!ALL_QUESTIONS.some((q) => q.id === topicId)) throw new Error(`Chủ đề không hợp lệ: ${topicId}`);
  return answerTopics([topicId], product, pages, queryTokens)[topicId];
}
/** Trả lời các câu hỏi gõ thêm bằng các câu trong bài chứa nhiều từ của câu hỏi nhất. */
export function answerCustomMany(questions, pages, queryTokens) { return answerAll({ custom: questions }, pages, queryTokens).custom; }
export function answerCustom(question, pages, queryTokens) { return answerCustomMany([question], pages, queryTokens)[0]; }

/** Kế hoạch trả lời tương thích bản cũ: plan = planKnowledge(...). */
export function answerKnowledge(plan, pages, queryTokens) {
  const r = answerAll({ banks: plan._bank }, pages, queryTokens).topics;
  for (const q of plan.questions) if (r[q.id]) r[q.id].query = q.ask;
  return r;
}

/* ------------------------------------------------------------------ tóm tắt bài viết tham khảo */
/** Tóm tắt bài từ tài liệu đã xử lý (không đọc lại HTML): tiêu đề, mô tả, đề mục, ý chính, số liệu. */
export function articleOf(doc) {
  const s = doc.summary || { title: doc.title, description: "", headings: [], keyPoints: [], facts: [] };
  return { url: doc.url, domain: doc.domain, title: (s.title || doc.title).slice(0, 160), description: s.description, headings: s.headings, keyPoints: s.keyPoints, facts: s.facts, doc };
}
export function summarizeArticle(html, url) { return articleOf(asDoc({ url, html })); }

/** Câu hỏi liên quan ngành hàng/mặt hàng và câu trả lời trích từ chính bài đó (chỉ giữ câu hỏi có trả lời). */
export function articleQuestions(article, product, category, max = 6) {
  const bank = [...COMMON.filter((q) => !q.kind), ...(BY_CATEGORY[category] || [])];
  const res = answerAll({ product, banks: bank }, [article.doc], []).topics;
  return Object.entries(res).filter(([, r]) => r.snippets.length).slice(0, max).map(([id, r]) => ({ id, label: r.label, ask: r.query, snippets: r.snippets.slice(0, 2) }));
}

/** Các câu hỏi (bank) của danh sách chủ đề. */
export const topicBanks = (ids) => ids.map((id) => ALL_QUESTIONS.find((q) => q.id === id)).filter(Boolean);
