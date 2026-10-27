// Trích dữ liệu từ HTML một trang sản phẩm: giá, ảnh, ưu điểm, nhược điểm, công nghệ.
// Chỉ dùng regex (Worker không có DOM) và chặn kích thước để tiết kiệm CPU.
import { norm, modelKey, decodeEntities, parseVnd, domainOf, clip, sentenceKey } from "./text.js";
import { extractContacts } from "./contact.js";

const MAX_HTML = 240_000; // giữ CPU thấp (Workers gói Free giới hạn ~10ms CPU mỗi lần gọi)

function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

export function parseMetas(html) {
  const map = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const key = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (key && a.content != null) (map[key] ??= []).push(a.content);
  }
  return map;
}

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function jsonLdProducts(html) {
  const found = [];
  const ids = new Map(); // JSON-LD dạng đồ thị: Product.offers chỉ là {"@id": "...#offer"}, giá nằm ở nút Offer khác cùng @id
  const re = /<script[^>]+type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let raw = m[1].trim().replace(/^<!--/, "").replace(/-->$/, "").replace(/^\/\/<!\[CDATA\[|\/\/\]\]>$/g, "");
    let data;
    try { data = JSON.parse(raw); } catch { continue; }
    walk(data, found, 0);
    indexIds(data, ids, 0);
  }
  const deref = (v) => {
    if (Array.isArray(v)) return v.map(deref);
    if (v && typeof v === "object" && v["@id"] && ids.has(v["@id"])) return { ...ids.get(v["@id"]), ...v };
    return v;
  };
  for (const p of found) for (const k of ["offers", "brand", "aggregateRating"]) if (p[k] != null) p[k] = deref(p[k]);
  return found;
}

function indexIds(node, ids, depth) {
  if (!node || typeof node !== "object" || depth > 8) return;
  if (Array.isArray(node)) { for (const n of node) indexIds(n, ids, depth + 1); return; }
  if (node["@id"] && Object.keys(node).length > 1) ids.set(node["@id"], { ...ids.get(node["@id"]), ...node });
  for (const v of Object.values(node)) indexIds(v, ids, depth + 1);
}

// Trang dựng bằng JavaScript (Next.js...) không có JSON-LD nhưng nhúng dữ liệu sản phẩm trong <script id="__NEXT_DATA__">.
// Tìm đối tượng "giống sản phẩm" (có tên + giá + mã/hãng) và đổi sang dạng JSON-LD để dùng chung đường xử lý.
const PRICE_KEYS = ["salePrice", "sellingPrice", "finalPrice", "price", "currentPrice"];
export function embeddedProducts(html) {
  const m = html.match(/<script[^>]+id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  const out = [];
  const visit = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 9 || out.length >= 5) return;
    if (Array.isArray(node)) { for (const n of node.slice(0, 40)) visit(n, depth + 1); return; }
    const price = PRICE_KEYS.map((k) => Number(node[k])).find((v) => Number.isFinite(v) && v > 0);
    if (typeof node.name === "string" && node.name.length >= 3 && price && (node.sku || node.barcode || node.brandName || node.brand || node.id)) {
      const img = node.mediaItems?.[0]?.mediaUrl ?? node.image ?? node.imageUrl ?? node.images?.[0]?.url ?? node.images?.[0];
      const brand = node.brandName ?? (typeof node.brand === "object" ? node.brand?.name : node.brand);
      out.push({ "@type": "Product", name: node.name, sku: node.sku ?? node.barcode, brand, image: typeof img === "string" ? img : undefined, offers: { "@type": "Offer", price, priceCurrency: "VND" }, _embedded: true });
      return; // không đi sâu vào các biến thể bên trong sản phẩm này
    }
    for (const v of Object.values(node)) visit(v, depth + 1);
  };
  visit(data, 0);
  return out;
}

function walk(node, found, depth) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) { for (const n of node) walk(n, found, depth + 1); return; }
  if (typeof node !== "object") return;
  const types = asArray(node["@type"]).map(String);
  if (types.some((t) => /^(Product|ProductGroup|IndividualProduct|Vehicle)$/i.test(t))) found.push(node);
  for (const k of ["@graph", "mainEntity", "itemListElement", "item", "hasVariant"]) if (node[k]) walk(node[k], found, depth + 1);
}

export function parseOfferPrice(v, currency = "VND") {
  if (v == null || v === "") return null;
  const cur = String(currency || "VND").toUpperCase();
  let n = null;
  if (typeof v === "number") n = v;
  else {
    const s = String(v).trim().replace(/\s/g, "");
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) n = Number(s.replace(/[.,]/g, ""));
    else if (/^\d+[.,]\d{1,2}$/.test(s)) n = parseFloat(s.replace(",", "."));
    else if (/^\d+$/.test(s)) n = Number(s);
    else n = parseVnd(s);
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  return cur === "VND" || cur === "₫" ? { value: Math.round(n), currency: "VND" } : { foreign: n, currency: cur };
}

function offerPrice(offers) {
  for (const o of asArray(offers)) {
    if (!o || typeof o !== "object") continue;
    const cur = o.priceCurrency || o.priceSpecification?.priceCurrency || "VND";
    const cand = o.price ?? o.lowPrice ?? o.priceSpecification?.price ?? asArray(o.offers).map((x) => x?.price)[0];
    const p = parseOfferPrice(cand, cur);
    if (p?.value) return { ...p, low: parseOfferPrice(o.lowPrice, cur)?.value, high: parseOfferPrice(o.highPrice, cur)?.value };
    if (o.offers) { const inner = offerPrice(o.offers); if (inner) return inner; }
  }
  return null;
}

function imagesOf(v) {
  const out = [];
  for (const x of asArray(v)) {
    if (typeof x === "string") out.push(x);
    else if (x && typeof x === "object") out.push(...imagesOf(x.url ?? x.contentUrl));
  }
  return out;
}

function toAbs(u, base) {
  if (!u) return null;
  u = String(u).trim();
  if (!u || u.startsWith("data:") || u.startsWith("blob:")) return null;
  try { return new URL(u, base).href; } catch { return null; }
}

const BAD_IMG = /(logo|icon|sprite|banner|avatar|placeholder|blank|loading|pixel|tracking|badge|flag|payment|social|facebook|zalo|footer|header|menu|\/ads?\/|favicon|star|rating|arrow|button|close|search|cart|captcha|spinner|noimage|no-image|default)/i;

function bestFromSrcset(set) {
  let best = null, bw = -1;
  for (const part of String(set).split(",")) {
    const [u, d] = part.trim().split(/\s+/);
    const w = parseInt(d, 10) || 1;
    if (u && w > bw) { best = u; bw = w; }
  }
  return best;
}

function stripHeavy(html) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ");
  // menu và đầu trang nằm trước tiêu đề sản phẩm: bắt đầu từ <h1> để dành chỗ cho phần mô tả và bảng thông số
  const h = clean.search(/<h1\b/i);
  return h > 0 ? clean.slice(h) : clean;
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|ul|ol|table|dd|dt|blockquote)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean);
}

/** Toàn bộ chữ của phần nội dung chính (từ tiêu đề sản phẩm), dùng cho đọc sâu bằng AI. */
export function pageMainText(htmlRaw, max = 45_000) {
  const lines = htmlToText(stripHeavy(htmlRaw));
  let out = "", n = 0;
  for (const l of lines) { if (n + l.length + 1 > max) break; out += l + "\n"; n += l.length + 1; }
  return out.trim();
}

const SECTION = {
  pros: /^(?:[-•*\d.)\s]*)(ưu điểm|điểm mạnh|điểm cộng|ưu thế|lợi thế|advantages?|the good|pros(?=\s*(?::|$)))/i,
  cons: /^(?:[-•*\d.)\s]*)(nhược điểm|điểm yếu|điểm trừ|hạn chế|điểm hạn chế|disadvantages?|the bad|cons(?=\s*(?::|$)))/i,
};

function stripBullet(l) { return l.replace(/^[-•*\d.)\s]+/, "").trim(); }
const headingLike = (l) => l.length <= 60 && !/[.;!?,]$/.test(l) && !l.startsWith("-");

export function proConSections(lines) {
  const out = { pros: [], cons: [] };
  for (let i = 0; i < lines.length; i++) {
    for (const kind of ["pros", "cons"]) {
      const m = lines[i].match(SECTION[kind]);
      if (!m) continue;
      const rest = lines[i].slice(m[0].length);
      // "Ưu điểm: a; b; c" cùng một dòng
      const inline = rest.match(/^[^:\n]{0,30}:\s*(.{12,})$/);
      if (inline) {
        for (const part of inline[1].split(/\s*[;•]\s*|\s+-\s+/)) pushItem(out[kind], part);
        continue;
      }
      if (lines[i].length > 70) continue; // không phải đề mục
      let taken = 0, bulleted = false;
      for (let j = i + 1; j < lines.length && taken < 8; j++) {
        const l = lines[j];
        if (SECTION.pros.test(l) || SECTION.cons.test(l)) break;
        if (taken === 0) bulleted = /^[-•*]/.test(l);
        else if (bulleted && !/^[-•*]/.test(l)) break; // hết danh sách gạch đầu dòng
        if (taken > 0 && headingLike(l)) break;
        if (stripBullet(l).length < 12) { if (taken > 0) break; continue; }
        if (pushItem(out[kind], l)) taken++;
      }
    }
  }
  return out;
}

function pushItem(list, raw) {
  const t = stripBullet(raw);
  if (t.length < 12 || t.length > 240) return false;
  if ((t.match(/[A-ZÀ-Ỹ]/g) ?? []).length > t.length * 0.5) return false;
  if (list.some((x) => sentenceKey(x) === sentenceKey(t))) return false;
  list.push(t);
  return true;
}

const STOP = new Set(["giúp", "cho", "với", "và", "của", "để", "này", "là", "được", "có", "trên", "từ", "đến", "mang", "tạo", "khi", "nhằm", "sử", "hiện", "đại", "tiên", "tiến"]);
export function techNames(text, max = 6) {
  const out = [];
  const re = /(?:công nghệ|technology)\s+([A-Za-zÀ-ỹ0-9][A-Za-zÀ-ỹ0-9\-+]*(?:\s+[A-Za-zÀ-ỹ0-9\-+]+){0,2})/gi;
  let m;
  while ((m = re.exec(text)) && out.length < max) {
    const words = [];
    for (const w of m[1].split(/\s+/)) {
      if (STOP.has(w.toLowerCase())) break;
      if (words.length && !/^[A-ZÀ-Ỹ0-9]/.test(w)) break;
      words.push(w);
    }
    if (!words.length || !/^[A-ZÀ-Ỹ0-9]/.test(words[0])) continue;
    const name = "Công nghệ " + words.join(" ");
    if (!out.some((x) => norm(x) === norm(name))) out.push(name);
  }
  return out;
}

export function priceSentences(lines, max = 3) {
  const out = [];
  for (const [i, line] of lines.entries()) {
    if (out.length >= max) break;
    // nhãn giá nằm riêng một dòng ("Đơn giá:") và số tiền ở dòng kế: ghép lại
    const l = line.length < 40 && /(giá|price)\s*:?\s*$/i.test(line) ? line + " " + (lines[i + 1] ?? "") : line;
    const m = l.match(/giá[^\d\n]{0,25}(\d{1,3}(?:[.,]\d{3}){1,3})\s*(?:đ|₫|vnđ|vnd)/i);
    if (m) { const v = parseVnd(m[1]); if (v && v >= 1000) out.push({ value: v, text: clip(l, 140) }); }
  }
  return out;
}

// Quy cách đóng gói: "1 Thùng = 48 Hộp x 110ml" -> { outer: "thùng", count: 48, unit: "hộp" } để tính giá mỗi hộp
export function packInfo(text) {
  const t = String(text).slice(0, 30_000);
  // "1 Thùng = 48 Hộp x 110ml" hoặc "lốc 4 hộp x 110ml"
  const m = t.match(/\b1\s*(thùng|lốc|kiện|vỉ|hộp|bộ|lố)\s*[=:]\s*(\d{1,3})\s*(hộp|chai|lon|gói|túi|lốc|viên|cái|lọ|vỉ|hũ|ống|lon)\b/i)
    || t.match(/\b(thùng|lốc|kiện|vỉ|bộ|lố)\s*(\d{1,3})\s*(hộp|chai|lon|gói|túi|viên|cái|lọ|hũ|ống)\b/i);
  if (!m || Number(m[2]) < 2) return null;
  return { outer: m[1].toLowerCase(), count: Number(m[2]), unit: m[3].toLowerCase() };
}

// Dữ liệu vi mô / thuộc tính giá: itemprop="price" content="123000", data-price="123000", data-price-amount (Magento), WooCommerce
export function priceFromAttrs(html) {
  const pats = [
    /itemprop\s*=\s*["']price["'][^>]*\bcontent\s*=\s*["']([\d.,]+)["']/i,
    /\bcontent\s*=\s*["']([\d.,]+)["'][^>]*itemprop\s*=\s*["']price["']/i,
    /data-price-amount\s*=\s*["']([\d.,]+)["']/i,
    /class\s*=\s*["'][^"']*woocommerce-Price-amount[^"']*["'][^>]*>\s*(?:<bdi>)?\s*(?:<span[^>]*>[^<]*<\/span>)?\s*([\d.,]+)/i,
    /data-(?:product-)?price\s*=\s*["']([\d.,]+)["']/i,
  ];
  for (const re of pats) {
    const m = html.match(re);
    const p = m && parseOfferPrice(m[1], "VND");
    if (p?.value && p.value >= 1000 && p.value < 5e9) return p.value;
  }
  return null;
}

// Giá đứng ngay sau tên sản phẩm (trang tự viết, không gắn nhãn "giá"): lấy số tiền đầu tiên trong vài dòng sau tiêu đề
const NOT_PRICE = /(giảm|tiết kiệm|trả góp|trả trước|phí|ship|vận chuyển|voucher|cọc|đặt trước|mỗi tháng|\/tháng|tặng|quà|thu cũ|hoàn tiền|thanh toán|từ \d)/i;
export function priceNearTitle(lines, title) {
  const t = String(title ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 30);
  if (t.length < 6) return null;
  const i = lines.findIndex((l) => l.toLowerCase().includes(t));
  if (i < 0) return null;
  for (const l of lines.slice(i + 1, i + 16)) {
    if (NOT_PRICE.test(l) || l.length > 160) continue;
    const m = l.match(/(\d{1,3}(?:[.,]\d{3}){1,3})\s*(?:đ|₫|vnđ|vnd|VND)(?![\p{L}\d])/iu);
    if (m) { const v = parseVnd(m[1]); if (v && v >= 1000 && v < 5e9) return v; }
  }
  return null;
}

// Vì sao không có giá: "contact" = trang ghi liên hệ để biết giá; "js" = trang tải giá bằng JavaScript sau khi mở
export function priceHintOf(html, text) {
  const head = String(text).slice(0, 8000);
  if (/giá\s*[:\-]?\s*liên hệ|liên hệ\s*(?:để\s*)?(?:biết|có|báo|nhận)?\s*giá|call\s*for\s*price|giá\s*:?\s*call/i.test(head)) return "contact";
  const spa = /id\s*=\s*["'](?:root|app|__nuxt|__next)["']|\bng-app\b|data-reactroot|window\.__NUXT__|__INITIAL_STATE__/i.test(html);
  if (spa && String(text).length < 4000) return "js";
  if (spa && !/(\d{1,3}(?:[.,]\d{3}){1,3})\s*(?:đ|₫|vnđ|vnd)/i.test(head)) return "js";
  return "";
}

// Giá nằm trong phần tử có class/id chứa "price" hoặc "gia" (trang tự viết, không có dữ liệu cấu trúc): "388,000 đ"
// Bỏ giá cũ/giá gạch. Chỉ nhận số có dấu phân cách nghìn (hoặc kèm đ/₫) để không nhầm "110ml" là giá.
export function priceFromMarkup(html) {
  const re = /<(?:span|div|p|b|strong|del|ins|em)\b[^>]*\b(?:class|id)\s*=\s*["']([^"']*)["'][^>]*>([^<]{0,80})(?=<)/gi;
  let n = 0, m;
  while ((m = re.exec(html)) && n++ < 400) {
    if (!/(?:^|[\s_-])(?:price|gia|prd-price)(?:$|[\s_-])|price/i.test(m[1]) || /old|del|cu\b|market|compare|origin|regular|list-price|sale-off|discount/i.test(m[1])) continue;
    const t = decodeEntities(m[2]).replace(/\s+/g, " ").trim();
    const num = t.match(/(\d{1,3}(?:[.,]\d{3}){1,3})\s*(?:đ|₫|vnđ|vnd)?/i);
    if (num) { const v = parseVnd(num[1]); if (v && v >= 1000 && v < 5e9) return v; }
  }
  return null;
}

// Giá trong tiêu đề/đoạn trích của kết quả tìm kiếm: chỉ nhận số đi kèm "đ/₫/VND" và gần chữ "giá"
export function priceFromSnippet(text) {
  const m = String(text).match(/giá[^\d]{0,20}(\d{1,3}(?:[.,]\d{3}){1,2})\s*(?:đ|₫|vnđ|vnd)/i) || String(text).match(/(\d{1,3}(?:[.,]\d{3}){1,2})\s*(?:₫|vnđ|vnd)/i);
  const v = m ? parseVnd(m[1]) : null;
  return v && v >= 1000 ? v : null;
}

// Các từ của một chuỗi: không dấu, chữ thường, tách chữ với số ("d63mm" -> d, 63, mm)
const wordsOf = (s) => norm(s).replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2").split(/[^a-z0-9]+/).filter(Boolean);
// Từ đặc trưng của tên sản phẩm: từ có ≥3 chữ hoặc số ≥2 chữ số; không trùng; tối đa 10
const nameWords = (name) => [...new Set(wordsOf(name || "").filter((t) => t.length >= 3 || /^\d{2,}$/.test(t)))].slice(0, 10);

/**
 * hint: { model, name, brand }
 */
export function extractFacts(htmlRaw, url, hint = {}) {
  const html = htmlRaw.length > MAX_HTML ? htmlRaw.slice(0, MAX_HTML) : htmlRaw;
  const metas = parseMetas(html);
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] ?? metas["og:title"]?.[0] ?? "").replace(/\s+/g, " ").trim();
  const h1 = decodeEntities(((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const domain = domainOf(url);
  const siteName = metas["og:site_name"]?.[0] || domain;

  // Sản phẩm có cấu trúc
  const prods = jsonLdProducts(html);
  if (!prods.length) prods.push(...embeddedProducts(html));
  const key = modelKey(hint.model || "");
  // Chọn sản phẩm: khớp mã model, ưu tiên cái CÓ giá (nhóm biến thể thường không có giá), rồi tới cái đầu tiên
  const hasPrice = (p) => !!offerPrice(p.offers)?.value;
  const byKey = key ? prods.filter((p) => modelKey([p.name, p.sku, p.mpn, p.model].join(" ")).includes(key)) : [];
  const pick = byKey.find(hasPrice) || byKey[0] || prods.find(hasPrice) || prods[0] || null;
  const product = { name: "", brand: "", sku: "", price: null, low: null, high: null, rating: null };
  if (pick) {
    product.name = clip(decodeEntities(String(pick.name ?? "")), 160);
    product.brand = String(typeof pick.brand === "object" ? pick.brand?.name ?? "" : pick.brand ?? "");
    product.sku = String(pick.sku ?? pick.mpn ?? "");
    const p = offerPrice(pick.offers);
    if (p?.value) { product.price = { value: p.value, source: "jsonld" }; product.low = p.low ?? null; product.high = p.high ?? null; }
    if (pick.aggregateRating?.ratingValue) product.rating = { value: Number(pick.aggregateRating.ratingValue), count: Number(pick.aggregateRating.reviewCount ?? pick.aggregateRating.ratingCount ?? 0) };
  }
  if (!product.price) {
    const amount = metas["product:price:amount"]?.[0] ?? metas["og:price:amount"]?.[0] ?? metas["price"]?.[0];
    const cur = metas["product:price:currency"]?.[0] ?? metas["og:price:currency"]?.[0] ?? metas["pricecurrency"]?.[0] ?? "VND";
    const p = parseOfferPrice(amount, cur);
    if (p?.value) product.price = { value: p.value, source: "meta" };
  }

  // Trang dài: bỏ script/style/svg rồi mới cắt, để mô tả và bảng thông số nằm sâu trong trang vẫn đọc được
  const body = htmlRaw.length > MAX_HTML ? stripHeavy(htmlRaw).slice(0, MAX_HTML) : html;
  const lines = htmlToText(body);
  const text = lines.join("\n");
  // Các cách đọc giá khi trang không có dữ liệu cấu trúc (thứ tự: chắc chắn nhất trước)
  if (!product.price) { const v = priceFromAttrs(html); if (v) product.price = { value: v, source: "markup" }; }
  if (!product.price) { const mv = priceFromMarkup(html); if (mv) product.price = { value: mv, source: "markup" }; }
  if (!product.price) { const nv = priceNearTitle(lines, h1 || title); if (nv) product.price = { value: nv, source: "text" }; }
  if (!product.price) {
    const ps = priceSentences(lines, 1)[0];
    if (ps) product.price = { value: ps.value, source: "text" };
  }
  // Không đọc được giá: nói rõ vì sao (liên hệ báo giá / trang tải giá bằng JavaScript) để người dùng biết cần làm gì
  const priceHint = product.price ? "" : priceHintOf(html, text);

  // Khớp sản phẩm: ưu tiên mã model, nếu không có thì so tên
  const headKey = modelKey(title + " " + h1 + " " + url);
  const bodyKey = modelKey(text.slice(0, 40_000));
  let modelMatch = null;
  if (key) modelMatch = headKey.includes(key) ? "title" : bodyKey.includes(key) ? "body" : null;
  // So tên: tách chữ/số ("D63mm" -> d, 63, mm; "Ø63" -> 63) để các cách viết khác nhau của cùng quy cách vẫn khớp
  const nameTokens = nameWords(hint.name);
  const headSet = new Set(wordsOf(title + " " + h1 + " " + text.slice(0, 3000)));
  const nameScore = nameTokens.length ? nameTokens.filter((t) => headSet.has(t)).length / nameTokens.length : 0;
  // Có mã model: khớp mã HOẶC khớp gần hết tên (nhà bán hay viết mã model khác đi). Không có model: khớp phần lớn tên.
  // (khi nhận theo tên, phần số của mã model vẫn phải có trên trang để không lẫn sang mã khác cùng hãng)
  const modelNums = wordsOf(hint.model).filter((t) => /^\d+$/.test(t));
  const relevant = key ? (!!modelMatch || (nameScore >= 0.75 && modelNums.every((n) => headSet.has(n)))) : nameScore >= 0.6;

  // Ảnh
  const cands = new Map();
  const add = (u, alt, source, bonus = 0, attrsIn = {}) => {
    const abs = toAbs(u, url);
    if (!abs) return;
    const k = abs.split("?")[0];
    const hay = `${abs} ${alt} ${attrsIn.class ?? ""} ${attrsIn.id ?? ""}`;
    let score = bonus;
    if (key && modelKey(hay).includes(key)) score += 4;
    const altKey = norm(alt);
    if (nameTokens.length && nameTokens.filter((t) => altKey.includes(t)).length / nameTokens.length >= 0.5) score += 2;
    if (/(product|gallery|main|zoom|large|slide|detail|primary)/i.test(hay)) score += 1;
    if (BAD_IMG.test(hay)) score -= 5;
    if (/\.(svg|gif)(\?|$)/i.test(abs)) score -= 5;
    const w = parseInt(attrsIn.width, 10), h = parseInt(attrsIn.height, 10);
    if ((w && w < 120) || (h && h < 120)) score -= 4;
    const cur = cands.get(k);
    if (!cur || cur.score < score) cands.set(k, { url: abs, alt: clip(alt, 100), source, score });
  };
  for (const u of metas["og:image"] ?? []) add(u, title, "og", 3);
  for (const u of metas["twitter:image"] ?? []) add(u, title, "og", 2);
  if (pick) for (const u of imagesOf(pick.image)) add(u, product.name, "jsonld", 4);
  let n = 0;
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    if (++n > 250) break;
    const a = attrs(tag);
    const src = a["data-src"] || a["data-original"] || a["data-lazy-src"] || a["data-lazy"] || bestFromSrcset(a.srcset || a["data-srcset"] || "") || a.src;
    add(src, a.alt ?? "", "img", 0, a);
  }
  const images = [...cands.values()].filter((i) => i.score >= 1).sort((a, b) => b.score - a.score).slice(0, 8);

  // Trang liệt kê (nhiều sản phẩm trong JSON-LD): dùng để tìm hãng khác khi không có AI
  const listing = [];
  if (prods.length >= 2) {
    for (const p of prods.slice(0, 40)) {
      const pr = offerPrice(p.offers);
      const nm = clip(decodeEntities(String(p.name ?? '')), 140);
      const brand = String(typeof p.brand === 'object' ? p.brand?.name ?? '' : p.brand ?? '');
      if (!nm || !pr?.value) continue;
      listing.push({ name: nm, brand, sku: String(p.sku ?? p.mpn ?? ''), price: pr.value, image: toAbs(imagesOf(p.image)[0], url), url: toAbs(p.url ?? p['@id'], url) || url });
    }
  }

  const pc = relevant ? proConSections(lines) : { pros: [], cons: [] };
  const tech = relevant ? techNames(text) : [];

  return {
    ok: true,
    url,
    domain,
    siteName,
    title: clip(title, 160),
    h1: clip(h1, 160),
    relevant,
    matched: { model: modelMatch, nameScore: Math.round(nameScore * 100) / 100 },
    product,
    images,
    pros: pc.pros.slice(0, 6),
    cons: pc.cons.slice(0, 6),
    tech,
    priceSentences: priceSentences(lines),
    pack: packInfo(`${product.name} ${h1} ${title} ${text}`),
    priceHint,
    listing: listing.slice(0, 20),
    // cho bảng so sánh NCC
    specs: relevant || prods.length ? extractSpecs(body, pick) : [],
    vat: detectVat(text, pick),
    seller: sellerOf(pick, metas, domain),
    contact: extractContacts(htmlRaw.length > 600_000 ? htmlRaw.slice(0, 600_000) : htmlRaw, url),
  };
}

// ---------- Thông số kỹ thuật, VAT, tên NCC (cho bảng so sánh nhà cung cấp) ----------
const SPEC_PRIORITY = ["model", "thuong hieu", "hang", "xuat xu", "san xuat tai", "cong suat", "dung tich", "dien ap", "tan so", "kich thuoc", "trong luong", "khoi luong", "chat lieu", "mau sac", "chuc nang", "cong nghe", "tinh nang", "hen gio", "nhiet do", "toc do", "do on", "bao hanh"];
const NOT_SPEC = /^(gia|giá|so luong|số lượng|mua|dat hang|đặt hàng|chia se|chia sẻ|danh gia|đánh giá|binh luan|bình luận|xem them|xem thêm|tags?|ma san pham|mã sản phẩm|sku)$/i;

const cellText = (h) => decodeEntities(String(h ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function addSpec(out, seen, k, v) {
  k = cellText(k).replace(/[:：]\s*$/, "");
  v = cellText(v);
  if (!k || !v || k.length > 45 || v.length > 160 || k.length < 3) return;
  if (/^[\d\W]+$/.test(k) || NOT_SPEC.test(k) || /^(\d+[.,]?\d*)$/.test(k)) return;
  if (norm(k) === norm(v)) return;
  const key = norm(k);
  if (seen.has(key)) return;
  // cùng giá trị và tên gần giống ("Công suất" / "Công suất đầu ra"): giữ cái đầu
  const nv = norm(v);
  if (out.some((o) => norm(o.v) === nv && (norm(o.k).includes(key) || key.includes(norm(o.k))))) return;
  seen.add(key);
  out.push({ k, v });
}

/** Thông số dạng cặp tên/giá trị: JSON-LD additionalProperty, <tr>, <dt>/<dd>, <li> hai ô con. */
export function extractSpecs(html, pick = null) {
  const out = [], seen = new Set();
  for (const p of asArray(pick?.additionalProperty)) if (p && typeof p === "object") addSpec(out, seen, p.name, p.value ?? p.valueReference);
  const h = html.length > 260_000 ? html.slice(0, 260_000) : html;
  const body = h.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ");
  const re = [
    /<tr\b[^>]*>\s*<(?:th|td)\b[^>]*>([\s\S]{1,200}?)<\/(?:th|td)>\s*<(?:th|td)\b[^>]*>([\s\S]{1,400}?)<\/(?:th|td)>\s*<\/tr>/gi,
    /<dt\b[^>]*>([\s\S]{1,200}?)<\/dt>\s*<dd\b[^>]*>([\s\S]{1,400}?)<\/dd>/gi,
    /<li\b[^>]*>\s*<(div|span|p|strong|b|label)\b[^>]*>([\s\S]{1,200}?)<\/\1>\s*<(div|span|p|strong|b|a)\b[^>]*>([\s\S]{1,400}?)<\/\3>\s*<\/li>/gi,
  ];
  let n = 0;
  for (const [i, r] of re.entries()) {
    let m;
    while ((m = r.exec(body)) && n++ < 400) {
      if (i === 2) addSpec(out, seen, m[2], m[4]); else addSpec(out, seen, m[1], m[2]);
    }
  }
  const rank = (s) => { const k = norm(s.k); const i = SPEC_PRIORITY.findIndex((p) => k.includes(p)); return i < 0 ? 99 : i; };
  return out.map((s, i) => ({ ...s, i })).sort((a, b) => rank(a) - rank(b) || a.i - b.i).slice(0, 12).map(({ k, v }) => ({ k, v }));
}

/** VAT: { state: "included" | "excluded" | "rate" | "unknown", rate?, text } theo chữ trên trang hoặc dữ liệu có cấu trúc. */
export function detectVat(text, pick = null) {
  for (const o of asArray(pick?.offers)) {
    const v = o?.priceSpecification?.valueAddedTaxIncluded ?? o?.valueAddedTaxIncluded;
    if (v === true || v === "true") return { state: "included", text: "Đã gồm VAT (dữ liệu của trang)" };
    if (v === false || v === "false") return { state: "excluded", text: "Chưa gồm VAT (dữ liệu của trang)" };
  }
  const t = " " + norm(text.slice(0, 120_000)) + " ";
  const sentence = (re) => { const m = t.match(re); return m ? m[0].trim() : ""; };
  const ex = sentence(/(gia\s+)?chua\s+(bao\s+gom\s+|gom\s+|co\s+)?vat|chua\s+vat|\+\s*vat|ngoai\s+vat|exclu(ding|sive of)\s+vat|price\s+excl\w*\s+vat/);
  if (ex) return { state: "excluded", text: "Chưa gồm VAT (trang ghi: “" + ex + "”)" };
  const inc = sentence(/(gia\s+)?da\s+(bao\s+gom\s+|gom\s+|co\s+)?vat|gia\s+bao\s+gom\s+vat|da\s+bao\s+gom\s+thue|inclu(ding|sive of)\s+vat|price\s+incl\w*\s+vat|vat\s+included/);
  if (inc) return { state: "included", text: "Đã gồm VAT (trang ghi: “" + inc + "”)" };
  const rate = t.match(/\bvat\s*(?:la\s*)?(\d{1,2})\s*%|\b(?:thue\s+)?gtgt\s*(\d{1,2})\s*%/);
  if (rate) return { state: "rate", rate: Number(rate[1] || rate[2]), text: `VAT ${rate[1] || rate[2]}% (trang ghi)` };
  return { state: "unknown", text: "Trang không ghi rõ VAT" };
}

/** Tên NCC (nơi bán): người bán trong dữ liệu có cấu trúc > og:site_name > tên miền. */
export function sellerOf(pick, metas, domain) {
  for (const o of asArray(pick?.offers)) {
    const s = o?.seller;
    const name = typeof s === "string" ? s : s?.name;
    if (name) return clip(decodeEntities(String(name)), 60);
  }
  // og:site_name chỉ nhận khi đúng là tên (ngắn, không phải URL/tiêu đề trang); không thì dùng tên miền
  const og = decodeEntities(metas?.["og:site_name"]?.[0] ?? "").trim();
  const ok = og && og.length <= 32 && !/^https?:|\.[a-z]{2,}\/|\s[-–|]\s/i.test(og);
  return clip(ok ? og : domain || "", 60);
}
