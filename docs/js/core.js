// Lõi xử lý thuần JavaScript (không dùng DOM) để chạy được cả trên trình duyệt lẫn Node (test).
// Gồm: trích xuất thông tin trang NCC, chấm điểm, đàm phán, thuyết phục, question card, lịch sử, sửa ô.

export const CUSTOM = "__custom__";
export const STALE_MONTHS = 6;

/* ------------------------------------------------------------------ tiện ích */
export function stripAccents(text) {
  return String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}
export function money(value) {
  return value ? `${Math.round(value).toLocaleString("vi-VN")} đ` : "Chưa rõ";
}
export function normKey(name) { return stripAccents(name).split(/\s+/).filter(Boolean).join(" "); }
export function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
export function median(values) {
  const v = [...values].sort((a, b) => a - b); if (!v.length) return null;
  const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
export function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
export function ageMonths(iso, now = new Date()) {
  if (!iso) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); if (!m) return null;
  return Math.max(0, (now.getFullYear() - +m[1]) * 12 + now.getMonth() + 1 - +m[2]);
}
export function parseUrls(text) {
  const urls = [];
  for (const part of String(text || "").split(/\s+/)) if (/^https?:\/\//i.test(part) && !urls.includes(part)) urls.push(part);
  return urls;
}

/* ------------------------------------------------------------------ trích xuất trang NCC */
const PRICE_MIN = 50_000, PRICE_MAX = 20_000_000;
const GENERIC = new Set(["gia", "mua", "cho", "va", "loai", "tot", "re", "nhat", "ban", "hang", "chinh"]);
const toInt = (raw) => parseInt(String(raw).replace(/[.,]/g, ""), 10);

export function htmlToText(html) {
  return html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
}
function metaTags(html) {
  const tags = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const a of m[0].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g)) attrs[(a[1] || a[3]).toLowerCase()] = a[2] ?? a[4];
    tags.push(attrs);
  }
  return tags;
}
function metaContent(tags, ...names) {
  for (const name of names) {
    const t = tags.find((x) => (x.property || x.name || "").toLowerCase() === name && x.content);
    if (t) return t.content.trim();
  }
  return "";
}

export function queryKeywords(query) {
  return stripAccents(query).split(/\s+/).filter((t) => t.length >= 2 && !GENERIC.has(t) && !/\d/.test(t));
}
export function phraseRelevance(tokens, normText) {
  if (!tokens.length) return 1;
  if (tokens.length === 1) return new RegExp(`\\b${tokens[0]}\\b`).test(normText) ? 1 : 0;
  const phrases = tokens.slice(1).map((t, i) => `${tokens[i]} ${t}`);
  return phrases.filter((p) => new RegExp(`\\b${p}\\b`).test(normText)).length / phrases.length;
}
export function findPrices(text) {
  const ok = (p) => p >= PRICE_MIN && p <= PRICE_MAX;
  const labelled = [...text.matchAll(/giá[^0-9]{0,30}?(\d{1,3}(?:[.,]\d{3})+)\s*(?:đ|₫|vnđ|vnd)/gi)].map((m) => toInt(m[1])).filter(ok);
  if (labelled.length) return labelled;
  return [...text.matchAll(/(\d{1,3}(?:[.,]\d{3})+)\s*(?:đ|₫|vnđ|vnd)/gi)].map((m) => toInt(m[1])).filter(ok);
}
export function pageDate(html, tags, text) {
  const cands = [];
  for (const n of ["article:modified_time", "article:published_time", "og:updated_time", "last-modified", "date", "pubdate"]) {
    const v = metaContent(tags, n); if (v) cands.push(v);
  }
  for (const m of html.matchAll(/<time\b[^>]*datetime=["']([^"']+)["']/gi)) cands.push(m[1]);
  for (const m of html.matchAll(/"date(?:Modified|Published)"\s*:\s*"([^"]+)"/g)) cands.push(m[1]);
  for (const c of cands) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(c.trim()); if (m) return `${m[1]}-${m[2]}-${m[3]}`; }
  const t = /(?:cập nhật|đăng|ngày|updated|published)[^0-9]{0,15}(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})/i.exec(text.slice(0, 20000));
  if (t) {
    const [d, mo, y] = [+t[1], +t[2], +t[3]]; const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}
function normalizePhone(raw) {
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("84") && [11, 12].includes(digits.length)) digits = "0" + digits.slice(2);
  return digits.startsWith("0") && [10, 11].includes(digits.length) ? digits : null;
}
export function extractContacts(html, pageUrl, text) {
  const c = { phones: [], zalo: [], zalo_guess: false, messenger: [], facebook: [], emails: [], skype: [], website: "" };
  const add = (list, v, limit = 4) => { if (v && !list.includes(v) && list.length < limit) list.push(v); };
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1].trim(), low = href.toLowerCase();
    if (low.startsWith("tel:")) add(c.phones, normalizePhone(href.slice(4)));
    else if (low.startsWith("mailto:")) add(c.emails, href.slice(7).split("?")[0]);
    else if (low.startsWith("skype:")) add(c.skype, href.slice(6).split("?")[0]);
    else if (low.includes("zalo.me/") || low.includes("chat.zalo.me")) add(c.zalo, href);
    else if (low.includes("m.me/") || low.includes("facebook.com/messages")) add(c.messenger, href);
    else if (low.includes("facebook.com/") && !/sharer|share\.php|plugins|tr\?/.test(low)) add(c.facebook, href);
  }
  for (const m of text.slice(0, 30000).matchAll(/(?<![\d.])(?:\+?84|0)(?:[\s.\-]?\d){8,10}(?!\d)/g)) add(c.phones, normalizePhone(m[0]));
  for (const m of text.slice(0, 30000).matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) if (!/\.(png|jpg|webp)$/i.test(m[0])) add(c.emails, m[0]);
  if (!c.zalo.length && c.phones.length) { c.zalo = [`https://zalo.me/${c.phones[0]}`]; c.zalo_guess = true; }
  try { const u = new URL(pageUrl); c.website = `${u.protocol}//${u.host}`; } catch { /* bỏ qua */ }
  return c;
}

/** Đọc HTML một trang NCC. Trả về null nếu không đúng sản phẩm. */
export function parsePage(html, url, tokens, productCode = "") {
  const tags = metaTags(html);
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [, ""])[1].replace(/\s+/g, " ").trim();
  const text = htmlToText(html);
  const norm = stripAccents(text);
  let relevance = phraseRelevance(tokens, norm);
  if (productCode) relevance = Math.min(relevance, new RegExp(`\\b${stripAccents(productCode).trim()}\\b`).test(norm) ? 1 : 0.5);
  if (relevance === 0) return null;

  const prices = findPrices(text);
  const mah = [...text.matchAll(/(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\s*m\s?ah/gi)].map((m) => toInt(m[1]));
  const volt = /\b(\d{1,2})\s*V(?:DC)?\b/.exec(text);
  const war = /bảo\s*hành[^.\n]{0,25}?(\d{1,2})\s*(tháng|năm)/i.exec(text);
  let vat = null;
  if (/không\s*(xuất\s*)?hóa\s*đơn/i.test(text)) vat = false;
  if (/hóa\s*đơn\s*(vat|gtgt)|xuất\s*hóa\s*đơn|có\s*hóa\s*đơn/i.test(text)) vat = true;
  const domain = domainOf(url);
  return {
    name: domain, title: (title || domain).slice(0, 120), url, description: metaContent(tags, "og:description", "description").slice(0, 240),
    date: pageDate(html, tags, text), price: prices.length ? Math.min(...prices) : null, vat,
    vat_included: /đã\s*(bao\s*gồm\s*|gồm\s*)?vat/i.test(text), mah: mah[0] ?? null, volt: volt ? +volt[1] : null,
    warranty_months: war ? +war[1] * (war[2].toLowerCase() === "năm" ? 12 : 1) : null,
    relevance: Math.round(relevance * 100) / 100, contacts: extractContacts(html, url, text), note: "",
  };
}

/** Câu trích theo chủ đề nghiên cứu từ văn bản trang. */
export function snippetsFrom(text, pattern, productTokens, max = 2) {
  const out = [];
  for (const raw of text.slice(0, 40000).split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (s.length < 50 || s.length > 300 || !pattern.test(s)) continue;
    if (productTokens.length && !productTokens.some((t) => stripAccents(s).includes(t))) continue;
    out.push(s); if (out.length >= max) break;
  }
  return out;
}
export const TOPICS = {
  tech: { label: "Công nghệ, phân loại, ưu nhược điểm", keywords: "ưu nhược điểm các loại", pattern: /công nghệ|phân loại|loại|ưu điểm|nhược điểm|so sánh/i },
  price: { label: "Giá trung bình", keywords: "giá bao nhiêu", pattern: /giá|đồng|vnđ|₫|trung bình|khoảng/i },
  using: { label: "Sử dụng công nghệ gì", keywords: "công nghệ nguyên lý hoạt động", pattern: /công nghệ|nguyên lý|hoạt động|cấu tạo|động cơ|pin/i },
};

/* ------------------------------------------------------------------ chấm điểm */
export const WEIGHTS = { price: 0.40, warranty: 0.25, vat: 0.20, relevance: 0.15 };
export function scoreSuppliers(items, requireVat = true) {
  const ppk = (i) => (i.price && i.mah ? i.price / (i.mah / 1000) : null);
  const ppks = items.map(ppk).filter(Boolean);
  const best = ppks.length ? Math.min(...ppks) : null;
  const scored = items.map((item) => {
    const row = { ...item }; for (const k of ["recommended", "eligible", "reason", "score"]) delete row[k];
    row.eligible = true; row.reason = "";
    if (requireVat && item.vat === false) return Object.assign(row, { eligible: false, reason: "Không có hóa đơn VAT", score: 0 });
    const p = ppk(item);
    const priceScore = p && best ? best / p : 0.5;
    const vatScore = item.vat === true ? 1 : item.vat === null || item.vat === undefined ? 0.5 : 0;
    row.score = Math.round((WEIGHTS.price * priceScore + WEIGHTS.warranty * Math.min(item.warranty_months || 0, 12) / 12 +
      WEIGHTS.vat * vatScore + WEIGHTS.relevance * (item.relevance ?? 1)) * 1000) / 1000;
    return row;
  });
  const eligible = scored.filter((r) => r.eligible);
  if (eligible.length) { const b = eligible.reduce((a, c) => (c.score > a.score ? c : a)); b.recommended = true; b.reason = "Khuyến nghị: điểm cao nhất"; }
  scored.forEach((r) => { r.recommended = !!r.recommended; });
  return scored.sort((a, b) => (a.eligible === b.eligible ? (b.score || 0) - (a.score || 0) : a.eligible ? -1 : 1));
}
export function priceStats(suppliers) {
  const p = suppliers.filter((s) => s.price).map((s) => s.price); if (!p.length) return null;
  return { count: p.length, mean: Math.round(mean(p)), median: Math.round(median(p)), min: Math.min(...p), max: Math.max(...p) };
}

/* ------------------------------------------------------------------ đàm phán + thuyết phục */
export function buildInsights(suppliers, quantity, ctx = {}) {
  const eligible = suppliers.filter((s) => s.eligible && s.price);
  const rec = suppliers.find((s) => s.recommended);
  return { negotiation: negotiation(eligible, rec, quantity, ctx), persuasion: persuasion(suppliers, eligible, rec, quantity, ctx) };
}
function refs(ctx) {
  const out = [];
  for (const [id, label] of [["price", "Giá thị trường"], ["tech", "Công nghệ, ưu nhược điểm"], ["using", "Công nghệ sử dụng"]])
    for (const s of ((ctx.research || {})[id]?.snippets || []).slice(0, 2)) out.push({ topic: label, text: s.text, url: s.url });
  return out;
}
function negotiation(eligible, rec, quantity, ctx) {
  if (!rec || !rec.price) return [];
  const price = rec.price;
  const others = eligible.filter((s) => s.name !== rec.name).sort((a, b) => a.price - b.price);
  const med = median(eligible.map((s) => s.price));
  let target = null, targetNote = "Giá đang ở mức thấp nhất hoặc gần thấp nhất, tập trung đàm phán chiết khấu số lượng và điều kiện đi kèm.";
  const cheaper = others.filter((s) => s.price < price);
  if (cheaper.length) {
    target = cheaper[0].price;
    targetNote = `Mục tiêu về ${money(target)}: bằng giá của ${cheaper[0].name}, thấp hơn giá hiện tại ${money(price - target)} (${Math.round((price - target) / price * 100)}%).`;
  } else if (med && price > med) { target = Math.round(med); targetNote = `Mục tiêu về ${money(target)}: mức trung vị của các NCC đủ điều kiện.`; }
  const leverage = cheaper.slice(0, 2).map((s) => `${s.name} có giá ${money(s.price)}, thấp hơn ${Math.round((price - s.price) / price * 100)}% so với báo giá hiện tại.`);
  const own = rec.warranty_months || 0;
  const better = others.filter((s) => (s.warranty_months || 0) > own);
  if (better.length) { const b = better.reduce((a, c) => (c.warranty_months > a.warranty_months ? c : a)); leverage.push(`${b.name} bảo hành ${b.warranty_months} tháng; đề nghị bảo hành tương đương hoặc dài hơn.`); }
  const age = ageMonths(rec.date);
  if (age !== null && age >= STALE_MONTHS) leverage.push(`Thông tin giá trên web cập nhật cách đây khoảng ${age} tháng, đề nghị NCC xác nhận lại báo giá hiện hành.`);
  if (!leverage.length) leverage.push("Chưa có NCC nào rẻ hơn hoặc bảo hành tốt hơn trong dữ liệu thu thập, nên chuẩn bị thêm báo giá từ NCC khác để có thêm căn cứ.");
  leverage.push(`Số lượng ${quantity} cái: đề nghị bảng giá theo bậc số lượng và chiết khấu cho đơn này.`);

  const q = [];
  if (rec.vat !== true) q.push("Đơn giá đã bao gồm VAT chưa? Xuất được hóa đơn VAT đúng tên công ty không?");
  if (!rec.warranty_months) q.push("Thời gian bảo hành pin và quạt là bao lâu? Có đổi mới nếu lỗi do nhà sản xuất không?");
  if (!rec.mah) q.push("Dung lượng pin và điện áp thực tế của model này là bao nhiêu? Có tem hoặc chứng nhận CO/CQ không?");
  if (ctx.spec && ctx.spec !== "Không yêu cầu") q.push(`Sản phẩm có đáp ứng đúng thông số yêu cầu (${ctx.spec}) không? Xin gửi thông số kỹ thuật chính thức.`);
  if (ctx.purpose) q.push(`Sản phẩm dùng cho "${ctx.purpose}": NCC có khuyến nghị model phù hợp và độ bền thực tế không?`);
  q.push("Thời gian giao hàng sau khi xác nhận đơn là bao lâu? Phí vận chuyển đã tính chưa?",
    "Báo giá này có hiệu lực đến khi nào? Giá có thay đổi theo số lượng đặt không?",
    "Chính sách đổi trả, hỗ trợ kỹ thuật và địa điểm bảo hành là gì?",
    "Có thể cho mượn hoặc bán mẫu thử trước khi đặt toàn bộ số lượng không?");
  const strategies = [
    `Đàm phán theo gói: gộp số lượng ${quantity} cái, xin chiết khấu và miễn phí giao hàng.`,
    "Thương lượng quyền lợi thay vì chỉ giảm giá: kéo dài bảo hành pin, tặng phụ kiện, đổi mới trong 30 ngày đầu.",
    "Đề nghị giữ giá ổn định trong thời hạn hiệu lực báo giá, ghi rõ trong báo giá hoặc hợp đồng.",
    "Điều kiện thanh toán: đề xuất thanh toán theo đợt (đặt cọc, phần còn lại khi nhận hàng đạt yêu cầu).",
  ];
  if (others.length) strategies.push(`Giữ ${others.length} NCC khác làm phương án dự phòng, nói rõ công ty đang so sánh nhiều báo giá.`);
  return [{
    ncc: rec.name, current_price: price, target_price: target, target_note: targetNote,
    backup: others.length ? `${others[0].name} (${money(others[0].price)})` : "Chưa có NCC dự phòng",
    leverage, questions: q, strategies, references: refs(ctx),
    steps: [
      "Bước 1 - Chuẩn bị: chốt thông số cần mua, số lượng, hạn giao hàng và mức giá tối đa chấp nhận được trước khi liên hệ.",
      "Bước 2 - Hỏi giá (RFQ): gửi cùng một yêu cầu cho ít nhất 3 NCC để so sánh trên cùng điều kiện.",
      "Bước 3 - Đàm phán vòng 1: giá và chiết khấu số lượng, dùng các căn cứ ở mục Điểm mạnh thương lượng.",
      "Bước 4 - Đàm phán vòng 2: bảo hành, giao hàng, thanh toán, hóa đơn VAT, hiệu lực báo giá.",
      "Bước 5 - Xác nhận bằng văn bản: báo giá chính thức có dấu hoặc email xác nhận, ghi rõ model, đơn giá, bảo hành.",
      "Bước 6 - Mua thử mẫu (nếu đơn lớn): kiểm tra thực tế trước khi đặt toàn bộ số lượng.",
    ],
  }];
}
function persuasion(suppliers, eligible, rec, quantity, ctx) {
  if (!rec || !rec.price) return { title: "", sections: [], points: [], closing: "" };
  const price = rec.price, prices = eligible.map((s) => s.price), med = median(prices);
  const others = eligible.filter((s) => s.name !== rec.name);
  const product = ctx.product || "sản phẩm";
  const sections = [];
  const need = [`Nhu cầu: mua ${quantity} ${product}.`];
  if (ctx.purpose) need.push(`Mục đích sử dụng: ${ctx.purpose}.`);
  if (ctx.spec && ctx.spec !== "Không yêu cầu") need.push(`Thông số yêu cầu đã xác nhận: ${ctx.spec}.`);
  sections.push({ heading: "1. Nhu cầu và yêu cầu", points: need });

  const survey = [`Đã khảo sát ${new Set(suppliers.map((s) => s.url)).size} trang web NCC, trong đó ${eligible.length} NCC đủ điều kiện (có thể xuất hóa đơn VAT hoặc chưa có thông tin loại trừ).`];
  if (prices.length >= 2) survey.push(`Giá thu thập được từ ${money(Math.min(...prices))} đến ${money(Math.max(...prices))}, trung vị ${money(med)}, trung bình ${money(mean(prices))}.`);
  for (const s of ((ctx.research || {}).price?.snippets || []).slice(0, 1)) survey.push(`Tham khảo mặt bằng giá trên web: "${s.text}" (nguồn: ${s.url}).`);
  for (const s of ((ctx.research || {}).tech?.snippets || []).slice(0, 1)) survey.push(`Tham khảo về công nghệ: "${s.text}" (nguồn: ${s.url}).`);
  sections.push({ heading: "2. Khảo sát thị trường", points: survey });

  const why = [`${rec.name} đạt điểm đánh giá cao nhất (${rec.score}) theo các tiêu chí giá, bảo hành, hóa đơn VAT và độ phù hợp.`,
    `Đơn giá tham khảo ${money(price)}, tổng giá trị dự kiến khoảng ${money(price * quantity)} cho ${quantity} cái.`];
  if (med && price < med) why.push(`Thấp hơn mức trung vị ${money(med)}, có thể tiết kiệm khoảng ${money((med - price) * quantity)} cho cả đơn.`);
  if (rec.warranty_months) {
    const ow = others.map((s) => s.warranty_months).filter(Boolean);
    const avg = ow.length ? mean(ow) : null;
    why.push(`Bảo hành ${rec.warranty_months} tháng${avg !== null && rec.warranty_months > avg ? `, cao hơn mức trung bình ${Math.round(avg)} tháng của NCC khác` : ""}.`);
  }
  if (rec.vat === true) why.push("Có hóa đơn VAT, thuận tiện cho kế toán.");
  if (others.length) why.push(`Phương án dự phòng: ${others[0].name} (${money(others[0].price)}).`);
  sections.push({ heading: "3. Vì sao đề xuất NCC này", points: why });

  const filled = [price, rec.mah, rec.warranty_months, rec.vat === true, rec.date].filter(Boolean).length;
  const risks = [`Dữ liệu lấy từ website công khai hoặc do người mua nhập, hiện có ${filled}/5 thông tin đầy đủ (giá, dung lượng, bảo hành, VAT, ngày cập nhật). Giá chưa phải báo giá chính thức.`];
  const age = ageMonths(rec.date);
  if (age !== null && age >= STALE_MONTHS) risks.push(`Thông tin giá trên trang đã cũ khoảng ${age} tháng, cần xác nhận lại.`);
  risks.push("Cách kiểm soát: xin báo giá chính thức bằng văn bản, đàm phán điều kiện bảo hành và giao hàng, mua thử mẫu trước khi đặt cả đơn.");
  sections.push({ heading: "4. Rủi ro và cách kiểm soát", points: risks });
  sections.push({ heading: "5. Đề xuất bước tiếp theo", points: [
    "Cho phép liên hệ NCC được đề xuất và 2 NCC dự phòng để lấy báo giá chính thức.",
    "Đàm phán giá và điều kiện, sau đó trình lại kết quả cuối để duyệt đặt hàng." ] });
  return {
    title: `Đề xuất mua ${quantity} ${product} từ ${rec.name}`, sections, points: sections.flatMap((s) => s.points),
    closing: "Kính trình anh/chị xem xét. Em rất mong nhận được góp ý và sự đồng ý của anh/chị để em tiếp tục xác nhận báo giá chính thức và đàm phán thêm trước khi đặt hàng. Em xin cảm ơn anh/chị.",
  };
}
export function persuasionText(p) {
  if (!p || !p.title) return "";
  return [p.title, "", ...p.sections.flatMap((s) => [s.heading, ...s.points.map((x) => `- ${x}`), ""]), p.closing].join("\n");
}
export function rfqText(job, s) {
  const spec = [job.spec?.mah ? `pin ${job.spec.mah} mAh` : "", job.spec?.volt ? `${job.spec.volt}V` : ""].filter(Boolean).join(", ");
  return `Kính gửi ${s.name},\n\nCông ty chúng tôi cần mua: ${job.query}${spec ? ` (${spec})` : ""}, số lượng ${job.quantity}.\nMục đích sử dụng: ${job.purpose || "chưa nêu"}.\n\nXin anh/chị vui lòng gửi báo giá gồm:\n- Đơn giá chưa VAT và đã VAT\n- Thông số kỹ thuật, model, xuất xứ\n- Thời gian bảo hành, chính sách đổi trả\n- Thời gian giao hàng, phí vận chuyển\n- Chiết khấu theo số lượng\n- Hiệu lực báo giá\n\nXin cảm ơn và mong sớm nhận phản hồi.`;
}

/* ------------------------------------------------------------------ question card */
const uniq = (opts) => { const seen = new Set(); return opts.filter((o) => (seen.has(o.value) ? false : seen.add(o.value))); };
const mahLabel = (v) => `${Number(v).toLocaleString("vi-VN")} mAh`;
export function buildCards(req, suggestedName = null, ocrText = "") {
  const query = (req.query || "").trim(), code = (req.product_code || "").trim(), purpose = (req.purpose || "").trim();
  const quantity = req.quantity || 1, custom = { value: CUSTOM, label: "Khác (nhập bên dưới)" };
  const cards = [];
  const names = [];
  if (query) names.push({ value: query, label: `Đúng: ${query}` });
  if (suggestedName && suggestedName.toLowerCase() !== query.toLowerCase()) names.push({ value: suggestedName, label: `Theo ảnh: ${suggestedName}` });
  if (!names.length && code) names.push({ value: code, label: `Dùng mã: ${code}` });
  names.push(custom);
  cards.push({ id: "product", title: "Tên sản phẩm", question: "Sản phẩm bạn cần mua có đúng là như này không?", options: uniq(names), default: names[0].value });
  const models = code ? [{ value: code, label: `Đúng: ${code}` }] : [];
  models.push({ value: "", label: "Không rõ, để app tự tìm" }, custom);
  cards.push({ id: "model", title: "Mã / model", question: "Sản phẩm có mã hoặc model cụ thể không?", options: uniq(models), default: code || "" });
  const fm = /(\d{4,6})\s*m\s?ah/i.exec(query)?.[1], fv = /\b(\d{1,2})\s*v(?:dc)?\b/i.exec(query)?.[1];
  const mah = [...(fm ? [{ value: fm, label: mahLabel(fm) }] : []), ...["10000", "20000", "30000", "50000"].map((v) => ({ value: v, label: mahLabel(v) })), { value: "", label: "Không quan trọng" }, custom];
  cards.push({ id: "mah", title: "Dung lượng pin", question: "Dung lượng pin cần là bao nhiêu mAh?", options: uniq(mah), default: fm || "" });
  const volt = [...(fv ? [{ value: fv, label: `${fv}V` }] : []), ...["12", "15", "18", "24", "28"].map((v) => ({ value: v, label: `${v}V` })), { value: "", label: "Không quan trọng" }, custom];
  cards.push({ id: "volt", title: "Điện áp", question: "Điện áp cần là bao nhiêu volt?", options: uniq(volt), default: fv || "" });
  const qty = [{ value: String(quantity), label: `${quantity} cái` }, ...[1, 10, 50, 100, 150].map((q) => ({ value: String(q), label: `${q} cái` })), custom];
  cards.push({ id: "quantity", title: "Số lượng", question: "Bạn cần mua bao nhiêu cái?", options: uniq(qty), default: String(quantity) });
  const purposes = [...(purpose ? [{ value: purpose, label: `Đúng: ${purpose}` }] : []),
    ...["Công nhân làm ngoài trời (8 giờ trở lên mỗi ngày)", "Đi xe máy hoặc làm việc văn phòng", "Làm việc nặng, công trình xây dựng"].map((p) => ({ value: p, label: p })),
    { value: "", label: "Chưa xác định" }, custom];
  cards.push({ id: "purpose", title: "Mục đích sử dụng", question: "Sản phẩm dùng cho mục đích gì?", options: uniq(purposes), default: purpose || "" });
  if (ocrText) cards.push({ id: "ocr", title: "Chữ đọc được trong ảnh", question: `Thêm chữ này vào từ khóa tìm kiếm? "${ocrText.slice(0, 120)}"`,
    options: [{ value: "use", label: "Có, thêm vào từ khóa" }, { value: "skip", label: "Không, bỏ qua" }], default: "use" });
  return cards;
}
/** Áp câu trả lời card vào job. Ném Error nếu không hợp lệ. */
export function applyAnswers(job, answers) {
  const val = (id) => { const a = answers[id] || {}; return a.value === CUSTOM ? String(a.custom || "").trim() : String(a.value ?? "").trim(); };
  const product = val("product"); if (!product) throw new Error("Nhập tên sản phẩm");
  const qty = val("quantity"); if (!/^\d+$/.test(qty) || +qty < 1) throw new Error("Số lượng phải là số nguyên dương");
  const mah = val("mah"), volt = val("volt");
  if (mah && !/^\d+$/.test(mah)) throw new Error("Dung lượng pin chỉ nhập số, ví dụ 20000");
  if (volt && !/^\d+$/.test(volt)) throw new Error("Điện áp chỉ nhập số, ví dụ 18");
  Object.assign(job, { query: product, product_code: val("model"), quantity: +qty, purpose: val("purpose"), spec: { mah, volt }, use_ocr: val("ocr") === "use", answers });
  return job;
}
export function specText(spec) {
  const p = []; if (spec?.mah) p.push(`${Number(spec.mah).toLocaleString("vi-VN")} mAh`); if (spec?.volt) p.push(`${spec.volt}V`);
  return p.join(", ") || "Không yêu cầu";
}
export function searchKeywords(job) {
  const q = job.query.trim(), parts = [q], { mah, volt } = job.spec || {};
  if (mah && !new RegExp(`\\b${mah}\\s*mah\\b`, "i").test(q)) parts.push(`${mah}mAh`);
  if (volt && !new RegExp(`\\b${volt}\\s*v`, "i").test(q)) parts.push(`${volt}V`);
  if (job.use_ocr && job.ocr_text) parts.push(job.ocr_text.slice(0, 80));
  if (job.extra_keywords) parts.push(job.extra_keywords.trim());
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ sửa ô bảng */
export const EDIT_LABELS = { name: "NCC", price: "Đơn giá", warranty_months: "Bảo hành (tháng)", vat: "Hóa đơn VAT", mah: "Dung lượng pin (mAh)", volt: "Điện áp (V)", date: "Ngày cập nhật web", note: "Ghi chú" };
export function parseField(field, value) {
  const text = value == null ? "" : String(value).trim();
  if (!(field in EDIT_LABELS)) throw new Error("Trường không được phép sửa");
  if (field === "name") { if (!text) throw new Error("Tên NCC không được để trống"); return text.slice(0, 120); }
  if (field === "note") return text.slice(0, 500);
  if (field === "vat") {
    const l = text.toLowerCase();
    if (["có", "co", "true", "yes"].includes(l)) return true;
    if (["không", "khong", "false", "no"].includes(l)) return false;
    if (["", "chưa rõ", "chua ro", "null", "unknown"].includes(l)) return null;
    throw new Error("VAT chỉ nhận Có, Không hoặc Chưa rõ");
  }
  if (field === "date") {
    if (!text) return null;
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text), y, mo, d;
    if (m) [d, mo, y] = [+m[1], +m[2], +m[3]]; else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text))) [y, mo, d] = [+m[1], +m[2], +m[3]];
    else throw new Error("Ngày nhập theo dạng dd/mm/yyyy");
    const dt = new Date(y, mo - 1, d); if (dt.getMonth() !== mo - 1) throw new Error("Ngày không hợp lệ");
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const digits = text.replace(/[.,\s]/g, ""); if (!digits) return null;
  if (!/^\d+$/.test(digits)) throw new Error(`${EDIT_LABELS[field]} chỉ nhập số`);
  const n = +digits, lim = { price: [1, 1e9], warranty_months: [0, 240], mah: [1, 1e6], volt: [1, 1000] }[field];
  if (n < lim[0] || n > lim[1]) throw new Error(`${EDIT_LABELS[field]} phải trong khoảng ${lim[0]} đến ${lim[1]}`);
  return n;
}

/* ------------------------------------------------------------------ lịch sử gộp theo sản phẩm */
export function groupHistory(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    if (!["done", "error", "running", "queued"].includes(job.status) || !job.query) continue;
    const k = normKey(job.query); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(job);
  }
  const result = [];
  for (const [key, items] of groups) {
    items.sort((a, b) => (a.created || "").localeCompare(b.created || ""));
    const keywords = [], engines = new Set(), sites = new Map(), sup = new Map(), rec = new Map(), prices = [], jobMeans = [];
    for (const j of items) {
      for (const w of [j.keywords, ...Object.values(j.research || {}).map((r) => r.query)]) if (w && !keywords.includes(w)) keywords.push(w);
      (j.engines || []).forEach((e) => engines.add(e));
      for (const u of new Set([...(j.sites_searched || []), ...j.suppliers.map((s) => s.url)])) { const d = domainOf(u); sites.set(d, (sites.get(d) || 0) + 1); }
      const jp = j.suppliers.filter((s) => s.price).map((s) => s.price); prices.push(...jp); if (jp.length) jobMeans.push(mean(jp));
      for (const s of j.suppliers) {
        const st = sup.get(s.name) || { name: s.name, times: 0, min_price: null, last_price: null, url: s.url };
        st.times++; if (s.price) { st.last_price = s.price; st.min_price = st.min_price === null ? s.price : Math.min(st.min_price, s.price); }
        sup.set(s.name, st); if (s.recommended) rec.set(s.name, (rec.get(s.name) || 0) + 1);
      }
    }
    result.push({
      key, name: items.at(-1).query, searches: items.length, keywords,
      sites: [...sites].sort((a, b) => b[1] - a[1]).map(([domain, visits]) => ({ domain, visits })),
      suppliers: [...sup.values()].sort((a, b) => b.times - a.times), supplier_count: sup.size,
      avg_price: prices.length ? Math.round(mean(prices)) : null, median_price: prices.length ? Math.round(median(prices)) : null,
      min_price: prices.length ? Math.min(...prices) : null, max_price: prices.length ? Math.max(...prices) : null,
      price_change_pct: jobMeans.length >= 2 && jobMeans[0] ? Math.round((jobMeans.at(-1) - jobMeans[0]) / jobMeans[0] * 1000) / 10 : null,
      first_search: items[0].created || "", last_search: items.at(-1).created || "", engines: [...engines].sort(),
      avg_suppliers_per_search: Math.round(mean(items.map((j) => j.suppliers.length)) * 10) / 10,
      total_quantity: items.reduce((a, j) => a + (j.quantity || 0), 0),
      recommended: [...rec].sort((a, b) => b[1] - a[1]).map(([name, times]) => ({ name, times })),
      edit_count: items.reduce((a, j) => a + (j.edits || []).length, 0),
      jobs: [...items].reverse().map((j) => ({ id: j.id, status: j.status, created: j.created || "", quantity: j.quantity })),
    });
  }
  return result.sort((a, b) => b.last_search.localeCompare(a.last_search));
}
export function priceComparison(suppliers) {
  const priced = suppliers.filter((s) => s.price); if (!priced.length) return [];
  const low = Math.min(...priced.map((s) => s.price));
  return priced.map((s) => ({ name: s.name, price: s.price, ratio: Math.round(s.price / low * 1000) / 10, recommended: !!s.recommended })).sort((a, b) => a.price - b.price);
}
