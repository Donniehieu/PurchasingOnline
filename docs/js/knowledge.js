// Tìm hiểu sản phẩm theo nhóm ngành hàng và tư vấn mua hàng. Không dùng AI: bộ câu hỏi cố định theo ngành,
// câu trả lời là các câu trích nguyên văn từ các trang đã crawl (kèm nguồn), nên cần người mua đọc và đánh giá lại.
import { CATEGORIES, brandsIn, domainOf, findPrices, htmlToText, normKey, phraseRelevance, siteTokensOf, stripAccents } from "./core.js";

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
  Q("price", "gia", "Giá cả", (p) => `${p} giá bao nhiêu, khoảng giá phổ biến là bao nhiêu?`, [/giá/i, /\d[\d.,]*\s*(?:đ|₫|vnđ|vnd|triệu|nghìn|k)\b/i], 2, { kind: "price" }),
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

const MAH_RE = /(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\s*m\s?ah/gi;
const SENTENCE_SPLIT = /(?<=[.!?])\s+|\s{2,}|\s[-•·|]\s/;
const MIN_LEN = 50, MIN_LEN_PRICE = 14; // câu nêu giá thường ngắn ("Giá: 1.190.000đ.")
const pageSentences = (text) => text.slice(0, 40000).split(SENTENCE_SPLIT).map((s) => s.trim()).filter((s) => s.length >= MIN_LEN_PRICE && s.length <= 300);

/**
 * Trả lời các câu hỏi bằng câu trích từ các trang đã đọc.
 * pages: [{ url, html }] (gồm cả trang tìm sản phẩm và trang của các lượt tìm bổ sung).
 * Trả về object tương thích job.research: { [id]: { label, group, group_label, query, snippets, brands?, price?, pages } }.
 */
export function answerKnowledge(plan, pages, queryTokens) {
  const docs = [];
  for (const p of pages) {
    if (!p || !p.html) continue;
    const text = htmlToText(p.html), rel = phraseRelevance(queryTokens, stripAccents(text));
    if (rel < 0.5) continue;
    docs.push({ url: p.url, text, rel, site: siteTokensOf(p.html, p.url), sentences: pageSentences(text), title: ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(p.html) || [, ""])[1]).replace(/\s+/g, " ").trim() });
  }
  // Hãng: đếm số trang nhắc tới
  const brandCount = new Map();
  for (const d of docs) for (const b of new Set(brandsIn(d.title, d.text, queryTokens, d.site))) { const k = stripAccents(b); const e = brandCount.get(k) || { value: b, count: 0 }; e.count++; brandCount.set(k, e); }
  const brands = [...brandCount.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  const brandKeys = brands.slice(0, 5).map((b) => stripAccents(b.value));

  const out = {};
  for (const q of plan._bank) {
    const cands = [];
    for (const d of docs) for (const s of d.sentences) {
      if (s.length < MIN_LEN && q.kind !== "price") continue;
      const norm = stripAccents(s);
      if (q.needsBrand && !brandKeys.some((k) => norm.includes(k))) continue;
      if (d.rel < 0.8 && !queryTokens.some((t) => norm.includes(t))) continue; // trang chỉ liên quan một phần thì câu phải nhắc sản phẩm
      const score = q.patterns.reduce((n, re) => n + (re.test(s) ? 1 : 0), 0);
      if (score >= q.min) cands.push({ text: s, url: d.url, score: score + (q.kind === "price" && findPrices(s).length ? 1 : 0) });
    }
    cands.sort((a, b) => b.score - a.score || Math.abs(a.text.length - 140) - Math.abs(b.text.length - 140));
    const snippets = [], perPage = new Map(), seen = new Set();
    for (const c of cands) {
      const key = normKey(c.text).slice(0, 60);
      if (seen.has(key) || (perPage.get(c.url) || 0) >= 2) continue;
      seen.add(key); perPage.set(c.url, (perPage.get(c.url) || 0) + 1); snippets.push({ text: c.text, url: c.url });
      if (snippets.length >= 4) break;
    }
    const entry = { label: q.label, group: q.group, group_label: GROUPS[q.group], query: plan.questions.find((x) => x.id === q.id).ask, snippets, pages: new Set(snippets.map((s) => s.url)).size };
    if (q.kind === "brands") entry.brands = brands;
    if (q.kind === "price") {
      const prices = docs.flatMap((d) => findPrices(d.text)).sort((a, b) => a - b);
      if (prices.length) entry.price = { min: prices[0], max: prices[prices.length - 1], median: prices[Math.floor((prices.length - 1) / 2)], count: prices.length };
    }
    out[q.id] = entry;
  }
  return out;
}

/* ------------------------------------------------------------------ chủ đề tìm hiểu do người dùng chọn */
/** Năm chủ đề người dùng có thể bật/tắt. suffix là cụm từ thêm vào truy vấn Google để ra các bài viết đúng chủ đề. */
export const TOPIC_DEFS = [
  { id: "price", label: "Giá trung bình", suffix: "giá bao nhiêu giá bán" },
  { id: "pros", label: "Ưu nhược điểm", suffix: "ưu nhược điểm đánh giá" },
  { id: "using", label: "Công nghệ sử dụng", suffix: "công nghệ sử dụng nguyên lý" },
  { id: "types", label: "Phân loại", suffix: "phân loại các loại" },
  { id: "buy", label: "Lưu ý khi mua", suffix: "lưu ý khi mua kinh nghiệm chọn mua" },
];
const ALL_QUESTIONS = [...COMMON, ...Object.values(BY_CATEGORY).flat()];

/** Trả lời một chủ đề bằng câu trích từ các bài đã đọc. Trả về { label, group, query, snippets, price?, pages }. */
export function answerTopic(topicId, product, pages, queryTokens) {
  const bank = ALL_QUESTIONS.find((q) => q.id === topicId);
  if (!bank) throw new Error(`Chủ đề không hợp lệ: ${topicId}`);
  const plan = { questions: [{ id: bank.id, ask: bank.ask(product) }], _bank: [bank] };
  const entry = answerKnowledge(plan, pages, queryTokens)[topicId];
  const def = TOPIC_DEFS.find((t) => t.id === topicId);
  return { ...entry, label: def ? def.label : entry.label };
}

const QSTOP = new Set(["va", "la", "cua", "cho", "co", "khong", "nhu", "the", "nao", "gi", "duoc", "nay", "mot", "cac", "nhung", "bao", "nhieu", "khi", "hay", "voi", "trong", "thi", "da", "se", "ra", "vao", "can", "nen", "hon"]);
/** Trả lời câu hỏi/từ khóa người dùng gõ thêm: lấy các câu trong bài chứa nhiều từ của câu hỏi nhất. */
export function answerCustom(question, pages, queryTokens) {
  const qTokens = [...new Set(stripAccents(question).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !QSTOP.has(t)))];
  const need = Math.max(1, Math.ceil(qTokens.length * 0.5));
  const cands = [];
  for (const p of pages) {
    if (!p || !p.html) continue;
    const text = htmlToText(p.html);
    if (phraseRelevance(queryTokens, stripAccents(text)) < 0.5) continue;
    for (const s of pageSentences(text)) {
      if (s.length < MIN_LEN) continue;
      const norm = stripAccents(s), hit = qTokens.filter((t) => norm.includes(t)).length;
      if (hit >= need) cands.push({ text: s, url: p.url, score: hit });
    }
  }
  cands.sort((a, b) => b.score - a.score || Math.abs(a.text.length - 140) - Math.abs(b.text.length - 140));
  const snippets = [], per = new Map(), seen = new Set();
  for (const c of cands) {
    const k = normKey(c.text).slice(0, 60);
    if (seen.has(k) || (per.get(c.url) || 0) >= 2) continue;
    seen.add(k); per.set(c.url, (per.get(c.url) || 0) + 1); snippets.push({ text: c.text, url: c.url });
    if (snippets.length >= 6) break;
  }
  return { question, snippets, pages: new Set(snippets.map((s) => s.url)).size };
}

/* ------------------------------------------------------------------ tóm tắt bài viết tham khảo */
const strip = (h) => htmlToText(String(h));
/** Tóm tắt một bài viết: tiêu đề, mô tả, các đề mục, vài ý chính và số liệu cụ thể. */
export function summarizeArticle(html, url) {
  const title = strip((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [, ""])[1]);
  const meta = (/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]*content=["']([^"']*)["']/i.exec(html) || [, ""])[1];
  const headings = [];
  for (const m of html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)) { const t = strip(m[2]); if (t.length >= 4 && t.length <= 140 && !headings.includes(t)) headings.push(t); if (headings.length >= 10) break; }
  const sentences = [];
  for (const m of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) for (const s of strip(m[1]).split(SENTENCE_SPLIT)) { const t = s.trim(); if (t.length >= 60 && t.length <= 260) sentences.push(t); }
  const rank = (s) => (/\d/.test(s) ? 2 : 0) + (/(ưu điểm|nhược điểm|lưu ý|nên|công nghệ|giá|bảo hành|khuyến nghị|so với)/i.test(s) ? 2 : 0);
  const keyPoints = [...new Map(sentences.map((s, i) => [normKey(s).slice(0, 50), { s, i, r: rank(s) }])).values()]
    .sort((a, b) => b.r - a.r || a.i - b.i).slice(0, 5).sort((a, b) => a.i - b.i).map((x) => x.s);
  const text = strip(html);
  const prices = findPrices(text).slice(0, 5), mah = [...new Set([...text.matchAll(MAH_RE)].map((m) => toIntLocal(m[1])))].slice(0, 3);
  const facts = [];
  if (prices.length) facts.push(`Giá nhắc tới: ${[...new Set(prices)].map((p) => `${Math.round(p).toLocaleString("vi-VN")} đ`).join(", ")}`);
  if (mah.length) facts.push(`Dung lượng pin: ${mah.map((v) => `${v.toLocaleString("vi-VN")} mAh`).join(", ")}`);
  const w = /(\d{1,5})\s*W\b/.exec(text); if (w) facts.push(`Công suất: ${w[1]} W`);
  const war = /bảo\s*hành[^.\n]{0,25}?(\d{1,2})\s*(tháng|năm)/i.exec(text); if (war) facts.push(`Bảo hành: ${war[1]} ${war[2]}`);
  return { url, domain: domainOf(url), title: title.slice(0, 160), description: strip(meta).slice(0, 300), headings, keyPoints, facts, text };
}
const toIntLocal = (raw) => parseInt(String(raw).replace(/[.,]/g, ""), 10);

/** Câu hỏi liên quan ngành hàng/mặt hàng và câu trả lời trích từ chính bài viết đó (chỉ giữ câu hỏi có trả lời). */
export function articleQuestions(article, product, category, max = 6) {
  const bank = [...COMMON.filter((q) => !q.kind), ...(BY_CATEGORY[category] || [])];
  const plan = { questions: bank.map((q) => ({ id: q.id, ask: q.ask(product) })), _bank: bank };
  const res = answerKnowledge(plan, [{ url: article.url, html: `<html><head><title>${article.title}</title></head><body><p>${article.text.slice(0, 40000).replace(/</g, " ")}</p></body></html>` }], []);
  return Object.entries(res).filter(([, r]) => r.snippets.length).slice(0, max).map(([id, r]) => ({ id, label: r.label, ask: r.query, snippets: r.snippets.slice(0, 2) }));
}
