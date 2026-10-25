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
const PRICE_MIN = 50_000, PRICE_MAX = 200_000_000;
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

/* ------------------------------------------------------------------ giá bán của trang */
export const PRICE_SOURCES = {
  jsonld: "đọc từ dữ liệu có cấu trúc của trang (JSON-LD)", meta: "đọc từ thẻ giá của trang", itemprop: "đọc từ thẻ giá của trang",
  label: "đọc từ chữ đứng sau từ \"giá\" trên trang", text: "đoán từ chữ trên trang, có thể là giá phụ kiện hoặc khuyến mãi", snippet: "lấy từ đoạn mô tả trong kết quả tìm kiếm, chưa mở trang",
};
const CONFIDENT = new Set(["jsonld", "meta", "itemprop", "label"]);
export const isConfidentPrice = (source) => CONFIDENT.has(source);
/** "1.190.000", "1,190,000", "1190000.00", 1190000 -> số nguyên đồng. Không đọc được thì NaN. */
export function parsePriceNumber(v) {
  if (typeof v === "number") return Math.round(v);
  const s = String(v ?? "").trim();
  if (/^\d+(\.\d{1,2})?$/.test(s)) return Math.round(+s);
  const d = s.replace(/[^\d]/g, ""); return d ? +d : NaN;
}
function jsonLdPrices(html) {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    for (const o of [].concat(n.offers || [])) {
      if (!o || typeof o !== "object") continue;
      if (o.priceCurrency && String(o.priceCurrency).toUpperCase() !== "VND") continue;
      for (const k of ["price", "lowPrice"]) if (o[k] != null) { const p = parsePriceNumber(o[k]); if (p >= 1000) out.push(p); }
    }
    for (const v of Object.values(n)) if (v && typeof v === "object") walk(v);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1].trim())); } catch { /* bỏ qua khối lỗi */ } }
  return out;
}
/**
 * Giá bán của một trang, theo thứ tự tin cậy: dữ liệu có cấu trúc (JSON-LD, thẻ meta, itemprop) -> số đứng ngay sau chữ "giá"
 * -> số xuất hiện nhiều nhất trên trang. Không lấy số nhỏ nhất vì đó thường là voucher, phí vận chuyển hoặc phụ kiện.
 * pseudo = true (đoạn mô tả kết quả tìm kiếm): chỉ nhận số đứng sau chữ "giá", nguồn "snippet".
 * Trả về { value, source } hoặc { value: null, source: null }.
 */
export function extractPrice(html, text, tags = null, pseudo = false) {
  const inRange = (p) => Number.isFinite(p) && p >= PRICE_MIN && p <= PRICE_MAX;
  if (!pseudo) {
    const ld = jsonLdPrices(html).filter(inRange); if (ld.length) return { value: ld[0], source: "jsonld" };
    const t = tags || metaTags(html);
    const metaVal = parsePriceNumber(metaContent(t, "product:price:amount", "og:price:amount", "product:price"));
    if (inRange(metaVal)) return { value: metaVal, source: "meta" };
    for (const m of html.matchAll(/<[^>]*itemprop=["']price["'][^>]*>/gi)) {
      const c = /content=["']([^"']+)["']/i.exec(m[0]); const p = c ? parsePriceNumber(c[1]) : NaN; if (inRange(p)) return { value: p, source: "itemprop" };
    }
  }
  const labelled = [...text.matchAll(/giá[^0-9]{0,30}?(\d{1,3}(?:[.,]\d{3})+)\s*(?:đ|₫|vnđ|vnd)/gi)].map((m) => toInt(m[1])).filter(inRange);
  if (labelled.length) return { value: labelled[0], source: pseudo ? "snippet" : "label" };
  if (pseudo) return { value: null, source: null };
  const all = [...text.matchAll(/(\d{1,3}(?:[.,]\d{3})+)\s*(?:đ|₫|vnđ|vnd)/gi)].map((m) => toInt(m[1])).filter(inRange);
  if (!all.length) return { value: null, source: null };
  const freq = new Map(); all.forEach((p) => freq.set(p, (freq.get(p) || 0) + 1));
  const best = [...freq.entries()].sort((a, b) => b[1] - a[1] || all.indexOf(a[0]) - all.indexOf(b[0]))[0][0];
  return { value: best, source: "text" };
}

/* ------------------------------------------------------------------ nhận diện trang sản phẩm, hãng, model từ dữ liệu của trang */
/** Các sản phẩm khai báo trong JSON-LD của trang: { name, brand, model }. */
export function jsonLdProducts(html) {
  const out = [];
  const isProduct = (t) => [].concat(t || []).some((x) => /^(Product|ProductGroup|IndividualProduct)$/i.test(String(x)));
  const str = (v) => (typeof v === "string" ? v.trim() : v && typeof v === "object" && typeof v.name === "string" ? v.name.trim() : "");
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    if (isProduct(n["@type"])) out.push({ name: str(n.name), brand: str(n.brand), model: str(n.model) || str(n.mpn) || str(n.sku) });
    for (const v of Object.values(n)) if (v && typeof v === "object") walk(v);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1].trim())); } catch { /* bỏ qua khối lỗi */ } }
  return out;
}
/** Tên cửa hàng/website (không phải tên hãng sản phẩm): og:site_name, nếu không có thì tên miền. */
export function siteNameOf(html, url, tags = null) {
  const t = tags || metaTags(html);
  const og = metaContent(t, "og:site_name", "application-name");
  if (og) return og.slice(0, 60);
  const title = ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [, ""])[1]).replace(/\s+/g, " ").trim(), tail = title.split(/\s[|\-–—]\s/).pop().trim();
  if (title.includes(tail) && tail !== title && tail.length >= 2 && tail.length <= 30) return tail; // "... | FPT Shop" -> "FPT Shop"
  const d = domainOf(url).split(".")[0] || domainOf(url);
  return d ? d.charAt(0).toUpperCase() + d.slice(1) : "NCC";
}
/** Từ khóa thuộc tên website/cửa hàng (để không nhầm tên website, NCC là hãng sản xuất). */
export function siteTokensOf(html, url) {
  const set = new Set();
  const add = (s) => String(s).split(/[^\p{L}0-9]+/u).filter((w) => w.length >= 3).forEach((w) => set.add(stripAccents(w).toUpperCase()));
  const label = domainOf(url).split(".").slice(0, -1).join("").replace(/[^a-z0-9]/gi, "").toUpperCase();
  add(domainOf(url).split(".").slice(0, -1).join(" ")); add(siteNameOf(html, url));
  for (let n = 3; n < label.length; n++) set.add(label.slice(0, n)); // "FPT", "FPTS"... là tiền tố của tên miền fptshop
  const parts = ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [, ""])[1]).split(/\s[|\-–—]\s/);
  if (parts.length > 1) { const tail = parts[parts.length - 1].trim(); add(tail); if (tail.length >= 2 && tail.length <= 4) set.add(stripAccents(tail).toUpperCase()); } // đoạn cuối tiêu đề thường là tên cửa hàng (kể cả tên ngắn như "HC")
  return set;
}
/** Trang có phải trang bán MỘT sản phẩm (không phải trang danh mục, bài viết) không. */
export function isProductPage(html, text, tags, price) {
  if (jsonLdProducts(html).length) return true;
  if (/^(og:)?product$/i.test(metaContent(tags || metaTags(html), "og:type"))) return true;
  if (metaContent(tags || metaTags(html), "product:price:amount", "og:price:amount")) return true;
  return !!(price && price.source === "label" && /thêm vào giỏ|mua ngay|add to cart|đặt hàng ngay|chọn mua/i.test(text));
}

/** Đọc HTML một trang NCC. Trả về null nếu không đúng sản phẩm. */
export function parsePage(html, url, tokens, productCode = "") {
  const tags = metaTags(html);
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [, ""])[1].replace(/\s+/g, " ").trim();
  const text = htmlToText(html);
  const norm = stripAccents(text);
  let relevance = phraseRelevance(tokens, norm);
  const modelOk = !productCode || new RegExp(`\\b${stripAccents(productCode).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(norm);
  if (productCode) relevance = Math.min(relevance, modelOk ? 1 : 0.5);
  if (relevance === 0) return null;

  const found = extractPrice(html, text, tags);
  const mah = [...text.matchAll(/(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\s*m\s?ah/gi)].map((m) => toInt(m[1]));
  const volt = /\b(\d{1,2})\s*V(?:DC)?\b/.exec(text);
  const war = /bảo\s*hành[^.\n]{0,25}?(\d{1,2})\s*(tháng|năm)/i.exec(text);
  let vat = null;
  if (/không\s*(xuất\s*)?hóa\s*đơn/i.test(text)) vat = false;
  if (/hóa\s*đơn\s*(vat|gtgt)|xuất\s*hóa\s*đơn|có\s*hóa\s*đơn/i.test(text)) vat = true;
  const domain = domainOf(url);
  return {
    name: siteNameOf(html, url, tags), site_url: (() => { try { return new URL(url).origin; } catch { return ""; } })(), model_ok: modelOk, is_product: isProductPage(html, text, tags, found),
    title: (title || domain).slice(0, 120), product_name: cleanTitle(title || domain), url, description: metaContent(tags, "og:description", "description").slice(0, 240),
    date: pageDate(html, tags, text), price: found.value, price_source: found.source, vat,
    vat_included: /đã\s*(bao\s*gồm\s*|gồm\s*)?vat/i.test(text), mah: mah[0] ?? null, volt: volt ? +volt[1] : null,
    warranty_months: war ? +war[1] * (war[2].toLowerCase() === "năm" ? 12 : 1) : null,
    specs: SPEC_DEFS.map((d) => { const m = new RegExp(d.re.source, d.re.flags).exec(text); return m ? `${d.label}: ${numStr(m[1])} ${d.unit}` : null; }).filter(Boolean).slice(0, 4),
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
/** Chấm điểm NCC. Sản phẩm có pin: so giá trên 1.000 mAh; sản phẩm khác: so đơn giá trực tiếp. budget: giá tối đa mỗi cái (nếu có). */
export function scoreSuppliers(items, requireVat = true, budget = null) {
  const byMah = items.some((i) => i.price && i.mah);
  const ppk = (i) => (i.price && (byMah ? i.mah : true) ? i.price / (byMah ? i.mah / 1000 : 1) : null);
  const ppks = items.map(ppk).filter(Boolean);
  const best = ppks.length ? Math.min(...ppks) : null;
  const scored = items.map((item) => {
    const row = { ...item }; for (const k of ["recommended", "eligible", "reason", "score", "over_budget"]) delete row[k];
    row.eligible = true; row.reason = ""; row.over_budget = !!(budget && item.price && item.price > budget);
    if (requireVat && item.vat === false) return Object.assign(row, { eligible: false, reason: "Không có hóa đơn VAT", score: 0 });
    const p = ppk(item);
    const priceScore = p && best ? best / p : 0.5;
    const vatScore = item.vat === true ? 1 : item.vat === null || item.vat === undefined ? 0.5 : 0;
    row.score = Math.round((WEIGHTS.price * priceScore + WEIGHTS.warranty * Math.min(item.warranty_months || 0, 12) / 12 +
      WEIGHTS.vat * vatScore + WEIGHTS.relevance * (item.relevance ?? 1)) * 1000) / 1000;
    return row;
  });
  const eligible = scored.filter((r) => r.eligible && r.price); // chỉ đề xuất NCC có giá đọc chắc chắn từ trang
  if (eligible.length) { const b = eligible.reduce((a, c) => (c.score > a.score ? c : a)); b.recommended = true; b.reason = "Khuyến nghị: điểm cao nhất"; }
  scored.forEach((r) => { r.recommended = !!r.recommended; });
  return scored.sort((a, b) => (a.eligible === b.eligible ? (b.score || 0) - (a.score || 0) : a.eligible ? -1 : 1));
}
/** Thông tin sản phẩm của một NCC dạng chữ ngắn: pin, điện áp, bảo hành. Ghi chú để riêng. */
export function supplierInfo(s) {
  const p = [];
  if (s.mah) p.push(`Pin ${Number(s.mah).toLocaleString("vi-VN")} mAh`);
  if (s.volt) p.push(`${s.volt}V`);
  for (const x of s.specs || []) p.push(x); // thông số kỹ thuật đọc từ trang: công suất, dung tích...
  p.push(s.warranty_months ? `Bảo hành ${s.warranty_months} tháng` : "Bảo hành chưa rõ");
  return p.join(" · ");
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

/* ------------------------------------------------------------------ nhóm ngành hàng */
export const CATEGORIES = {
  gia_dung: { label: "Gia dụng", words: ["quat", "noi", "may giat", "tu lanh", "dieu hoa", "bep", "lo vi song", "lo nuong", "may hut bui", "may loc", "binh nuoc nong", "may xay", "am dun", "ban ui", "may say", "robot hut bui", "noi chien", "may loc nuoc", "may loc khong khi", "den ban", "quat dieu hoa", "may lam mat"] },
  may_moc: { label: "Thiết bị, máy móc, vật tư công nghiệp", words: ["may khoan", "may cat", "may nen khi", "may han", "may bom", "dong co", "bang tai", "xe nang", "may phat dien", "may tien", "cnc", "may phay", "may mai", "may cua", "may nghien", "may do", "bao ho", "bao ho lao dong", "giay bao ho", "gang tay bao ho", "mu bao ho", "van", "bom", "may cong cu", "may phun ap luc", "may bao"] },
  tieu_dung: { label: "Sản phẩm tiêu dùng", words: ["ao", "quan", "giay", "dep", "dien thoai", "laptop", "may tinh", "tai nghe", "my pham", "dong ho", "balo", "tui", "sach", "do choi", "kem", "sua", "nuoc hoa", "kinh", "ao khoac", "may anh", "ban phim", "chuot", "loa", "sac du phong", "op lung"] },
  chung: { label: "Sản phẩm khác", words: [] },
};
/** Nhóm ngành theo cụm từ khớp dài nhất trong tên sản phẩm (VD "áo điều hòa" thuộc gia dụng vì "điều hòa" dài hơn "áo"). */
export function detectCategory(text) {
  const norm = " " + stripAccents(String(text)).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ") + " ";
  let best = "chung", bestLen = 0;
  for (const [id, c] of Object.entries(CATEGORIES)) for (const w of c.words) if (w.length > bestLen && norm.includes(` ${w} `)) { best = id; bestLen = w.length; }
  return best;
}

/* ------------------------------------------------------------------ tìm hiểu sản phẩm từ các trang web đã đọc */
const MAH_RE = /(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\s*m\s?ah/gi;
const PURPOSE_RE = /(?:dùng cho|phù hợp (?:cho|với)|dành cho|thích hợp (?:cho|với))\s+([^.,;:()\n|]{8,80})/gi;
const UNIT_TOKEN = /^\d+[A-Z]{0,3}$/; // 18V, 20000MAH, 5W... không phải model
const BRAND_STOP = new Set(["VAT", "LED", "USB", "MAH", "NEW", "HOT", "PRO", "MAX", "MINI", "SALE", "SHOP", "COMBO", "FREESHIP", "CHINH", "HANG", "GIA", "RE", "TOT", "GIAO", "NHANH", "SIZE", "SET", "CAO", "CAP", "VIET", "NAM", "LOAI", "CHAT", "LUONG", "QUA", "TANG", "BAO", "HANH", "THANG", "ONLINE", "OFFICIAL", "STORE", "LIVE", "DEAL", "TOP", "BEST"]);
const SPEC_DEFS = [
  { id: "power", label: "Công suất", unit: "W", re: /(\d{1,5}(?:[.,]\d+)?)\s*(?:W|watt)\b/g },
  { id: "hp", label: "Công suất động cơ", unit: "HP", re: /(\d{1,3}(?:[.,]\d)?)\s*HP\b/g },
  { id: "capacity", label: "Dung tích", unit: "lít", re: /(\d{1,4}(?:[.,]\d+)?)\s*(?:lít|L)\b/g },
  { id: "weight", label: "Khối lượng / tải trọng", unit: "kg", re: /(\d{1,5}(?:[.,]\d+)?)\s*kg\b/gi },
  { id: "screen", label: "Kích thước màn hình", unit: "inch", re: /(\d{1,2}(?:[.,]\d)?)\s*(?:inch|")/gi },
  { id: "storage", label: "Bộ nhớ", unit: "GB", re: /(\d{1,4})\s*GB\b/g },
];
const MATERIALS = ["cotton", "polyester", "inox", "nhôm", "thép", "nhựa", "da", "gỗ", "vải", "kaki", "lưới", "thủy tinh", "sứ", "silicon", "cao su"];

/** Các mã model trong một tiêu đề: token in hoa có cả chữ lẫn số (F20, SQ331), bỏ đơn vị như 18V. */
export function titleModels(title) {
  const out = [];
  for (const m of String(title).matchAll(/\b(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{2,14}\b/g)) if (!UNIT_TOKEN.test(m[0])) out.push(m[0]);
  return out;
}
const cleanTitle = (t) => String(t).split(/\s[|\-–—]\s/)[0].replace(/\s+/g, " ").trim().slice(0, 80);
/** Hãng nhắc trong tiêu đề (từ IN HOA như YAMAKO) và trong câu "thương hiệu X", "hãng X". */
export function brandsIn(title, text, queryTokens = [], siteTokens = new Set()) {
  const skip = new Set([...queryTokens.map((t) => t.toUpperCase()), ...siteTokens]); // bỏ từ khóa tìm kiếm và tên website/cửa hàng
  const found = new Set();
  // Token IN HOA đứng ngay trước chữ số hoặc "-số" là một phần của model (VCE-9304), không phải hãng.
  for (const m of String(title).matchAll(/\b\p{Lu}{3,12}\b(?![-\s]?\d)/gu)) { const k = stripAccents(m[0]).toUpperCase(); if (!BRAND_STOP.has(k) && !skip.has(k) && !/\d/.test(m[0])) found.add(m[0]); }
  for (const m of String(text).slice(0, 30000).matchAll(/(?:thương hiệu|hãng|nhãn hiệu|nhà sản xuất)\s*:?\s+(\p{Lu}[\p{L}0-9&-]{1,18})/gu)) { const k = stripAccents(m[1]).toUpperCase(); if (!BRAND_STOP.has(k) && !skip.has(k)) found.add(m[1]); }
  return [...found];
}
const medianOf = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const numStr = (v) => String(+String(v).replace(",", ".")).replace(/^0+(?=\d)/, "");

/**
 * Rút thông tin sản phẩm từ nhiều trang đã tải: nhóm ngành, tên, model, hãng, thông số, mục đích, bảo hành, giá.
 * pages: [{ url, html }]. Chỉ dùng trang đúng sản phẩm (cụm 2 từ liên tiếp). Mỗi giá trị kèm số trang nhắc tới.
 */
export function buildDiscovery(pages, queryTokens, subject = "") {
  const used = [];
  for (const p of pages) {
    if (!p || !p.html) continue;
    const text = htmlToText(p.html);
    const rel = phraseRelevance(queryTokens, stripAccents(text));
    if (rel < 0.5) continue;
    const title = ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(p.html) || [, ""])[1]).replace(/\s+/g, " ").trim();
    used.push({ url: p.url, domain: domainOf(p.url), title, text, rel, html: p.html, pseudo: !!p.pseudo, site: siteTokensOf(p.html, p.url), ld: p.pseudo ? [] : jsonLdProducts(p.html) });
  }
  const tally = (extract, keyFn = (v) => normKey(String(v))) => {
    const map = new Map();
    for (const u of used) {
      const seenHere = new Set();
      for (const v of extract(u)) {
        const key = keyFn(v); if (!key || seenHere.has(key)) continue; seenHere.add(key);
        const e = map.get(key) || { value: String(v), count: 0 }; e.count++; map.set(key, e);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  };
  const mah = tally((u) => [...u.text.matchAll(MAH_RE)].map((m) => toInt(m[1])).filter((v) => v >= 1000 && v <= 100000));
  const volt = tally((u) => [...u.text.matchAll(/\b(\d{1,2})\s*V(?:DC)?\b/g)].map((m) => +m[1]).filter((v) => v >= 3 && v <= 48));
  // Model và hãng: ưu tiên dữ liệu sản phẩm khai báo trong trang (JSON-LD), sau đó mới đoán từ tiêu đề; luôn bỏ tên website/NCC.
  const models = tally((u) => [...u.ld.map((p) => p.model).filter((m) => m && m.length <= 24 && /\d/.test(m)), ...titleModels(u.title)]);
  const brands = tally((u) => [...u.ld.map((p) => p.brand).filter((b) => b && !u.site.has(stripAccents(b).toUpperCase())), ...brandsIn(u.title, u.text, queryTokens, u.site)], (v) => stripAccents(v));
  const purposes = tally((u) => [...u.text.slice(0, 20000).matchAll(PURPOSE_RE)].map((m) => m[1].trim()));
  const warranty = tally((u) => { const m = /bảo\s*hành[^.\n]{0,25}?(\d{1,2})\s*(tháng|năm)/i.exec(u.text); return m ? [+m[1] * (m[2].toLowerCase() === "năm" ? 12 : 1)] : []; });
  const specs = SPEC_DEFS.map((d) => ({ id: d.id, label: d.label, unit: d.unit, values: tally((u) => [...u.text.matchAll(d.re)].map((m) => numStr(m[1])).filter((v) => +v > 0), (v) => v).slice(0, 4) })).filter((s) => s.values.length && s.values[0].count >= 2);
  const materials = tally((u) => { const n = " " + stripAccents(u.text) + " "; return MATERIALS.filter((w) => n.includes(` ${stripAccents(w)} `)); }, (v) => stripAccents(v)).filter((e) => e.count >= 2).slice(0, 4);
  const names = [...new Map(used.slice().sort((a, b) => b.rel - a.rel).map((u) => [normKey(cleanTitle(u.title)), cleanTitle(u.title)]).filter(([k]) => k.length >= 6)).values()].slice(0, 3);
  // Giá: mỗi trang một giá (ưu tiên dữ liệu có cấu trúc), loại giá lệch hẳn mặt bằng (thường là phụ kiện, voucher, giá sai).
  const priced = used.map((u) => ({ u, ...extractPrice(u.html, u.text, null, u.pseudo) }));
  const withValue = priced.filter((x) => x.value), sure = withValue.filter((x) => isConfidentPrice(x.source));
  const base = sure.length >= 3 ? sure : withValue;
  const med = medianOf(base.map((x) => x.value));
  const flagOf = (x) => (!x.value || base.length < 4 ? null : x.value < med * 0.3 ? "low" : x.value > med * 3.5 ? "high" : null);
  const items = priced.map((x) => ({ url: x.u.url, domain: x.u.domain, title: x.u.title.slice(0, 100), price: x.value, price_source: x.source, price_flag: flagOf(x) }));
  const prices = priced.filter((x) => x.value && !flagOf(x) && base.includes(x)).map((x) => x.value);
  return {
    subject, category: detectCategory(subject || queryTokens.join(" ")),
    read: pages.filter((p) => p && p.html).length, total: used.length,
    pages: items.slice(0, 40).map(({ url, domain, title }) => ({ url, domain, title })), items: items.slice(0, 150),
    names, models: models.slice(0, 4), brands: brands.slice(0, 6), mah: mah.slice(0, 4), volt: volt.slice(0, 4), purposes: purposes.slice(0, 3),
    warranty: warranty.slice(0, 3), specs, materials,
    price: prices.length ? { min: Math.min(...prices), max: Math.max(...prices), median: medianOf(prices), count: prices.length, confident: sure.length, outliers: items.filter((i) => i.price_flag).length, sorted: [...prices].sort((a, b) => a - b) } : null,
  };
}

/* ------------------------------------------------------------------ question card (5 đến 10 câu, dựng từ dữ liệu crawl) */
const uniq = (opts) => { const seen = new Set(); return opts.filter((o) => (seen.has(o.value) ? false : seen.add(o.value))); };
const mahLabel = (v) => `${Number(v).toLocaleString("vi-VN")} mAh`;
const vnd = (v) => `${Math.round(v).toLocaleString("vi-VN")} đ`;
export const MAX_CARDS = 10;
/**
 * Dựng card. Bốn card luôn có: tên sản phẩm, mã/model, số lượng, mục đích. Các card còn lại (tối đa 6) được chọn từ
 * dữ liệu crawl theo độ nhiều bằng chứng: thông số xuất hiện ở nhiều trang, hãng, ngân sách, bảo hành, chất liệu...
 * Mỗi lựa chọn kèm "thấy ở n/N trang". Không có dữ liệu web thì dùng gợi ý chung và ghi rõ.
 */
export function buildCards(req, suggestedName = null, ocrText = "", discovery = null) {
  const query = (req.query || "").trim(), code = (req.product_code || "").trim(), purpose = (req.purpose || "").trim();
  const quantity = req.quantity || 1, custom = { value: CUSTOM, label: "Khác (nhập bên dưới)" };
  const total = discovery ? discovery.total : 0, d = total ? discovery : null;
  const web = (list, fmt = (v) => v) => (d ? list.map((e) => ({ value: String(e.value), label: `${fmt(e.value)} (thấy ở ${e.count}/${total} trang)`, count: e.count })) : []);
  const evidence = (list) => (list.length ? `Gợi ý lấy từ ${total} trang web đã đọc.` : total ? "Các trang đã đọc không nêu rõ mục này, đây là gợi ý chung." : "Chưa đọc được trang web nào, đây là gợi ý chung.");
  const none = (label) => ({ value: "", label });

  const names = [];
  if (query) names.push({ value: query, label: `Đúng: ${query}` });
  if (suggestedName && suggestedName.toLowerCase() !== query.toLowerCase()) names.push({ value: suggestedName, label: `Theo ảnh: ${suggestedName}` });
  if (d) for (const n of d.names) names.push({ value: n, label: `Theo web: ${n}` });
  if (!names.length && code) names.push({ value: code, label: `Dùng mã: ${code}` });
  names.push(custom);
  const webModels = web(d ? d.models : []);
  const models = [...(code ? [{ value: code, label: `Đúng: ${code}` }] : []), ...webModels, none("Không rõ, để app tự tìm"), custom];
  const webPurposes = web(d ? d.purposes : []);
  const webBrands = web(d ? d.brands.filter((b) => b.count >= 2 || d.total <= 2) : []);
  const purposeOpts = webPurposes.length ? webPurposes : ["Dùng cho công việc, sản xuất", "Dùng trong gia đình, văn phòng", "Làm quà tặng, kinh doanh lại"].map((p) => ({ value: p, label: p }));
  const qty = [{ value: String(quantity), label: `${quantity} cái` }, ...[1, 10, 50, 100, 150].map((q) => ({ value: String(q), label: `${q} cái` })), custom];

  const required = [
    { id: "product", title: "Tên sản phẩm", question: "Sản phẩm bạn cần mua có đúng là như này không?", options: uniq(names), default: names[0].value, evidence: d ? `Có thêm tên gọi lấy từ ${total} trang web đã đọc.` : "" },
    { id: "model", title: "Mã sản phẩm / model", question: "Sản phẩm có mã hoặc model cụ thể không?", options: uniq(models), default: code || "", evidence: evidence(webModels), required: true },
    { id: "quantity", title: "Số lượng", question: "Bạn cần mua bao nhiêu cái?", options: uniq(qty), default: String(quantity), evidence: "", required: true },
    { id: "purpose", title: "Mục đích sử dụng", question: "Sản phẩm dùng cho mục đích gì?", options: uniq([...(purpose ? [{ value: purpose, label: `Đúng: ${purpose}` }] : []), ...purposeOpts, none("Chưa xác định"), custom]), default: purpose || "", evidence: evidence(webPurposes), required: true },
    // Hãng sản xuất = tên hãng ghi trên sản phẩm (từ dữ liệu sản phẩm hoặc tiêu đề), không phải tên website hay NCC.
    { id: "brand", kind: "brand", title: "Hãng sản xuất", question: "Sản phẩm của hãng nào? (tên hãng trên sản phẩm, không phải tên cửa hàng)", options: uniq([...(req.brand ? [{ value: req.brand, label: `Đúng: ${req.brand}` }] : []), ...webBrands, none("Không rõ / không ưu tiên hãng"), custom]), default: req.brand || (webBrands[0] && webBrands[0].count >= 2 ? webBrands[0].value : ""), evidence: evidence(webBrands), required: true },
  ];

  // Card bổ sung: mỗi ứng viên có điểm = độ nhiều bằng chứng; lấy tối đa (MAX_CARDS - 4) card điểm cao nhất.
  const extras = [];
  const specCard = (id, kind, title, question, list, fmt, fixed, meta = {}) => {
    const opts = web(list, fmt);
    if (fixed && !opts.some((o) => o.value === fixed)) opts.unshift({ value: fixed, label: `${fmt(fixed)} (theo tên bạn nhập)`, count: 1 });
    const top = opts[0];
    if (!top || (top.count < 2 && !fixed)) return;
    extras.push({ score: top.count * 10 + (fixed ? 50 : 5), card: { id, kind, title, question, options: uniq([...opts, none("Không quan trọng"), custom]), default: fixed || "", evidence: evidence(opts), ...meta } });
  };
  const fm = /(\d{4,6})\s*m\s?ah/i.exec(query)?.[1], fv = /\b(\d{1,2})\s*v(?:dc)?\b/i.exec(query)?.[1];
  const pickDefault = (list, fixed) => fixed || (list[0] && list[0].count >= 2 ? String(list[0].value) : "");
  specCard("mah", "mah", "Dung lượng pin", "Dung lượng pin cần là bao nhiêu mAh?", d ? d.mah : [], mahLabel, pickDefault(d ? d.mah : [], fm));
  specCard("volt", "volt", "Điện áp", "Điện áp cần là bao nhiêu volt?", d ? d.volt : [], (v) => `${v}V`, pickDefault(d ? d.volt : [], fv));
  if (d) {
    for (const s of d.specs) specCard(`spec_${s.id}`, "spec", s.label, `${s.label} cần là bao nhiêu (${s.unit})?`, s.values, (v) => `${v} ${s.unit}`, s.values[0].count >= 2 ? s.values[0].value : "", { spec: { id: s.id, label: s.label, unit: s.unit } });
    if (d.materials.length >= 1) extras.push({ score: d.materials[0].count * 8, card: { id: "material", kind: "material", title: "Chất liệu", question: "Bạn muốn chất liệu nào?", options: uniq([...web(d.materials), none("Không quan trọng"), custom]), default: "", evidence: evidence(d.materials) } });
    if (d.price && d.price.count >= 3) {
      let levels = [];
      if (d.price && d.price.count >= 3) {
        const sp = d.price.sorted, at = (q) => sp[Math.min(sp.length - 1, Math.floor(q * (sp.length - 1)))];
        levels = [[at(0.25), "rẻ"], [at(0.5), "trung bình"], [at(0.75), "cao"], [sp[sp.length - 1], "cao nhất"]].map(([v, t]) => ({ value: String(Math.round(v)), label: `Tối đa ${vnd(v)} (mức ${t} trên web)` }));
      }
      extras.push({ score: 40, card: { id: "budget", kind: "budget", title: "Ngân sách mỗi sản phẩm", question: d.price ? `Giá trên web từ ${vnd(d.price.min)} đến ${vnd(d.price.max)}. Bạn chấp nhận tối đa bao nhiêu mỗi cái?` : "Bạn chấp nhận tối đa bao nhiêu mỗi cái?", options: uniq([...levels, none("Không giới hạn"), custom]), default: "", evidence: d.price ? `Dựa trên ${d.price.count} mức giá đọc từ ${total} nguồn web.` : "" } });
    }
    if (d.warranty.length) extras.push({ score: d.warranty[0].count * 7, card: { id: "warranty", kind: "warranty", title: "Bảo hành tối thiểu", question: "Bạn cần bảo hành tối thiểu bao lâu?", options: uniq([...web(d.warranty, (v) => `Từ ${v} tháng`), none("Không yêu cầu"), custom]), default: "", evidence: evidence(d.warranty) } });
  }
  if (ocrText) extras.push({ score: 100, card: { id: "ocr", kind: "ocr", title: "Chữ đọc được trong ảnh", question: `Thêm chữ này vào từ khóa tìm kiếm? "${ocrText.slice(0, 120)}"`, options: [{ value: "use", label: "Có, thêm vào từ khóa" }, { value: "skip", label: "Không, bỏ qua" }], default: "use", evidence: "" } });
  extras.push({ score: 20, card: { id: "vat", kind: "vat", title: "Hóa đơn VAT", question: "Có bắt buộc nhà cung cấp xuất hóa đơn VAT không?", options: [{ value: "yes", label: "Bắt buộc có VAT (loại NCC không xuất hóa đơn)" }, { value: "no", label: "Không bắt buộc" }], default: "yes", evidence: "Hóa đơn VAT thường là điều kiện để duyệt chi." } });
  extras.push({ score: 15, card: { id: "priority", kind: "priority", title: "Ưu tiên khi chọn NCC", question: "Bạn ưu tiên điều gì nhất khi chọn nhà cung cấp?", options: [{ value: "balanced", label: "Cân bằng giá, bảo hành, VAT" }, { value: "price", label: "Giá rẻ nhất" }, { value: "warranty", label: "Bảo hành tốt nhất" }, { value: "trust", label: "Chính hãng, uy tín" }], default: "balanced", evidence: "" } });
  // Luôn đủ ít nhất 4 card bổ sung dù web không cho dữ liệu: bổ sung card chung (ghi rõ là gợi ý chung).
  if (!extras.some((e) => e.card.id === "warranty")) extras.push({ score: 12, card: { id: "warranty", kind: "warranty", title: "Bảo hành tối thiểu", question: "Bạn cần bảo hành tối thiểu bao lâu?", options: [...[6, 12, 24, 36].map((m) => ({ value: String(m), label: `Từ ${m} tháng` })), none("Không yêu cầu"), custom], default: "", evidence: "Các trang đã đọc không nêu rõ bảo hành, đây là gợi ý chung." } });
  if (!extras.some((e) => e.card.id === "budget")) extras.push({ score: 10, card: { id: "budget", kind: "budget", title: "Ngân sách mỗi sản phẩm", question: "Bạn chấp nhận tối đa bao nhiêu đồng mỗi cái?", options: [none("Không giới hạn"), custom], default: "", evidence: "Chưa đủ giá trên web để gợi ý mức ngân sách." } });
  const picked = extras.sort((a, b) => b.score - a.score).slice(0, MAX_CARDS - required.length).map((e) => e.card);
  return [...required, ...picked];
}
/** Áp câu trả lời card vào job. Ném Error nếu không hợp lệ. Card bổ sung được nhận ra qua card.kind trong job.questions. */
export function applyAnswers(job, answers) {
  const val = (id) => { const a = answers[id] || {}; return a.value === CUSTOM ? String(a.custom || "").trim() : String(a.value ?? "").trim(); };
  const product = val("product"); if (!product) throw new Error("Nhập tên sản phẩm");
  const qty = val("quantity"); if (!/^\d+$/.test(qty) || +qty < 1) throw new Error("Số lượng phải là số nguyên dương");
  const spec = { mah: "", volt: "", extra: [], brand: "", material: "", budget: null, warranty: null, priority: "balanced", vat_required: true };
  const digits = (id, label, hint) => { const v = val(id); if (v && !/^\d+$/.test(v)) throw new Error(`${label} chỉ nhập số, ví dụ ${hint}`); return v; };
  for (const card of job.questions || []) {
    if (card.kind === "mah") spec.mah = digits(card.id, "Dung lượng pin", "20000");
    else if (card.kind === "volt") spec.volt = digits(card.id, "Điện áp", "18");
    else if (card.kind === "spec") { const v = val(card.id); if (v && !/^\d+([.,]\d+)?$/.test(v)) throw new Error(`${card.title} chỉ nhập số`); if (v) spec.extra.push({ id: card.spec.id, label: card.spec.label, unit: card.spec.unit, value: v.replace(",", ".") }); }
    else if (card.kind === "brand") spec.brand = val(card.id);
    else if (card.kind === "material") spec.material = val(card.id);
    else if (card.kind === "budget") { const v = digits(card.id, "Ngân sách", "1500000"); spec.budget = v ? +v : null; }
    else if (card.kind === "warranty") { const v = digits(card.id, "Bảo hành", "12"); spec.warranty = v ? +v : null; }
    else if (card.kind === "priority") spec.priority = val(card.id) || "balanced";
    else if (card.kind === "vat") spec.vat_required = val(card.id) !== "no";
  }
  const ocr = (job.questions || []).some((c) => c.kind === "ocr") && val("ocr") === "use";
  Object.assign(job, { query: product, product_code: val("model"), quantity: +qty, purpose: val("purpose"), spec, use_ocr: ocr, answers });
  return job;
}
const PRIORITY_LABELS = { price: "ưu tiên giá rẻ nhất", warranty: "ưu tiên bảo hành tốt", trust: "ưu tiên chính hãng, uy tín" };
export function specText(spec) {
  const s = spec || {}, p = [];
  if (s.mah) p.push(`${Number(s.mah).toLocaleString("vi-VN")} mAh`);
  if (s.volt) p.push(`${s.volt}V`);
  for (const e of s.extra || []) p.push(`${e.label} ${e.value} ${e.unit}`);
  if (s.material) p.push(`chất liệu ${s.material}`);
  if (s.brand) p.push(`hãng ${s.brand}`);
  if (s.budget) p.push(`ngân sách tối đa ${vnd(s.budget)}/cái`);
  if (s.warranty) p.push(`bảo hành từ ${s.warranty} tháng`);
  if (PRIORITY_LABELS[s.priority]) p.push(PRIORITY_LABELS[s.priority]);
  if (s.vat_required === false) p.push("không bắt buộc VAT");
  return p.join(", ") || "Không yêu cầu";
}
export function searchKeywords(job) {
  const q = job.query.trim(), parts = [q], s = job.spec || {}, has = (re) => re.test(q);
  if (s.mah && !has(new RegExp(`\\b${s.mah}\\s*mah\\b`, "i"))) parts.push(`${s.mah}mAh`);
  if (s.volt && !has(new RegExp(`\\b${s.volt}\\s*v`, "i"))) parts.push(`${s.volt}V`);
  for (const e of (s.extra || []).slice(0, 2)) if (!q.includes(e.value)) parts.push(`${e.value}${e.unit}`);
  if (s.brand && !stripAccents(q).includes(stripAccents(s.brand))) parts.push(s.brand);
  if (job.use_ocr && job.ocr_text) parts.push(job.ocr_text.slice(0, 80));
  if (job.extra_keywords) parts.push(job.extra_keywords.trim());
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ sửa ô bảng */
export const EDIT_LABELS = { name: "NCC", product_name: "Tên sản phẩm", quantity: "Số lượng", price: "Đơn giá", warranty_months: "Bảo hành (tháng)", vat: "Hóa đơn VAT", mah: "Dung lượng pin (mAh)", volt: "Điện áp (V)", date: "Ngày cập nhật web", note: "Ghi chú" };
export function parseField(field, value) {
  const text = value == null ? "" : String(value).trim();
  if (!(field in EDIT_LABELS)) throw new Error("Trường không được phép sửa");
  if (field === "name") { if (!text) throw new Error("Tên NCC không được để trống"); return text.slice(0, 120); }
  if (field === "product_name") return text.slice(0, 160);
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
  const n = +digits, lim = { quantity: [1, 1e6], price: [1, 1e9], warranty_months: [0, 240], mah: [1, 1e6], volt: [1, 1000] }[field];
  if (n < lim[0] || n > lim[1]) throw new Error(`${EDIT_LABELS[field]} phải trong khoảng ${lim[0]} đến ${lim[1]}`);
  return n;
}

/* ------------------------------------------------------------------ lịch sử gộp theo sản phẩm */
export function groupHistory(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    if (!["done", "error", "stopped", "running", "queued", "awaiting_confirmation"].includes(job.status) || !job.query) continue;
    const k = normKey(job.query); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(job);
  }
  const result = [];
  for (const [key, items] of groups) {
    items.sort((a, b) => (a.created || "").localeCompare(b.created || ""));
    const keywords = [], engines = new Set(), sites = new Map(), sup = new Map(), rec = new Map(), prices = [], jobMeans = [];
    for (const j of items) {
      for (const w of [j.search_text, j.keywords, ...(j.queries || ((j.cfg && j.cfg.extra_q) || [])), ...(j.queries ? [] : Object.values(j.research || {}).map((r) => r.query))]) if (w && !keywords.includes(w)) keywords.push(w);
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
