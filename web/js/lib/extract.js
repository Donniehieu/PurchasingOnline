// Trích dữ liệu từ HTML một trang sản phẩm: giá, ảnh, ưu điểm, nhược điểm, công nghệ.
// Chỉ dùng regex (Worker không có DOM) và chặn kích thước để tiết kiệm CPU.
import { norm, modelKey, decodeEntities, parseVnd, domainOf, clip, sentenceKey } from "./text.js";

const MAX_HTML = 320_000; // giữ CPU thấp (Workers gói Free giới hạn ~10ms CPU mỗi lần gọi)

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
  const re = /<script[^>]+type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let raw = m[1].trim().replace(/^<!--/, "").replace(/-->$/, "").replace(/^\/\/<!\[CDATA\[|\/\/\]\]>$/g, "");
    let data;
    try { data = JSON.parse(raw); } catch { continue; }
    walk(data, found, 0);
  }
  return found;
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

const SECTION = {
  pros: /^(?:[-•*\d.)\s]*)(ưu điểm|điểm mạnh|điểm cộng|ưu thế|lợi thế|pros?|advantages?|the good)\b/i,
  cons: /^(?:[-•*\d.)\s]*)(nhược điểm|điểm yếu|điểm trừ|hạn chế|điểm hạn chế|cons?|disadvantages?|the bad)\b/i,
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
  for (const l of lines) {
    if (out.length >= max) break;
    const m = l.match(/giá[^\d\n]{0,25}(\d{1,3}(?:[.,]\d{3}){1,3})\s*(?:đ|₫|vnđ|vnd)/i);
    if (m) { const v = parseVnd(m[1]); if (v && v >= 1000) out.push({ value: v, text: clip(l, 140) }); }
  }
  return out;
}

// Giá trong tiêu đề/đoạn trích của kết quả tìm kiếm: chỉ nhận số đi kèm "đ/₫/VND" và gần chữ "giá"
export function priceFromSnippet(text) {
  const m = String(text).match(/giá[^\d]{0,20}(\d{1,3}(?:[.,]\d{3}){1,2})\s*(?:đ|₫|vnđ|vnd)/i) || String(text).match(/(\d{1,3}(?:[.,]\d{3}){1,2})\s*(?:₫|vnđ|vnd)/i);
  const v = m ? parseVnd(m[1]) : null;
  return v && v >= 10000 ? v : null;
}

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
  const key = modelKey(hint.model || "");
  const pick = (key && prods.find((p) => modelKey([p.name, p.sku, p.mpn, p.model].join(" ")).includes(key))) || prods[0] || null;
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

  const lines = htmlToText(html);
  const text = lines.join("\n");
  if (!product.price) {
    const ps = priceSentences(lines, 1)[0];
    if (ps) product.price = { value: ps.value, source: "text" };
  }

  // Khớp sản phẩm: ưu tiên mã model, nếu không có thì so tên
  const headKey = modelKey(title + " " + h1 + " " + url);
  const bodyKey = modelKey(text.slice(0, 40_000));
  let modelMatch = null;
  if (key) modelMatch = headKey.includes(key) ? "title" : bodyKey.includes(key) ? "body" : null;
  const nameTokens = norm(hint.name || "").split(" ").filter((t) => t.length >= 3).slice(0, 6);
  const head = norm(title + " " + h1 + " " + text.slice(0, 3000));
  const nameScore = nameTokens.length ? nameTokens.filter((t) => head.includes(t)).length / nameTokens.length : 0;
  const relevant = key ? !!modelMatch : nameScore >= 0.6;

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
    listing: listing.slice(0, 20),
  };
}
