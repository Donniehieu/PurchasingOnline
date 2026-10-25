// Luồng xử lý một yêu cầu, tách khỏi giao diện. Hai giai đoạn:
//  1) prepare: đọc ảnh -> tìm Google (1-5 trang, mở hết link) -> album ảnh -> phân tích -> sinh question card.
//  2) run: tìm NCC -> liên hệ -> trả lời mọi chủ đề và câu hỏi từ kho dữ liệu -> bài tham khảo -> xếp hạng, tổng hợp.
//
// Thuật toán: mỗi trang chỉ mở MỘT lần và được xử lý ngay thành tài liệu trong kho (corpus.js). Các chủ đề (giá, ưu nhược điểm,
// công nghệ, phân loại, lưu ý khi mua) và các câu hỏi gõ thêm đều được trả lời từ kho trong MỘT lượt quét. Chỉ câu nào còn thiếu
// mới tìm thêm trên Google (các chủ đề thiếu được gộp thành một lượt tìm), và trang mới cũng chỉ mở khi chưa có trong kho.
import * as album from "./album.js";
import { AnswerStore, searchKey } from "./answers.js";
import * as core from "./core.js";
import { asDoc, loadCorpus, saveCorpus } from "./corpus.js";
import { CancelledError, pseudoDocs, readImages } from "./crawl.js";
import * as knowledge from "./knowledge.js";
import * as net from "./net.js";

const uid = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));
export const spaced = (...parts) => parts.map((p) => String(p || "").trim()).filter(Boolean).join(" ");
/** Từ khóa kiểm tra bài đúng sản phẩm: chỉ 5 từ đầu của tên (tên dài kiểu quảng cáo "... phù hợp mọi nhu cầu" làm lọc sai). */
const relTokens = (text) => core.queryKeywords(text).slice(0, 5);
const albumQuery = (job) => spaced(job.query, job.product_code);
const MAX_ROUNDS = 2, MAX_CUSTOM_SEARCHES = 4;

/** Thông số mặc định của một yêu cầu (người dùng chỉnh trong form). */
export function defaultConfig(settings = {}) {
  const num = (v, lo, hi, d) => Math.min(hi, Math.max(lo, parseInt(v, 10) || d));
  return { pages: num(settings.pages, 1, 5, 2), album_n: num(settings.album_n, 1, 20, 3), delay: num(settings.delay, 1, 15, 3), topics: ["price", "pros", "using", "types", "buy"], extra_q: [], ref_urls: [] };
}
const save = async (job, crawler) => { try { await saveCorpus(job.id, crawler.corpus); } catch { /* môi trường không có IndexedDB */ } };
const statsText = (c) => `đã mở ${c.fetched} trang, dùng lại ${c.reused} lần từ kho (không mở lại), ${c.searches} lượt tìm Google`;
/** Thêm tiêu đề + mô tả của các kết quả không mở được vào kho. */
const addPseudo = (crawler, items, readDocs) => pseudoDocs(items, new Set(readDocs.map((d) => d.url))).forEach((d) => crawler.corpus.add(d));

/* ------------------------------------------------------------------ giai đoạn 1: tìm hiểu rồi mới hỏi */
/**
 * ctx: { crawler, step(id, state, detail, frac), log(msg), settings, files }.
 * Sau khi xong: job.discovery, job.questions, job.status = "awaiting_confirmation"; kho dữ liệu được lưu để dùng tiếp.
 */
export async function prepare(job, ctx) {
  const { crawler, step, log, settings, files } = ctx;
  if (!net.isExt && !crawler.injected) throw new Error(net.EXT_ONLY);
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

  // 2. Ảnh trước: đủ tên + model (hoặc chỉ có ảnh) thì lấy ảnh trên Google Hình ảnh vào album để so khớp
  const imageOnly = files.length > 0 && !typedText;
  const searchTextForAlbum = searchText;
  if ((job.query && job.product_code) || imageOnly) {
    job.album_label = `Album: ${albumQuery(job) || searchTextForAlbum}`;
    step("album", "start", `${job.cfg.album_n} ảnh đầu của Google Hình ảnh cho "${albumQuery(job) || searchTextForAlbum}"`);
    const a = await album.crawlAlbum(job.id, albumQuery(job) || searchTextForAlbum, job.cfg.album_n);
    log(a.error ? `Album: ${a.error}` : `Album: thêm ${a.added.length} ảnh (đã thử ${a.tried})`);
    step("album", a.error ? "error" : "done", a.error || `Thêm ${a.added.length}/${job.cfg.album_n} ảnh`);
  } else step("album", "skip", "Chưa đủ tên sản phẩm + model, sẽ lấy ảnh sau khi bạn xác nhận model");

  // 3. Google: tìm N trang, mở hết link của từng trang; mỗi trang được xử lý ngay thành tài liệu trong kho
  step("google", "start", `Tìm "${searchText}" trên Google, ${job.cfg.pages} trang`);
  const res = await crawler.google(searchText, job.cfg.pages, { label: "Tìm sản phẩm" });
  addPseudo(crawler, res.items, res.read);
  job.sites_searched = [...new Set(res.items.map((i) => i.url))].slice(0, 120);
  job.queries = [...new Set([...(job.queries || []), ...crawler.queries])];
  res.errors.forEach((e) => log(`Google lỗi: ${e}`));
  step("google", res.items.length ? "done" : "error", `${res.pagesDone} trang kết quả, ${res.items.length} kết quả, ${statsText(crawler)}`);
  if (!res.items.length) throw new Error(res.errors[0] || "Google không trả kết quả nào");

  // 4. Phân tích kho dữ liệu đã đọc
  step("analyze", "start");
  const subject = job.query || searchText;
  job.discovery = core.buildDiscovery(crawler.corpus.list(), relTokens(subject), subject);
  const d = job.discovery;
  step("analyze", "done", `${d.total} nguồn đúng sản phẩm, nhóm ngành ${core.CATEGORIES[d.category].label}` + (d.price ? `, giá thấy trên web ${core.money(d.price.min)} đến ${core.money(d.price.max)}` : ""));
  job.questions = core.buildCards(job, job.suggested_name, "", d);
  job.status = "awaiting_confirmation";
  await save(job, crawler);
}

/* ------------------------------------------------------------------ giai đoạn 2 */
/** Tạo bảng NCC từ các tài liệu đã đọc: chỉ trang bán một sản phẩm đúng model mới vào bảng, giá phải đọc chắc chắn từ trang. */
export function buildSuppliers(job, docsIn) {
  const tokens = relTokens(job.query), code = core.stripAccents(job.product_code || "").trim();
  const codeRe = code ? new RegExp(`\\b${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) : null;
  const seenUrl = new Set(), perDomain = new Map(), suppliers = [], others = [];
  for (const raw of docsIn) {
    const d = asDoc(raw);
    if (!d || d.pseudo || !d.page || seenUrl.has(d.url)) continue; seenUrl.add(d.url);
    const rel = core.phraseRelevance(tokens, d.norm); if (rel === 0) continue;
    const modelOk = !codeRe || codeRe.test(d.norm), s = { ...d.page, model_ok: modelOk, relevance: Math.round(Math.min(rel, modelOk ? 1 : 0.5) * 100) / 100 };
    if (!s.is_product) { others.push({ url: d.url, title: s.title, reason: "Không phải trang bán một sản phẩm (bài viết hoặc danh mục)" }); continue; }
    if (!modelOk) { others.push({ url: d.url, title: s.title, reason: `Trang không nhắc model ${job.product_code}` }); continue; }
    if (s.relevance < 0.5) continue;
    const n = perDomain.get(d.domain) || 0; if (n >= 2) continue; perDomain.set(d.domain, n + 1);
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

async function enrichContacts(job, crawler, step) {
  const origins = [...new Set(job.suppliers.map((s) => s.site_url).filter(Boolean))];
  const merged = new Map();
  let i = 0;
  for (const origin of origins) {
    i++; step("contacts", "start", `${i}/${origins.length}: ${new URL(origin).hostname}`, i / origins.length);
    for (const path of ["/lien-he", "/contact", "/lien-he.html", "/contact-us", "/"]) {
      const { doc, fresh } = await crawler.visitInfo(origin + path);
      const c = doc && doc.page && doc.page.contacts;
      if (c && (c.phones.length || c.emails.length || c.zalo.length)) { merged.set(origin, c); break; }
      if (fresh) await crawler.wait(0.4);
    }
  }
  for (const s of job.suppliers) {
    const extra = merged.get(s.site_url); if (!extra) continue;
    const c = s.contacts || {};
    const pick = (a = [], b = [], n = 4) => [...new Set([...a, ...b])].slice(0, n);
    s.contacts = { ...c, phones: pick(c.phones, extra.phones), emails: pick(c.emails, extra.emails), zalo: pick(c.zalo, extra.zalo), messenger: pick(c.messenger, extra.messenger), facebook: pick(c.facebook, extra.facebook), zalo_guess: c.zalo_guess && extra.zalo_guess, website: c.website || extra.website };
  }
}

const MAX_OPEN_PER_QUESTION = 6; // mỗi câu hỏi mở tối đa 6 bài MỚI (bài đã mở rồi thì dùng luôn, không tính)

function loadStore(job) {
  const opts = { product: spaced(job.query, job.product_code), code: job.product_code || "", queryTokens: relTokens(job.query), topicIds: job.cfg.topics, questions: job.cfg.extra_q || [] };
  return job.answer_store ? AnswerStore.fromJSON(job.answer_store, opts) : new AnswerStore(opts);
}
/** Đưa kho đáp án vào job để hiển thị và lưu (đáp án tích lũy, không mất khi tải lại). */
function publish(job, store, crawler) {
  const docs = crawler.corpus.list(), read = crawler.corpus.list({ real: true }).length;
  job.research = Object.fromEntries(Object.entries(store.topicsOut(docs)).map(([id, e]) => [id, { ...e, pages_read: read }]));
  job.custom_answers = store.customOut().map((a) => ({ ...a, pages_read: read }));
  job.answer_store = store.toJSON();
}

/**
 * Tìm đáp án cho MỘT câu hỏi: tìm Google bằng "<câu hỏi> <tên sản phẩm>", lấy danh sách bài, rồi mở từng bài chưa mở.
 * Mỗi bài mở ra được chấm cho TẤT CẢ câu hỏi (đáp án bổ sung đúng vào block từng câu hỏi, đáp án cũ giữ nguyên).
 * Dừng khi câu hỏi đã đủ đáp án hoặc đã mở `maxOpen` bài mới. Bài không mở được thì bỏ qua ngay (không chờ) và lấy bài khác.
 * Trả về { opened, skipped }.
 */
export async function findAnswers(store, entry, crawler, { product, maxPages = 2, maxOpen = MAX_OPEN_PER_QUESTION, onProgress = () => {} } = {}) {
  let opened = 0, skipped = 0;
  for await (const cand of crawler.candidates(searchKey(entry, product), maxPages, { label: entry.label })) {
    if (store.enough(entry) || opened >= maxOpen) break;
    const { doc, fresh } = await crawler.visitInfo(cand.url);
    if (!doc) { skipped++; onProgress({ opened, skipped, url: cand.url, failed: true }); continue; }
    store.ingest(doc); opened++;
    onProgress({ opened, skipped, url: cand.url, failed: false });
    if (store.enough(entry) || opened >= maxOpen) break; // dừng ngay, không xin ứng viên kế (tránh tải thừa trang kết quả kế tiếp)
    if (fresh) await crawler.wait();
  }
  return { opened, skipped };
}

/**
 * Trả lời lần lượt từng câu hỏi (các chủ đề đã chọn rồi các câu hỏi gõ thêm):
 *  1. lưu đáp án từ mọi bài đã mở ở các bước trước;
 *  2. câu nào đã đủ đáp án thì không tìm thêm; câu còn thiếu thì tìm bài mới bằng "câu hỏi + tên sản phẩm" và bổ sung vào mọi block.
 * Bài đã mở không mở lại, bài lỗi bỏ qua. Trả về kho đáp án.
 */
export async function answerQuestions(job, crawler, { step = () => {}, log = () => {}, maxPages = 2 } = {}) {
  const product = spaced(job.query, job.product_code), store = loadStore(job);
  store.prime(crawler.corpus.list()); // đếm chữ lặp ở nhiều bài (menu, chân trang) trước khi chấm
  let saved = 0; for (const d of crawler.corpus.list()) saved += store.ingest(d);
  const entries = store.list();
  publish(job, store, crawler);
  step("topics", "start", `Đã lưu ${saved} đáp án từ ${crawler.corpus.list({ real: true }).length} bài đã mở`, 0.05);
  for (const [i, e] of entries.entries()) {
    const sid = e.kind === "topic" ? "topics" : "extra", frac = i / Math.max(1, entries.length);
    if (store.enough(e)) { log(`"${e.label}": đã đủ ${e.items.length} đáp án từ ${store.pages(e)} bài đã mở, không tìm thêm`); continue; }
    step(sid, "start", `Câu ${i + 1}/${entries.length} "${e.label}": tìm bài "${searchKey(e, product)}" (đã có ${e.items.length} đáp án)`, frac);
    const r = await findAnswers(store, e, crawler, { product, maxPages, onProgress: (p) => step(sid, "start", `"${e.label}": ${p.failed ? `bỏ qua bài không mở được (${p.skipped})` : `đã mở ${p.opened} bài mới`}, có ${e.items.length} đáp án từ ${store.pages(e)} bài`, frac) });
    log(`"${e.label}": mở ${r.opened} bài mới, bỏ qua ${r.skipped} bài không mở được, có ${e.items.length} đáp án từ ${store.pages(e)} bài`);
    publish(job, store, crawler); // lưu ngay sau mỗi câu hỏi
  }
  publish(job, store, crawler);
  return store;
}

/**
 * ctx: { crawler, step, log }. Mỗi bước độc lập: bước lỗi được ghi log và bỏ qua, các bước khác vẫn chạy.
 * Dừng theo yêu cầu (CancelledError) thì tổng hợp phần đã có và đánh dấu job.partial.
 */
export async function run(job, ctx) {
  const { crawler, step, log } = ctx;
  const product = spaced(job.query, job.product_code);
  const guard = async (id, fn) => { try { await fn(); } catch (e) { if (e instanceof CancelledError) throw e; log(`${id}: ${e.message}`); step(id, "error", e.message); } };
  try {
    job.keywords = core.searchKeywords(job);
    // Ảnh trước: có đủ tên + model thì lấy ảnh Google Hình ảnh vào album trước khi trả lời các câu hỏi
    await guard("album", async () => {
      if (job.album_label) { step("album", "skip", "Đã lấy ảnh ở bước đầu"); return; }
      if (!(job.query && job.product_code)) { step("album", "skip", "Chưa đủ tên sản phẩm + model"); return; }
      job.album_label = `Album: ${albumQuery(job)}`;
      step("album", "start", `${job.cfg.album_n} ảnh đầu của Google Hình ảnh cho "${albumQuery(job)}"`);
      const a = await album.crawlAlbum(job.id, albumQuery(job), job.cfg.album_n);
      log(a.error ? `Album: ${a.error}` : `Album: thêm ${a.added.length} ảnh`);
      step("album", a.error ? "error" : "done", a.error || `Thêm ${a.added.length}/${job.cfg.album_n} ảnh`);
    });
    await guard("suppliers", async () => {
      step("suppliers", "start", `Tìm NCC bán "${product}", ${job.cfg.pages} trang`);
      await crawler.wait();
      const res = await crawler.google(spaced(job.keywords, "giá mua"), job.cfg.pages, { label: "Tìm NCC" });
      addPseudo(crawler, res.items, res.read);
      job.sites_searched = [...new Set([...(job.sites_searched || []), ...res.items.map((i) => i.url)])].slice(0, 200);
      const b = buildSuppliers(job, crawler.corpus.list({ real: true })); // gồm cả các trang đã đọc ở giai đoạn 1
      job.suppliers = b.suppliers; job.others = b.others.slice(0, 30);
      res.errors.forEach((e) => log(`Google lỗi: ${e}`));
      step("suppliers", "done", `${b.suppliers.length} trang bán đúng sản phẩm, ${b.others.length} trang bị loại; ${statsText(crawler)}`);
    });
    if (job.suppliers.length) await guard("contacts", async () => { await enrichContacts(job, crawler, step); step("contacts", "done", "Đã thu thập liên hệ trên trang sản phẩm và trang Liên hệ của NCC"); });
    else step("contacts", "skip", "Chưa có NCC");

    // Chủ đề đã chọn và câu hỏi gõ thêm: trả lời từng câu, đáp án tích lũy từ nhiều bài, chỉ tìm bài mới cho câu còn thiếu
    job.research = {}; job.custom_answers = [];
    if (!job.cfg.topics.length && !job.cfg.extra_q.length) { step("topics", "skip", "Bạn không chọn chủ đề nào"); step("extra", "skip", "Không có câu hỏi thêm"); }
    else await guard("topics", async () => {
      const store = await answerQuestions(job, crawler, { step, log, maxPages: Math.min(job.cfg.pages, 3) });
      const topics = store.list().filter((e) => e.kind === "topic"), customs = store.list().filter((e) => e.kind === "custom");
      step("topics", topics.length ? "done" : "skip", `${topics.filter((e) => e.items.length).length}/${topics.length} chủ đề có đáp án, tổng ${topics.reduce((n, e) => n + e.items.length, 0)} đáp án`);
      step("extra", customs.length ? "done" : "skip", customs.length ? `${customs.filter((e) => e.items.length).length}/${customs.length} câu hỏi có đáp án` : "Không có câu hỏi thêm");
    });

    // Bài viết tham khảo do người dùng cung cấp: mở một lần, tóm tắt và hỏi đáp trên chính bài đó
    job.refs = [];
    if (!job.cfg.ref_urls.length) step("refs", "skip", "Không có link tham khảo");
    for (const [i, url] of job.cfg.ref_urls.entries()) await guard("refs", async () => {
      step("refs", "start", `${i + 1}/${job.cfg.ref_urls.length}: ${core.domainOf(url)}`, i / job.cfg.ref_urls.length);
      const { doc, fresh } = await crawler.visitInfo(url);
      if (!doc) throw new Error(`Không đọc được ${url}`);
      const art = knowledge.articleOf(doc);
      job.refs.push({ url: art.url, domain: art.domain, title: art.title, description: art.description, headings: art.headings, keyPoints: art.keyPoints, facts: art.facts, qa: knowledge.articleQuestions(art, product, job.discovery?.category || core.detectCategory(product)) });
      if (fresh) await crawler.wait();
    });
    if (job.cfg.ref_urls.length) step("refs", "done", `${job.refs.length}/${job.cfg.ref_urls.length} bài đã tóm tắt`);
  } catch (e) {
    if (!(e instanceof CancelledError)) throw e;
    job.partial = true; log("Đã dừng theo yêu cầu: tổng hợp phần đã có");
  }
  job.queries = [...new Set([...(job.queries || []), ...crawler.queries])];
  job.stats = { fetched: crawler.fetched, reused: crawler.reused, searches: crawler.searches, docs: crawler.corpus.size };
  log(`Tổng kết: ${statsText(crawler)}, kho ${crawler.corpus.size} tài liệu`);
  step("compose", "start");
  buildOutputs(job);
  step("compose", "done", job.suppliers.length ? `${job.suppliers.length} NCC, đề xuất: ${(job.suppliers.find((s) => s.recommended) || {}).name || "chưa có (thiếu giá chính xác)"}` : "Chưa có NCC phù hợp");
  job.status = "done";
  await save(job, crawler);
}

/* ------------------------------------------------------------------ hỏi thêm sau khi có kết quả */
/**
 * Hỏi thêm một câu: chấm các bài đã lưu trong kho cho câu hỏi mới (không mở lại trang nào); nếu chưa đủ đáp án và allowSearch thì tìm bài mới
 * bằng "câu hỏi + tên sản phẩm". Bài mới cũng bổ sung đáp án cho các câu hỏi khác; đáp án cũ giữ nguyên. Trả về { question, snippets, pages, searched, opened }.
 */
export async function askMore(job, question, crawler, { allowSearch = true, maxPages = 2 } = {}) {
  const product = spaced(job.query, job.product_code), store = loadStore(job);
  store.prime(crawler.corpus.list());
  for (const d of crawler.corpus.list()) store.ingest(d); // bài chưa chấm (nếu có)
  const e = store.addCustom(question, crawler.corpus.list()); // chấm toàn bộ kho cho câu hỏi mới
  let searched = false, opened = 0;
  if (!store.enough(e) && allowSearch && (net.isExt || crawler.injected)) {
    searched = true; opened = (await findAnswers(store, e, crawler, { product, maxPages })).opened;
  }
  publish(job, store, crawler);
  job.queries = [...new Set([...(job.queries || []), ...crawler.queries])];
  await save(job, crawler);
  return { question, snippets: store.snippets(e), pages: store.pages(e), searched, opened, pages_read: crawler.corpus.list({ real: true }).length };
}
export { loadCorpus };
