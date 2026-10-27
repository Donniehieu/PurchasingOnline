// "Entry" là bản ghi cache của một lần tìm hiểu. Mọi dữ liệu thu được (từ AI hoặc từ trang đã mở)
// đều được nạp vào đây kèm nguồn, rồi aggregate.js tổng hợp theo từng mục.
import { normUrl, domainOf, parseVnd, sentenceKey, clip, decodeEntities, norm, modelKey } from "./text.js";
import { priceStats } from "./aggregate.js";
import { upsertOffer } from "./offers.js";
import { mergeContact, hasContact } from "./contact.js";

export const ENTRY_VERSION = 2;

export function newEntry(plan, key) {
  const now = Date.now();
  return {
    v: ENTRY_VERSION,
    key,
    createdAt: now,
    updatedAt: now,
    plan,
    category: plan.category,
    product: { name: plan.name, brand: plan.brand, model: plan.model, summary: "" },
    sources: [],
    prices: [],
    pros: [],
    cons: [],
    tech: [],
    specs: [],
    images: [],
    alternatives: [],
    pages: [],
    queries: [],
    log: [],
    status: "running",
    ai: null,
  };
}

export const MAX_IMAGES = 5;
/** Chỉ giữ MAX_IMAGES ảnh tốt nhất (điểm cao trước; bằng điểm thì giữ ảnh đến trước). */
export function keepBestImages(list, max = MAX_IMAGES) {
  if (list.length <= max) return list;
  const ranked = list.map((im, i) => ({ im, i })).sort((x, y) => (y.im.score ?? 0) - (x.im.score ?? 0) || x.i - y.i).slice(0, max).sort((x, y) => x.i - y.i).map((x) => x.im);
  list.splice(0, list.length, ...ranked);
  return list;
}

export function logEvent(entry, kind, msg, extra = {}) {
  entry.log.push({ ts: Date.now(), kind, msg, ...extra });
  entry.updatedAt = Date.now();
}

export function addSource(entry, url, title = "", via = "ai", verified = true, kind = "") {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const key = normUrl(url);
  let s = entry.sources.find((x) => x.key === key);
  if (!s) {
    s = { id: entry.sources.length + 1, key, url, title: clip(decodeEntities(title), 120), domain: domainOf(url), via, verified, kind };
    entry.sources.push(s);
  } else {
    if (!s.title && title) s.title = clip(decodeEntities(title), 120);
    if (verified && !s.verified) s.verified = true;
    if (kind && !s.kind) s.kind = kind; // "shop" = trang cửa hàng trong kết quả tìm kiếm; "cite" = nguồn AI trích dẫn
  }
  return s.id;
}

const claimText = (c) => (typeof c === "string" ? c : c?.text ?? "");

function pushClaims(entry, list, claims, via = "ai") {
  const have = new Set(list.map((x) => sentenceKey(x.text) + "|" + (x.srcId ?? "")));
  for (const c of claims ?? []) {
    const text = clip(decodeEntities(claimText(c)), 240);
    if (text.length < 6) continue;
    const srcId = c?.source ? addSource(entry, c.source, "", via, c.verified !== false) : null;
    const k = sentenceKey(text) + "|" + (srcId ?? "");
    if (have.has(k)) continue;
    have.add(k);
    list.push({ text, srcId, verified: c?.verified !== false, via, ts: Date.now() });
  }
}

/** Giá quá cũ (mặc định 45 ngày) bị bỏ khi bổ sung dữ liệu mới; nếu bỏ hết thì giữ lại để còn tham khảo. */
export function dropStalePrices(entry, days = 45) {
  const cutoff = Date.now() - days * 864e5;
  const keep = entry.prices.filter((p) => (p.ts ?? entry.createdAt) >= cutoff);
  if (keep.length && keep.length !== entry.prices.length) { logEvent(entry, "cache", `Bỏ ${entry.prices.length - keep.length} giá quá ${days} ngày`); entry.prices = keep; }
}

// Kết quả bước "nhận diện + thông tin sản phẩm" của AI
export function ingestProduct(entry, ai) {
  const d = ai.data ?? {};
  for (const s of ai.sources ?? []) addSource(entry, s.url, s.title, "ai", true, s.kind);
  if (Array.isArray(ai.queries)) for (const q of ai.queries) if (q && !entry.queries.includes(q)) entry.queries.push(q);

  if (d.category === "tech" || d.category === "consumer") {
    if (entry.plan.categoryAuto) entry.category = d.category;
  }
  const p = d.product ?? {};
  entry.product = {
    name: clip(p.name || entry.product.name, 140),
    brand: clip(p.brand || entry.product.brand, 40),
    model: clip(p.model || entry.product.model, 40),
    summary: clip(p.summary || entry.product.summary || "", 400),
    aliases: Array.isArray(p.aliases) ? p.aliases.slice(0, 5) : [],
  };

  for (const pr of d.prices ?? []) {
    const value = parseVnd(pr?.value);
    if (!value) continue;
    const srcId = pr.source ? addSource(entry, pr.source, "", "ai", pr.verified !== false) : null;
    // cùng nguồn: giá mới thay giá cũ; cùng nguồn cùng giá: bỏ qua
    if (srcId && entry.prices.some((p) => p.srcId === srcId && p.value === value)) continue;
    if (srcId) entry.prices = entry.prices.filter((p) => p.srcId !== srcId);
    entry.prices.push({ value, label: clip(pr.label || "", 80), srcId, via: "ai", verified: pr.verified !== false, ts: Date.now() });
    const ps = srcId ? entry.sources.find((x) => x.id === srcId) : null;
    if (ps && !/(^|.)google./.test(ps.domain)) upsertOffer(entry, { kind: "same", name: entry.product.name, model: entry.product.model, brand: entry.product.brand, seller: ps.domain, price: value, priceVia: pr.via || "ai", url: ps.url, srcId });
  }
  pushClaims(entry, entry.pros, d.pros);
  pushClaims(entry, entry.cons, d.cons);
  for (const t of d.technologies ?? []) {
    if (!t?.name) continue;
    const tsrc = t.source ? addSource(entry, t.source, "", "ai", t.verified !== false) : null;
    if (entry.tech.some((x) => norm(x.name) === norm(t.name) && x.srcId === tsrc)) continue;
    entry.tech.push({
      name: clip(t.name, 80), benefit: clip(t.benefit || "", 200), drawback: clip(t.drawback || "", 200),
      srcId: t.source ? addSource(entry, t.source, "", "ai", t.verified !== false) : null, via: "ai",
    });
  }
  for (const s of d.specs ?? []) if (s?.name && s?.value && !entry.specs.some((x) => norm(x.name) === norm(String(s.name)))) entry.specs.push({ name: clip(s.name, 60), value: clip(String(s.value), 120) });
  entry.updatedAt = Date.now();
}

// Kết quả bước "so sánh hãng khác" của AI
export function ingestCompare(entry, ai) {
  const d = ai.data ?? {};
  for (const s of ai.sources ?? []) addSource(entry, s.url, s.title, "ai", true, s.kind);
  if (Array.isArray(ai.queries)) for (const q of ai.queries) if (q && !entry.queries.includes(q)) entry.queries.push(q);
  const seen = new Set(entry.alternatives.map((a) => (a.brand + a.model).toLowerCase()));
  for (const a of d.alternatives ?? []) {
    if (!a?.brand && !a?.name) continue;
    const id = ((a.brand || "") + (a.model || a.name || "")).toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const tmp = { pros: [], cons: [] };
    pushClaims(entry, tmp.pros, a.pros);
    pushClaims(entry, tmp.cons, a.cons);
    const value = parseVnd(a.price?.value ?? a.price);
    const alt = {
      brand: clip(a.brand || "", 40),
      name: clip(a.name || a.model || "", 120),
      model: clip(a.model || "", 40),
      price: value || null,
      priceSrcId: value && a.price?.source ? addSource(entry, a.price.source, "", "ai", a.price.verified !== false) : null,
      pros: tmp.pros.slice(0, 5),
      cons: tmp.cons.slice(0, 5),
      tech: (entry.category === "tech" ? a.technologies ?? [] : []).slice(0, 5).map((t) => ({ name: clip(t?.name || String(t), 60), benefit: clip(t?.benefit || "", 160), drawback: clip(t?.drawback || "", 160) })),
      vsMain: clip(a.vsMain || "", 240),
      srcIds: [],
      images: [],
    };
    const found = new Set((ai.sources ?? []).map((s) => normUrl(s.url)));
    const ids = [alt.priceSrcId, ...[...tmp.pros, ...tmp.cons].map((c) => c.srcId)];
    for (const u of a.sources ?? []) ids.push(addSource(entry, u, "", "ai", found.has(normUrl(u))));
    for (const id of ids) if (id && !alt.srcIds.includes(id)) alt.srcIds.push(id);
    for (const t of alt.tech) t.srcId = alt.srcIds[0] ?? null; // nguồn chung của hãng này
    entry.alternatives.push(alt);
    const as = alt.priceSrcId ? entry.sources.find((x) => x.id === alt.priceSrcId) : null;
    if (alt.price && as) upsertOffer(entry, { kind: "other", name: alt.name, model: alt.model, brand: alt.brand, seller: as.domain, price: alt.price, priceVia: "ai", url: as.url, srcId: as.id });
  }
  entry.updatedAt = Date.now();
}

// Kết quả đọc một trang (từ /api/page). Ghi log trang + gộp dữ liệu vào các mục.
export function ingestPage(entry, page, ctx = {}) {
  const rec = { url: page.url, finalUrl: page.finalUrl || page.url, ok: !!page.ok, status: page.status ?? 0, title: clip(page.title || "", 120), ts: Date.now(), ms: page.ms ?? 0, relevant: !!page.relevant, error: page.error || "", for: ctx.forLabel || "", found: { price: 0, pros: 0, cons: 0, tech: 0, images: 0 } };
  if (!page.ok) {
    entry.pages.push(rec);
    logEvent(entry, "page", `Bỏ qua (${page.error || "không mở được"}): ${page.url}`, { url: page.url, ok: false });
    return rec;
  }
  const srcId = addSource(entry, page.finalUrl || page.url, page.title, "page");
  rec.srcId = srcId;
  const forAlt = ctx.alt ?? null; // trang thuộc sản phẩm đối thủ

  if (page.relevant || forAlt) {
    const price = page.product?.price?.value;
    if (price && !forAlt) {
      // giá đọc trực tiếp từ trang thay cho giá AI báo cho cùng trang đó (tránh đếm hai lần)
      entry.prices = entry.prices.filter((p) => p.srcId !== srcId);
      entry.prices.push({ value: price, label: `Giá trên ${page.domain}`, srcId, via: "page", confident: page.product.price.source !== "text", verified: true, ts: Date.now() });
      rec.found.price++;
    } else if (price && forAlt && !forAlt.price) {
      forAlt.price = price; forAlt.priceSrcId = srcId; rec.found.price++;
    }
    if (!forAlt) {
      const known = new Set([...entry.pros, ...entry.cons].map((c) => sentenceKey(c.text)));
      for (const t of page.pros ?? []) { const k = sentenceKey(t); if (known.has(k)) continue; known.add(k); entry.pros.push({ text: t, srcId, verified: true, via: "page" }); rec.found.pros++; }
      for (const t of page.cons ?? []) { const k = sentenceKey(t); if (known.has(k)) continue; known.add(k); entry.cons.push({ text: t, srcId, verified: true, via: "page" }); rec.found.cons++; }
      if (entry.category === "tech") for (const t of page.tech ?? []) {
        if (entry.tech.some((x) => sentenceKey(x.name) === sentenceKey(t))) continue;
        entry.tech.push({ name: clip(t, 80), benefit: "", drawback: "", srcId, via: "page" }); rec.found.tech++;
      }
    }
    const imgs = page.images ?? [];
    const target = forAlt ? forAlt.images : entry.images;
    const have = new Set(target.map((i) => normUrl(i.url)));
    for (const im of imgs) {
      const k = normUrl(im.url);
      if (have.has(k)) continue;
      have.add(k);
      target.push({ url: im.url, alt: clip(im.alt || "", 100), srcId, score: im.score ?? 0, for: forAlt ? forAlt.brand || forAlt.name : "main" });
      rec.found.images++;
    }
    keepBestImages(target);
  }
  // liên hệ của NCC (theo tên miền): lấy từ mọi trang đã đọc, kể cả trang không khớp model
  if (page.contact) mergeSellerContact(entry, page.finalUrl || page.url, page.contact);
  noteSupplier(entry, page, forAlt ? false : !!page.relevant);
  if (page.relevant || forAlt) {
    const pr = page.product?.price;
    upsertOffer(entry, {
      kind: forAlt ? "other" : "same",
      name: page.product?.name || page.h1 || page.title,
      model: forAlt ? forAlt.model : entry.product.model || page.product?.sku || "",
      brand: forAlt ? forAlt.brand : page.product?.brand || entry.product.brand,
      seller: page.seller || page.domain,
      price: pr?.value ?? (forAlt ? forAlt.price : null) ?? null,
      priceVia: pr?.source ?? (forAlt && forAlt.price ? "ai" : "page"),
      vat: page.vat, specs: page.specs, url: page.finalUrl || page.url, srcId, readFromPage: true,
    });
  }
  entry.pages.push(rec);
  const parts = Object.entries(rec.found).filter(([, n]) => n).map(([k, n]) => `${LABEL[k]} ${n}`);
  logEvent(entry, "page", `Đã mở ${page.domain}${page.relevant ? "" : " (không khớp model)"}: ${parts.join(", ") || "không có dữ liệu mới"}`, { url: page.url, ok: true, srcId });
  return rec;
}

// Chế độ miễn phí (không AI): trang bán hàng/liệt kê nhiều sản phẩm -> tìm hãng khác, mỗi hãng một sản phẩm gần giá nhất
export function ingestListing(entry, page) {
  if (!page.ok) return ingestPage(entry, page);
  const srcId = addSource(entry, page.finalUrl || page.url, page.title, "page");
  const rec = { url: page.url, finalUrl: page.finalUrl || page.url, ok: true, status: page.status ?? 200, title: clip(page.title || "", 120), ts: Date.now(), ms: page.ms ?? 0, relevant: false, error: "", for: "hãng khác", srcId, found: { price: 0, pros: 0, cons: 0, tech: 0, images: 0 } };
  noteSupplier(entry, page, false);
  if (page.contact) mergeSellerContact(entry, page.finalUrl || page.url, page.contact);
  const mainBrand = norm(entry.product.brand);
  const mainKey = modelKey(entry.product.model);
  const mainPrice = priceStats(entry.prices).median;
  const have = new Set(entry.alternatives.map((a) => norm(a.brand)));
  const best = new Map();
  for (const p of page.listing ?? []) {
    const b = norm(p.brand);
    if (!b || b === mainBrand || have.has(b)) continue;
    if (mainKey && modelKey(`${p.name} ${p.sku}`).includes(mainKey)) continue; // chính sản phẩm đang xem
    if (mainPrice && (p.price < mainPrice * 0.4 || p.price > mainPrice * 2.5)) continue;
    const dist = mainPrice ? Math.abs(Math.log(p.price / mainPrice)) : 0;
    if (!best.has(b) || dist < best.get(b).dist) best.set(b, { p, dist });
  }
  for (const { p } of [...best.values()].sort((x, y) => x.dist - y.dist)) {
    if (entry.alternatives.length >= 5) break;
    const own = p.url ? addSource(entry, p.url, p.name, "search") : null;
    const ids = [own, srcId].filter(Boolean);
    entry.alternatives.push({
      brand: clip(p.brand, 40), name: clip(p.name, 120), model: clip(p.sku || "", 40), price: p.price, priceSrcId: own ?? srcId,
      pros: [], cons: [], tech: [], vsMain: "", srcIds: [...new Set(ids)],
      images: p.image ? [{ url: p.image, alt: clip(p.name, 100), srcId, score: 3, for: p.brand }] : [],
    });
    rec.found.price++;
    if (p.image) rec.found.images++;
    upsertOffer(entry, { kind: "other", name: p.name, model: p.sku, brand: p.brand, seller: page.seller || page.domain, price: p.price, priceVia: "listing", vat: page.vat, specs: [], url: p.url || page.finalUrl || page.url, srcId: own ?? srcId, readFromPage: false });
  }
  entry.pages.push(rec);
  logEvent(entry, "page", `Đã mở ${page.domain} để tìm hãng khác: ${rec.found.price ? rec.found.price + " hãng mới" : "không có hãng mới"}`, { url: page.url, ok: true, srcId });
  return rec;
}

/**
 * Ghi nhớ NCC của MỌI trang đã đọc được (kể cả trang không khớp model): tên NCC, các trang đã đọc, có bán đúng sản phẩm không.
 * Thông tin liên hệ nằm ở entry.contacts[tên miền]. Danh bạ này cũng được lưu chung ở store.suppliers.
 */
export function noteSupplier(entry, page, matched = false) {
  const url = page.finalUrl || page.url;
  const d = domainOf(url);
  if (!d || /(^|\.)google\./.test(d)) return null;
  entry.suppliers ??= {};
  const s = (entry.suppliers[d] ??= { domain: d, name: "", pages: [], matched: false, firstTs: Date.now() });
  const nm = String(page.seller || "").trim();
  if (nm && nm.toLowerCase() !== d && (!s.name || nm.length < s.name.length + 30)) s.name = clip(nm, 80);
  const key = normUrl(url);
  const p = s.pages.find((x) => x.key === key);
  const price = page.product?.price?.value ?? null;
  if (p) { p.relevant = p.relevant || !!matched; if (price != null) p.price = price; }
  else s.pages.push({ key, url, title: clip(page.title || "", 100), relevant: !!matched, price });
  if (s.pages.length > 12) s.pages = s.pages.slice(-12);
  s.matched = s.matched || !!matched;
  s.ts = Date.now();
  return s;
}

/** Gộp thông tin liên hệ vào entry.contacts[tên miền]. */
export function mergeSellerContact(entry, url, contact) {
  const d = domainOf(url);
  if (!d || !contact) return;
  entry.contacts ??= {};
  entry.contacts[d] = mergeContact(entry.contacts[d], contact, hasContact(contact) ? url : "");
}

/** Các NCC đã đọc nhưng chưa có SĐT/email và có biết link trang "Liên hệ": tối đa max trang, mỗi NCC một lần. */
export function sellersNeedingContact(entry, max = 3) {
  const out = [];
  const domains = new Set((entry.offers ?? []).filter((o) => o.readFromPage).map((o) => domainOf(o.url)));
  for (const d of domains) {
    const c = entry.contacts?.[d];
    if (!c || c.fetchedContactPage || !c.contactUrl) continue;
    if (c.phones?.length && (c.emails?.length || c.address)) continue; // đã đủ SĐT và (email hoặc địa chỉ)
    out.push({ domain: d, url: c.contactUrl });
    if (out.length >= max) break;
  }
  return out;
}

/** Kết quả đọc trang "Liên hệ" của một NCC. */
export function ingestContactPage(entry, domain, page) {
  entry.contacts ??= {};
  const cur = entry.contacts[domain] ?? mergeContact(null, {});
  cur.fetchedContactPage = true; // dù được hay không cũng không mở lại
  entry.contacts[domain] = cur;
  if (!page.ok) {
    entry.pages.push({ url: page.url, finalUrl: page.url, ok: false, status: page.status ?? 0, title: "", ts: Date.now(), ms: page.ms ?? 0, relevant: false, error: page.error || "", for: "liên hệ", found: { price: 0, pros: 0, cons: 0, tech: 0, images: 0 } });
    logEvent(entry, "page", `Trang liên hệ ${domain}: bỏ qua (${page.error || "không mở được"})`, { url: page.url, ok: false }); return false; }
  mergeSellerContact(entry, page.finalUrl || page.url, page.contact);
  entry.contacts[domain].fetchedContactPage = true;
  const c = entry.contacts[domain];
  const got = [c.phones?.length ? "SĐT" : "", c.emails?.length ? "email" : "", c.address ? "địa chỉ" : ""].filter(Boolean);
  entry.pages.push({ url: page.url, finalUrl: page.finalUrl || page.url, ok: true, status: page.status ?? 200, title: clip(page.title || "", 120), ts: Date.now(), ms: page.ms ?? 0, relevant: false, error: "", for: "liên hệ", found: { price: 0, pros: 0, cons: 0, tech: 0, images: 0 } });
  logEvent(entry, "page", `Đã mở trang liên hệ ${domain}: ${got.join(", ") || "không có thông tin mới"}`, { url: page.url, ok: true });
  return true;
}

// Ưu/nhược điểm/công nghệ của một hãng khác, lấy từ Google Chế độ AI (nguồn là chính trang Google AI đó)
export function ingestAltInsight(entry, alt, ins) {
  const srcId = addSource(entry, ins.url, "Google: " + ins.query, "ai");
  const d = ins.data;
  for (const c of d.pros.slice(0, 4)) alt.pros.push({ text: clip(decodeEntities(c.text), 240), srcId, verified: true, via: "ai" });
  for (const c of d.cons.slice(0, 4)) alt.cons.push({ text: clip(decodeEntities(c.text), 240), srcId, verified: true, via: "ai" });
  if (entry.category === "tech") for (const t of d.technologies.slice(0, 4)) alt.tech.push({ name: clip(t.name, 60), benefit: clip(t.benefit, 160), drawback: "", srcId });
  if (!alt.price) { const pr = d.prices[0]; if (pr) { alt.price = pr.value; alt.priceSrcId = srcId; } }
  if (srcId && !alt.srcIds.includes(srcId)) alt.srcIds.push(srcId);
  logEvent(entry, "ai", `Google về ${alt.brand}: ${d.pros.length} ưu điểm, ${d.cons.length} nhược điểm`, { srcId });
}

const LABEL = { price: "giá", pros: "ưu điểm", cons: "nhược điểm", tech: "công nghệ", images: "ảnh" };
export const FOUND_LABEL = LABEL;
