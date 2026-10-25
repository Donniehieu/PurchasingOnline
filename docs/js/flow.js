// Luồng xử lý một yêu cầu, tách khỏi giao diện. Hai giai đoạn:
//  1) prepare: đọc ảnh -> tìm Google (1-5 trang, mở hết link) -> album ảnh -> phân tích -> sinh question card.
//  2) run: tìm NCC -> liên hệ -> tìm hiểu các chủ đề đã chọn -> câu hỏi thêm -> bài viết tham khảo -> xếp hạng, tổng hợp.
import * as album from "./album.js";
import * as core from "./core.js";
import { CancelledError, pseudoPages, readImages } from "./crawl.js";
import * as knowledge from "./knowledge.js";
import * as net from "./net.js";

const uid = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));
export const spaced = (...parts) => parts.map((p) => String(p || "").trim()).filter(Boolean).join(" ");
const albumQuery = (job) => spaced(job.query, job.product_code);

/** Thông số mặc định của một yêu cầu (người dùng chỉnh trong form). */
export function defaultConfig(settings = {}) {
  const num = (v, lo, hi, d) => Math.min(hi, Math.max(lo, parseInt(v, 10) || d));
  return { pages: num(settings.pages, 1, 5, 2), album_n: num(settings.album_n, 1, 20, 3), delay: num(settings.delay, 1, 15, 3), topics: ["price", "pros", "using", "types", "buy"], extra_q: [], ref_urls: [] };
}

/* ------------------------------------------------------------------ giai đoạn 1: tìm hiểu rồi mới hỏi */
/**
 * ctx: { crawler, step(id, state, detail, frac), log(msg), settings, files }.
 * Sau khi xong: job.discovery, job.questions, job.status = "awaiting_confirmation".
 */
export async function prepare(job, ctx) {
  const { crawler, step, log, settings, files } = ctx;
  if (!net.isExt) throw new Error(net.EXT_ONLY);
  const typedText = !!(job.query || job.product_code || job.search_text);

  // 1. Dữ liệu đầu vào từ ảnh: lấy tên, model, chữ trong ảnh rồi điền vào các trường
  step("ocr", "start", files.length ? "Đang đọc ảnh..." : "");
  if (files.length) {
    const r = await readImages(files, settings.anthropic_key);
    job.ocr_text = r.text; job.suggested_name = r.keyword || null;
    if (!job.query && r.keyword) job.query = r.keyword;
    if (!job.product_code && r.model) job.product_code = r.model;
    if (!job.search_text) job.search_text = spaced(r.keyword, r.model) || r.text.slice(0, 80);
    const how = r.via === "claude" ? "Claude đọc ảnh" : r.via === "browser" ? "bộ đọc chữ của trình duyệt" : "";
    if (how) { log(`${how}: tên "${r.keyword || "?"}", model "${r.model || "?"}", chữ trong ảnh: ${r.text.slice(0, 100)}`); step("ocr", "done", `Đã điền từ ảnh: ${spaced(r.keyword, r.model) || r.text.slice(0, 60)}`); }
    else { step("ocr", "skip", r.error || "Chưa đọc được chữ trong ảnh (cần khóa Anthropic ở tab Cài đặt)"); log(r.error || "Chưa đọc được chữ trong ảnh, hãy nhập tên sản phẩm"); }
  } else step("ocr", "skip", "Không có ảnh");
  const searchText = job.search_text || spaced(job.query, job.product_code);
  if (!searchText) throw new Error("Chưa có từ khóa tìm kiếm: nhập tên sản phẩm/model, hoặc chọn ảnh có chữ (cần khóa Anthropic để đọc chữ trong ảnh)");
  job.search_text = searchText;

  // 2. Google: tìm N trang, mở hết link của từng trang
  step("google", "start", `Tìm "${searchText}" trên Google, ${job.cfg.pages} trang`);
  const res = await crawler.google(searchText, job.cfg.pages, { label: "Tìm sản phẩm" });
  job.sites_searched = [...new Set(res.items.map((i) => i.url))].slice(0, 120);
  job.queries = [...new Set([...(job.queries || []), ...crawler.queries])];
  res.errors.forEach((e) => log(`Google lỗi: ${e}`));
  step("google", res.items.length ? "done" : "error", `${res.pagesDone} trang kết quả, ${res.items.length} kết quả, đã đọc ${res.read.length} trang web`);
  if (!res.items.length) throw new Error(res.errors[0] || "Google không trả kết quả nào");

  // 3. Album: đủ tên + model (hoặc chỉ có ảnh) thì lấy ảnh trên Google Hình ảnh để so khớp
  const imageOnly = files.length > 0 && !typedText;
  if ((job.query && job.product_code) || imageOnly) {
    job.album_label = `Album: ${albumQuery(job) || searchText}`;
    step("album", "start", `${job.cfg.album_n} ảnh đầu của Google Hình ảnh cho "${albumQuery(job) || searchText}"`);
    await crawler.wait();
    const a = await album.crawlAlbum(job.id, albumQuery(job) || searchText, job.cfg.album_n);
    log(a.error ? `Album: ${a.error}` : `Album: thêm ${a.added.length} ảnh (đã thử ${a.tried})`);
    step("album", a.error ? "error" : "done", a.error || `Thêm ${a.added.length}/${job.cfg.album_n} ảnh`);
  } else step("album", "skip", "Chưa đủ tên sản phẩm + model, sẽ lấy ảnh sau khi bạn xác nhận model");

  // 4. Phân tích dữ liệu đã đọc
  step("analyze", "start");
  const subject = job.query || searchText;
  job.discovery = core.buildDiscovery([...res.read, ...pseudoPages(res.items, new Set(res.read.map((p) => p.url)))], core.queryKeywords(subject), subject);
  const d = job.discovery;
  step("analyze", "done", `${d.total} nguồn đúng sản phẩm, nhóm ngành ${core.CATEGORIES[d.category].label}` + (d.price ? `, giá thấy trên web ${core.money(d.price.min)} đến ${core.money(d.price.max)}` : ""));
  job.questions = core.buildCards(job, job.suggested_name, "", d);
  job.status = "awaiting_confirmation";
}

/* ------------------------------------------------------------------ giai đoạn 2: tìm NCC, chủ đề, câu hỏi thêm, bài tham khảo */
const toInt = (v) => Math.round(Number(v) || 0);
async function enrichContacts(job, crawler, step) {
  const origins = [...new Set(job.suppliers.map((s) => s.site_url).filter(Boolean))];
  const merged = new Map();
  let i = 0;
  for (const origin of origins) {
    i++; step("contacts", "start", `${i}/${origins.length}: ${new URL(origin).hostname}`, i / origins.length);
    for (const path of ["/lien-he", "/contact", "/lien-he.html", "/contact-us", "/"]) {
      try {
        const html = await crawler.fetchHtml(origin + path);
        const c = core.extractContacts(html, origin + path, core.htmlToText(html));
        if (c.phones.length || c.emails.length || c.zalo.length) { merged.set(origin, c); break; }
      } catch (e) { if (e instanceof CancelledError) throw e; /* trang không có */ }
      await crawler.wait(0.4);
    }
  }
  for (const s of job.suppliers) {
    const extra = merged.get(s.site_url); if (!extra) continue;
    const c = s.contacts || {};
    const pick = (a = [], b = [], n = 4) => [...new Set([...a, ...b])].slice(0, n);
    s.contacts = { ...c, phones: pick(c.phones, extra.phones), emails: pick(c.emails, extra.emails), zalo: pick(c.zalo, extra.zalo), messenger: pick(c.messenger, extra.messenger), facebook: pick(c.facebook, extra.facebook), zalo_guess: c.zalo_guess && extra.zalo_guess, website: c.website || extra.website };
  }
}

/** Tạo bảng NCC từ các trang đã đọc: chỉ trang bán đúng sản phẩm (đúng model nếu có) mới vào bảng, giá phải đọc chắc chắn từ trang. */
export function buildSuppliers(job, pages) {
  const tokens = core.queryKeywords(job.query), seenUrl = new Set(), perDomain = new Map();
  const suppliers = [], others = [];
  for (const p of pages) {
    if (!p || !p.html || seenUrl.has(p.url)) continue; seenUrl.add(p.url);
    let s = null; try { s = core.parsePage(p.html, p.url, tokens, job.product_code); } catch { s = null; }
    if (!s) continue;
    if (!s.is_product) { others.push({ url: p.url, title: s.title, reason: "Không phải trang bán một sản phẩm (bài viết hoặc danh mục)" }); continue; }
    if (!s.model_ok) { others.push({ url: p.url, title: s.title, reason: `Trang không nhắc model ${job.product_code}` }); continue; }
    if (s.relevance < 0.5) continue;
    const dom = core.domainOf(p.url), n = perDomain.get(dom) || 0; if (n >= 2) continue; perDomain.set(dom, n + 1);
    if (s.price && !core.isConfidentPrice(s.price_source)) { s.price_guess = s.price; s.price = null; s.note = "Chưa đọc được giá chính xác từ trang, hãy mở link để xem giá"; }
    suppliers.push({ id: uid(), quantity: job.quantity, ...s });
  }
  return { suppliers, others };
}

export function buildOutputs(job) {
  job.suppliers = core.scoreSuppliers(job.suppliers, job.spec?.vat_required !== false, job.spec?.budget || null);
  job.price_stats = core.priceStats(job.suppliers);
  job.analysis = core.buildInsights(job.suppliers, job.quantity, { product: job.query, spec: core.specText(job.spec), purpose: job.purpose, research: job.research });
}

/**
 * ctx: { crawler, step, log }. Mỗi bước độc lập: bước lỗi được ghi log và bỏ qua, các bước khác vẫn chạy.
 * Dừng theo yêu cầu (CancelledError) thì tổng hợp phần đã có và đánh dấu job.partial.
 */
export async function run(job, ctx) {
  const { crawler, step, log } = ctx;
  const code = job.product_code, product = spaced(job.query, code), tokens = core.queryKeywords(job.query);
  const readAll = () => [...crawler.cache].map(([url, html]) => ({ url, html }));
  const guard = async (id, fn) => { try { await fn(); } catch (e) { if (e instanceof CancelledError) throw e; log(`${id}: ${e.message}`); step(id, "error", e.message); } };
  try {
    job.keywords = core.searchKeywords(job);
    // NCC
    await guard("suppliers", async () => {
      step("suppliers", "start", `Tìm NCC bán "${product}", ${job.cfg.pages} trang`);
      await crawler.wait();
      const res = await crawler.google(spaced(job.keywords, "giá mua"), job.cfg.pages, { label: "Tìm NCC" });
      job.sites_searched = [...new Set([...(job.sites_searched || []), ...res.items.map((i) => i.url)])].slice(0, 200);
      const b = buildSuppliers(job, [...res.read, ...readAll()]); // gồm cả các trang đã đọc ở giai đoạn 1
      job.suppliers = b.suppliers; job.others = b.others.slice(0, 30);
      res.errors.forEach((e) => log(`Google lỗi: ${e}`));
      step("suppliers", "done", `${b.suppliers.length} trang bán đúng sản phẩm, ${b.others.length} trang bị loại (không phải trang sản phẩm hoặc sai model)`);
    });
    // Liên hệ NCC
    if (job.suppliers.length) await guard("contacts", async () => { await enrichContacts(job, crawler, step); step("contacts", "done", "Đã thu thập liên hệ trên trang sản phẩm và trang Liên hệ của NCC"); });
    else step("contacts", "skip", "Chưa có NCC");

    // Chủ đề người dùng chọn
    job.research = {};
    const topicPages = Math.min(job.cfg.pages, 2);
    const topics = knowledge.TOPIC_DEFS.filter((t) => job.cfg.topics.includes(t.id));
    if (!topics.length) step("topics", "skip", "Bạn không chọn chủ đề nào");
    for (const [i, t] of topics.entries()) await guard("topics", async () => {
      step("topics", "start", `${t.label} (${i + 1}/${topics.length})`, i / topics.length);
      await crawler.wait();
      const res = await crawler.google(spaced(product, t.suffix), topicPages, { label: t.label });
      job.research[t.id] = { ...knowledge.answerTopic(t.id, product, [...res.read, ...readAll(), ...pseudoPages(res.items, new Set(res.read.map((p) => p.url)))], tokens), pages_read: res.read.length };
    });
    if (topics.length) step("topics", "done", `${Object.values(job.research).filter((r) => r.snippets.length).length}/${topics.length} chủ đề có câu trả lời từ bài viết`);

    // Câu hỏi/từ khóa thêm
    job.custom_answers = [];
    if (!job.cfg.extra_q.length) step("extra", "skip", "Không có câu hỏi thêm");
    for (const [i, q] of job.cfg.extra_q.entries()) await guard("extra", async () => {
      step("extra", "start", `"${q}" (${i + 1}/${job.cfg.extra_q.length})`, i / job.cfg.extra_q.length);
      await crawler.wait();
      const res = await crawler.google(spaced(product, q), 2, { label: "Câu hỏi thêm" }); // đọc bài ở trang 1-2
      job.custom_answers.push({ ...knowledge.answerCustom(q, [...res.read, ...readAll()], tokens), pages_read: res.read.length });
    });
    if (job.cfg.extra_q.length) step("extra", "done", `${job.custom_answers.length} câu hỏi đã tìm`);

    // Bài viết tham khảo do người dùng cung cấp
    job.refs = [];
    if (!job.cfg.ref_urls.length) step("refs", "skip", "Không có link tham khảo");
    for (const [i, url] of job.cfg.ref_urls.entries()) await guard("refs", async () => {
      step("refs", "start", `${i + 1}/${job.cfg.ref_urls.length}: ${core.domainOf(url)}`, i / job.cfg.ref_urls.length);
      await crawler.wait(i ? 1 : 0);
      const art = knowledge.summarizeArticle(await crawler.fetchHtml(url), url);
      job.refs.push({ ...art, text: undefined, qa: knowledge.articleQuestions(art, product, job.discovery?.category || core.detectCategory(product)) });
    });
    if (job.cfg.ref_urls.length) step("refs", "done", `${job.refs.length}/${job.cfg.ref_urls.length} bài đã tóm tắt`);
  } catch (e) {
    if (!(e instanceof CancelledError)) throw e;
    job.partial = true; log("Đã dừng theo yêu cầu: tổng hợp phần đã có");
  }
  // Ảnh: nếu lúc đầu thiếu model thì bây giờ đã đủ tên + model
  if (job.query && job.product_code && !job.album_label && !job.partial) {
    job.album_label = `Album: ${albumQuery(job)}`;
    step("album", "start", `${job.cfg.album_n} ảnh đầu của Google Hình ảnh`);
    const a = await album.crawlAlbum(job.id, albumQuery(job), job.cfg.album_n);
    step("album", a.error ? "error" : "done", a.error || `Thêm ${a.added.length} ảnh`); log(a.error ? `Album: ${a.error}` : `Album: thêm ${a.added.length} ảnh`);
  }
  job.queries = [...new Set([...(job.queries || []), ...crawler.queries])];
  step("compose", "start");
  buildOutputs(job);
  step("compose", "done", job.suppliers.length ? `${job.suppliers.length} NCC, đề xuất: ${(job.suppliers.find((s) => s.recommended) || {}).name || "chưa có (thiếu giá chính xác)"}` : "Chưa có NCC phù hợp");
  job.status = "done";
}
