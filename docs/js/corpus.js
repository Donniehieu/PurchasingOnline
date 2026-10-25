// Kho dữ liệu đã đọc ("corpus"): MỖI TRANG CHỈ ĐƯỢC MỞ VÀ XỬ LÝ MỘT LẦN. Từ HTML của trang, makeDoc rút ngay mọi thứ mà
// các bước sau cần (câu đã chuẩn hóa để trả lời mọi câu hỏi, giá, hãng/model, thông số, liên hệ, tóm tắt, đề mục) rồi bỏ HTML.
// Nhờ đó nhiều câu hỏi (giá, ưu nhược điểm, công nghệ, phân loại, lưu ý khi mua, câu hỏi gõ thêm, so sánh NCC, liên hệ...)
// cùng khai thác một lượt đọc thay vì mỗi câu hỏi đi mở lại trang. Kho được lưu bền vững để hỏi thêm sau này không cần mở lại.
import { domainOf, extractPrice, findPrices, htmlToText, jsonLdProducts, normKey, parsePage, siteTokensOf, stripAccents } from "./core.js";

export const MIN_LEN = 50, MIN_LEN_PRICE = 14, MAX_LEN = 300, MAX_SENT = 400;
const SENT_SPLIT = /(?<=[.!?])\s+|\s{2,}|\s[-•·|]\s/;
const MAH_RE = /(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\s*m\s?ah/gi;
const strip = (h) => htmlToText(String(h));

/** Tách văn bản thành các câu (14-300 ký tự), kèm bản chuẩn hóa không dấu `n` để so khớp nhanh. */
export function splitSentences(text, max = MAX_SENT) {
  const out = [];
  for (const raw of text.split(SENT_SPLIT)) {
    const t = raw.trim();
    if (t.length >= MIN_LEN_PRICE && t.length <= MAX_LEN) { out.push({ t, n: stripAccents(t) }); if (out.length >= max) break; }
  }
  return out;
}

/** Tiêu đề, mô tả, đề mục, ý chính và số liệu của một bài viết (dùng cho bài tham khảo người dùng cung cấp). */
function summaryParts(html, text) {
  const meta = (/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]*content=["']([^"']*)["']/i.exec(html) || [, ""])[1];
  const headings = [];
  for (const m of html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)) { const t = strip(m[2]); if (t.length >= 4 && t.length <= 140 && !headings.includes(t)) headings.push(t); if (headings.length >= 10) break; }
  const sentences = [];
  for (const m of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) for (const s of strip(m[1]).split(SENT_SPLIT)) { const t = s.trim(); if (t.length >= 60 && t.length <= 260) sentences.push(t); }
  const rank = (s) => (/\d/.test(s) ? 2 : 0) + (/(ưu điểm|nhược điểm|lưu ý|nên|công nghệ|giá|bảo hành|khuyến nghị|so với)/i.test(s) ? 2 : 0);
  const keyPoints = [...new Map(sentences.map((s, i) => [normKey(s).slice(0, 50), { s, i, r: rank(s) }])).values()]
    .sort((a, b) => b.r - a.r || a.i - b.i).slice(0, 5).sort((a, b) => a.i - b.i).map((x) => x.s);
  const prices = findPrices(text).slice(0, 5), mah = [...new Set([...text.matchAll(MAH_RE)].map((m) => parseInt(m[1].replace(/[.,]/g, ""), 10)))].slice(0, 3);
  const facts = [];
  if (prices.length) facts.push(`Giá nhắc tới: ${[...new Set(prices)].map((p) => `${Math.round(p).toLocaleString("vi-VN")} đ`).join(", ")}`);
  if (mah.length) facts.push(`Dung lượng pin: ${mah.map((v) => `${v.toLocaleString("vi-VN")} mAh`).join(", ")}`);
  const w = /(\d{1,5})\s*W\b/.exec(text); if (w) facts.push(`Công suất: ${w[1]} W`);
  const war = /bảo\s*hành[^.\n]{0,25}?(\d{1,2})\s*(tháng|năm)/i.exec(text); if (war) facts.push(`Bảo hành: ${war[1]} ${war[2]}`);
  return { description: strip(meta).slice(0, 300), headings, keyPoints, facts };
}

/**
 * Xử lý MỘT LẦN một trang đã tải thành "tài liệu". p = { url, html, pseudo? } (pseudo = chỉ có tiêu đề và mô tả của kết quả tìm kiếm).
 * Tài liệu không giữ HTML. Trả về null nếu không có nội dung.
 */
export function makeDoc(p) {
  if (!p || !p.html || !p.url) return null;
  const pseudo = !!p.pseudo, html = p.html;
  const text = htmlToText(html).slice(0, 60000);
  const title = ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [, ""])[1]).replace(/\s+/g, " ").trim();
  let page = null;
  if (!pseudo) { try { page = parsePage(html, p.url, [], ""); } catch { page = null; } } // thông tin NCC/sản phẩm chưa lọc theo từ khóa
  return {
    url: p.url, domain: domainOf(p.url), title, pseudo, text: text.slice(0, 40000), norm: stripAccents(text), sentences: splitSentences(text),
    site: siteTokensOf(html, p.url), ld: pseudo ? [] : jsonLdProducts(html), price: extractPrice(html, text, null, pseudo), page,
    summary: pseudo ? null : { title, ...summaryParts(html, text) },
  };
}
/** Nhận trang thô {url, html} hoặc tài liệu đã xử lý, luôn trả về tài liệu (xử lý đúng một lần, nhớ kết quả trên chính đối tượng trang). */
export function asDoc(p) {
  if (!p) return null;
  if (p.sentences) return p;
  if (p._doc) return p._doc;
  const d = makeDoc(p); if (d) Object.defineProperty(p, "_doc", { value: d, enumerable: false }); return d;
}

/* ------------------------------------------------------------------ kho */
export class Corpus {
  constructor() { this.docs = new Map(); }
  get size() { return this.docs.size; }
  has(url) { return this.docs.has(url); }
  get(url) { return this.docs.get(url) || null; }
  /** Thêm tài liệu. Kết quả tìm kiếm chỉ có tiêu đề/mô tả (pseudo) không ghi đè trang đã đọc thật. */
  add(doc) { if (!doc) return null; const old = this.docs.get(doc.url); if (old && !old.pseudo && doc.pseudo) return old; this.docs.set(doc.url, doc); return doc; }
  addPage(p) { return this.add(asDoc(p)); }
  /** Danh sách tài liệu; real=true chỉ lấy trang đã mở thật. */
  list({ real = false } = {}) { const all = [...this.docs.values()]; return real ? all.filter((d) => !d.pseudo) : all; }
}

/* ------------------------------------------------------------------ lưu bền vững (IndexedDB), nén gọn */
const DB = "po_corpus", STORE = "c", KEEP_SENT = 200, KEEP_TEXT = 15000;
export function packDoc(d) {
  return { url: d.url, domain: d.domain, title: d.title, pseudo: d.pseudo, text: d.text.slice(0, KEEP_TEXT), sentences: d.sentences.slice(0, d.pseudo ? 4 : KEEP_SENT).map((s) => s.t),
    site: [...d.site], ld: d.ld, price: d.price, page: d.page, summary: d.summary };
}
export function unpackDoc(o) {
  return { ...o, norm: stripAccents(o.text), sentences: o.sentences.map((t) => ({ t, n: stripAccents(t) })), site: new Set(o.site) };
}
const openDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "jobId" });
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
const withStore = async (mode, fn) => { const db = await openDb(); return new Promise((resolve, reject) => { const t = db.transaction(STORE, mode), out = fn(t.objectStore(STORE)); t.oncomplete = () => resolve(out && "result" in out ? out.result : out); t.onerror = () => reject(t.error); }); };
export const saveCorpus = (jobId, corpus) => withStore("readwrite", (s) => s.put({ jobId, saved: Date.now(), docs: corpus.list().map(packDoc) }));
export async function loadCorpus(jobId) {
  const rec = await withStore("readonly", (s) => s.get(jobId));
  if (!rec) return null;
  const c = new Corpus(); rec.docs.forEach((d) => c.add(unpackDoc(d))); return c;
}
export const deleteCorpus = (jobId) => withStore("readwrite", (s) => s.delete(jobId));
export const clearCorpora = () => withStore("readwrite", (s) => s.clear());
/** Giữ kho của các yêu cầu mới nhất (mặc định 10), xóa phần còn lại để không phình dung lượng. */
export async function pruneCorpora(keepIds) {
  const all = await withStore("readonly", (s) => s.getAllKeys());
  for (const id of all) if (!keepIds.includes(id)) await deleteCorpus(id);
}
