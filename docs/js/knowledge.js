// Tìm hiểu sản phẩm theo nhóm ngành hàng và tư vấn mua hàng. Không dùng AI: bộ câu hỏi cố định theo ngành,
// câu trả lời là các câu trích nguyên văn từ các trang đã crawl (kèm nguồn), nên cần người mua đọc và đánh giá lại.
import { CATEGORIES, brandsIn, domainOf, findPrices, htmlToText, normKey, phraseRelevance, stripAccents } from "./core.js";

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
    docs.push({ url: p.url, text, rel, sentences: pageSentences(text), title: ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(p.html) || [, ""])[1]).replace(/\s+/g, " ").trim() });
  }
  // Hãng: đếm số trang nhắc tới
  const brandCount = new Map();
  for (const d of docs) for (const b of new Set(brandsIn(d.title, d.text, queryTokens))) { const k = stripAccents(b); const e = brandCount.get(k) || { value: b, count: 0 }; e.count++; brandCount.set(k, e); }
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

/* ------------------------------------------------------------------ tư vấn */
const vnd = (v) => `${Math.round(v).toLocaleString("vi-VN")} đ`;
/**
 * Tư vấn theo tên sản phẩm (hoặc ảnh), ngân sách và nhu cầu. Chỉ dựa trên dữ liệu crawl, không bịa thêm.
 * input: { query, need, budget }; discovery: kết quả buildDiscovery; research: kết quả answerKnowledge.
 */
export function buildAdvice(input, discovery, research) {
  const need = (input.need || "").trim(), budget = input.budget ? +input.budget : null, query = input.query;
  const needTokens = stripAccents(need).split(/\s+/).filter((t) => t.length >= 3);
  const sections = [], cat = CATEGORIES[discovery.category] || CATEGORIES.chung;
  const first = (id, n = 2) => ((research[id] || {}).snippets || []).slice(0, n);
  const fmt = (list) => list.map((s) => ({ text: s.text, url: s.url }));

  const understand = [`Sản phẩm: ${query}${need ? `. Nhu cầu: ${need}` : ""}${budget ? `. Ngân sách: ${vnd(budget)}` : ""}.`, `Nhóm ngành hàng nhận diện: ${cat.label}. Đã đọc ${discovery.read} trang, ${discovery.total} trang đúng sản phẩm.`];
  sections.push({ heading: "1. Hiểu nhu cầu", points: understand.map((t) => ({ text: t })) });

  const price = [];
  if (discovery.price) {
    const p = discovery.price;
    price.push({ text: `Mặt bằng giá trên web: thấp nhất ${vnd(p.min)}, trung vị ${vnd(p.median)}, cao nhất ${vnd(p.max)} (${p.count} mức giá, trong đó ${p.confident ?? 0} giá đọc từ dữ liệu hoặc chữ "giá" của trang${p.outliers ? `; đã loại ${p.outliers} giá lệch hẳn mặt bằng, thường là phụ kiện hoặc voucher` : ""}).` });
    price.push({ text: "Giá chỉ để tham khảo: một trang có thể có nhiều phiên bản, khuyến mãi hoặc giá theo thời điểm, hãy mở trang để xem giá hiện tại." });
    if (budget) {
      const ok = (i) => i.price && !i.price_flag, ratio = budget / p.median, inBudget = discovery.items.filter((i) => ok(i) && i.price <= budget).length;
      price.push({ text: ratio < 0.6 ? `Ngân sách thấp hơn nhiều so với mức phổ biến (${Math.round(ratio * 100)}% trung vị): dễ gặp hàng kém chất lượng hoặc chỉ mua được phụ kiện, nên kiểm tra kỹ.`
        : ratio <= 1.2 ? `Ngân sách phù hợp với mặt bằng giá (${Math.round(ratio * 100)}% trung vị).` : `Ngân sách cao hơn mức phổ biến (${Math.round(ratio * 100)}% trung vị): có thể cân nhắc bản cao cấp, chính hãng hoặc mua số lượng để đàm phán chiết khấu.` });
      price.push({ text: `${inBudget}/${discovery.items.filter(ok).length} trang có giá nằm trong ngân sách.` });
    }
  } else price.push({ text: "Các trang đã đọc không có giá rõ ràng, hãy mở trang nguồn hoặc hỏi báo giá NCC." });
  price.push(...fmt(first("price", 2)));
  sections.push({ heading: "2. Mặt bằng giá và ngân sách", points: price });

  const fit = [];
  const pool = ["types", "using", "tech", "pros", "purpose"].flatMap((id) => first(id, 4));
  const matched = needTokens.length ? pool.filter((s) => needTokens.some((t) => stripAccents(s.text).includes(t))).slice(0, 3) : [];
  if (need) fit.push(...(matched.length ? matched.map((s) => ({ text: `Liên quan đến nhu cầu "${need}": ${s.text}`, url: s.url })) : [{ text: `Chưa thấy trang nào nêu riêng về nhu cầu "${need}". Dưới đây là phân loại và công nghệ phổ biến để bạn tự đối chiếu.` }]));
  fit.push(...fmt(first("types", 2)), ...fmt(first("tech", 2)), ...fmt(first("using", 1)));
  if (discovery.purposes && discovery.purposes.length) fit.push({ text: `Mục đích sử dụng hay được nêu: ${discovery.purposes.map((p) => p.value).join("; ")}.` });
  sections.push({ heading: "3. Loại và công nghệ nên cân nhắc", points: fit });

  const brandPts = [];
  const brands = ((research.brands || {}).brands || []);
  brandPts.push({ text: brands.length ? `Hãng/thương hiệu hay gặp: ${brands.map((b) => `${b.value} (${b.count} trang)`).join(", ")}.` : "Chưa nhận diện được hãng nào rõ ràng từ các trang đã đọc." });
  brandPts.push(...fmt(first("brand_pros", 2)));
  sections.push({ heading: "4. Hãng sản xuất", points: brandPts });

  const sure = (i) => !i.price_flag && ["jsonld", "meta", "itemprop", "label"].includes(i.price_source);
  const noteOf = (i) => (i.price_flag ? "Giá lệch hẳn mặt bằng, có thể là phụ kiện, voucher hoặc giá sai" : sure(i) ? "Giá đọc từ trang" : i.price_source === "snippet" ? "Giá lấy từ mô tả tìm kiếm, chưa mở trang" : "Giá đoán từ chữ trên trang, hãy mở link kiểm tra");
  const picks = discovery.items.filter((i) => i.price).map((i) => ({ ...i, note: noteOf(i), sure: sure(i), fit: i.price_flag ? "Nghi sai giá" : budget ? (i.price <= budget ? "Trong ngân sách" : `Vượt ${Math.round((i.price / budget - 1) * 100)}%`) : "" }));
  // Giá đáng tin lên trước, giá nghi sai xuống cuối; trong mỗi nhóm gần ngân sách (hoặc rẻ) lên trước.
  picks.sort((a, b) => (a.price_flag ? 1 : 0) - (b.price_flag ? 1 : 0) || (b.sure ? 1 : 0) - (a.sure ? 1 : 0) || (budget ? Math.abs(a.price - budget) - Math.abs(b.price - budget) : a.price - b.price));
  sections.push({ heading: "5. Gợi ý trang để xem (đúng sản phẩm, có giá)", points: picks.length ? [] : [{ text: "Chưa có trang nào có giá rõ ràng." }], picks: picks.slice(0, 6) });

  const careful = [...fmt(first("buy", 3)), ...fmt(first("risks", 1))];
  if (!careful.length) careful.push({ text: "Chưa trích được lưu ý cụ thể từ web. Nên xin báo giá từ ít nhất 3 NCC, yêu cầu hóa đơn VAT và bảo hành bằng văn bản." });
  sections.push({ heading: "6. Lưu ý khi mua", points: careful });
  return { query, need, budget, category: cat.label, sections, domains: [...new Set(discovery.items.map((i) => i.domain || domainOf(i.url)))] };
}
