// Luồng xử lý một yêu cầu, tách khỏi giao diện. Hai giai đoạn:
//  1) prepare: đọc ảnh -> tìm Google (1-5 trang, mở hết link) -> album ảnh -> phân tích -> sinh question card.
//  2) run: tìm NCC -> liên hệ -> trả lời mọi chủ đề và câu hỏi từ kho dữ liệu -> bài tham khảo -> xếp hạng, tổng hợp.
//
// Thuật toán: mỗi trang chỉ mở MỘT lần và được xử lý ngay thành tài liệu trong kho (corpus.js). Các chủ đề (giá, ưu nhược điểm,
// công nghệ, phân loại, lưu ý khi mua) và các câu hỏi gõ thêm đều được trả lời từ kho trong MỘT lượt quét. Chỉ câu nào còn thiếu
// mới tìm thêm trên Google (các chủ đề thiếu được gộp thành một lượt tìm), và trang mới cũng chỉ mở khi chưa có trong kho.
import * as album from "./album.js";
import * as core from "./core.js";
import { asDoc, loadCorpus, saveCorpus } from "./corpus.js";
import { CancelledError, pseudoDocs, readImages } from "./crawl.js";
import * as knowledge from "./knowledge.js";
import * as net from "./net.js";

const uid = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));
export const spaced = (...parts) => parts.map((p) => String(p || "").trim()).filter(Boolean).join(" ");
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

  // 2. Google: tìm N trang, mở hết link của từng trang; mỗi trang được xử lý ngay thành tài liệu trong kho
  step("google", "start", `Tìm "${searchText}" trên Google, ${job.cfg.pages} trang`);
  const res = await crawler.google(searchText, job.cfg.pages, { label: "Tìm sản phẩm" });
  addPseudo(crawler, res.items, res.read);
  job.sites_searched = [...new Set(res.items.map((i) => i.url))].slice(0, 120);
  job.queries = [...new Set([...(job.queries || []), ...crawler.queries])];
  res.errors.forEach((e) => log(`Google lỗi: ${e}`));
  step("google", res.items.length ? "done" : "error", `${res.pagesDone} trang kết quả, ${res.items.length} kết quả, ${statsText(crawler)}`);
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

  // 4. Phân tích kho dữ liệu đã đọc
  step("analyze", "start");
  const subject = job.query || searchText;
  job.discovery = core.buildDiscovery(crawler.corpus.list(), core.queryKeywords(subject), subject);
  const d = job.discovery;
  step("analyze", "done", `${d.total} nguồn đúng sản phẩm, nhóm ngành ${core.CATEGORIES[d.category].label}` + (d.price ? `, giá thấy trên web ${core.money(d.price.min)} đến ${core.money(d.price.max)}` : ""));
  job.questions = core.buildCards(job, job.suggested_name, "", d);
  job.status = "awaiting_confirmation";
  await save(job, crawler);
}

/* ------------------------------------------------------------------ giai đoạn 2 */
/** Tạo bảng NCC từ các tài liệu đã đọc: chỉ trang bán một sản phẩm đúng model mới vào bảng, giá phải đọc chắc chắn từ trang. */
export function buildSuppliers(job, docsIn) {
  const tokens = core.queryKeywords(job.query), code = core.stripAccents(job.product_code || "").trim();
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

/**
 * Trả lời các chủ đề đã chọn và các câu hỏi gõ thêm từ kho (một lượt quét), rồi bổ sung phần còn thiếu:
 * - các chủ đề thiếu được gộp thành MỘT lượt tìm Google (tối đa MAX_ROUNDS lượt), sau mỗi lượt trả lời lại từ kho;
 * - mỗi câu hỏi gõ thêm còn thiếu mới tìm riêng (tối đa MAX_CUSTOM_SEARCHES câu).
 * Trang đã có trong kho không bao giờ bị mở lại. Trả về { topics, custom, docs }.
 */
export async function answerFromCorpus(job, crawler, { step = () => {}, topicPages = 1 } = {}) {
  const product = spaced(job.query, job.product_code), tokens = core.queryKeywords(job.query);
  const topicIds = job.cfg.topics.filter((id) => knowledge.TOPIC_DEFS.some((t) => t.id === id)), questions = job.cfg.extra_q || [];
  const answer = () => knowledge.answerAll({ product, banks: knowledge.topicBanks(topicIds), custom: questions }, crawler.corpus.list(), tokens);
  let all = answer();
  step("topics", "start", `Đã trả lời ${topicIds.length} chủ đề và ${questions.length} câu hỏi từ ${all.docs} nguồn trong kho, không mở thêm trang`, 0.3);
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const weak = knowledge.weakTopicIds(all.topics).filter((id) => topicIds.includes(id));
    if (!weak.length) break;
    step("topics", "start", `Còn thiếu ${weak.length} chủ đề (${weak.map((id) => all.topics[id].label).join(", ")}): tìm bổ sung 1 lượt Google`, 0.3 + round * 0.2);
    await crawler.wait();
    const res = await crawler.google(knowledge.combinedQuery(product, weak), topicPages, { label: "Bổ sung chủ đề thiếu" });
    addPseudo(crawler, res.items, res.read); all = answer();
  }
  let searched = 0;
  for (const i of knowledge.weakCustomIdx(all.custom)) {
    if (searched >= MAX_CUSTOM_SEARCHES) break; searched++;
    step("extra", "start", `"${questions[i]}" chưa đủ trả lời từ kho, tìm bổ sung (trang 1-2)`, searched / MAX_CUSTOM_SEARCHES);
    await crawler.wait();
    const res = await crawler.google(spaced(product, questions[i]), 2, { label: "Câu hỏi thêm" });
    addPseudo(crawler, res.items, res.read); all = answer();
  }
  return { topics: all.topics, custom: all.custom, docs: all.docs };
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

    // Chủ đề đã chọn và câu hỏi gõ thêm: trả lời từ kho, chỉ tìm thêm cho phần còn thiếu
    job.research = {}; job.custom_answers = [];
    if (!job.cfg.topics.length && !job.cfg.extra_q.length) { step("topics", "skip", "Bạn không chọn chủ đề nào"); step("extra", "skip", "Không có câu hỏi thêm"); }
    else await guard("topics", async () => {
      const r = await answerFromCorpus(job, crawler, { step, topicPages: Math.min(job.cfg.pages, 2) });
      const read = crawler.corpus.list({ real: true }).length;
      job.research = Object.fromEntries(Object.entries(r.topics).map(([id, e]) => [id, { ...e, pages_read: read }]));
      job.custom_answers = r.custom.map((a) => ({ ...a, pages_read: read }));
      step("topics", "done", `${Object.values(job.research).filter((e) => e.snippets.length).length}/${job.cfg.topics.length} chủ đề có câu trả lời từ bài viết`);
      if (job.cfg.extra_q.length) step("extra", "done", `${job.custom_answers.filter((a) => a.snippets.length).length}/${job.cfg.extra_q.length} câu hỏi có câu trả lời`); else step("extra", "skip", "Không có câu hỏi thêm");
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
  // Ảnh: nếu lúc đầu thiếu model thì bây giờ đã đủ tên + model
  if (job.query && job.product_code && !job.album_label && !job.partial) {
    job.album_label = `Album: ${albumQuery(job)}`;
    step("album", "start", `${job.cfg.album_n} ảnh đầu của Google Hình ảnh`);
    const a = await album.crawlAlbum(job.id, albumQuery(job), job.cfg.album_n);
    step("album", a.error ? "error" : "done", a.error || `Thêm ${a.added.length} ảnh`); log(a.error ? `Album: ${a.error}` : `Album: thêm ${a.added.length} ảnh`);
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
 * Trả lời một câu hỏi mới từ kho dữ liệu đã lưu của yêu cầu (không mở lại trang nào). Nếu còn thiếu và allowSearch thì tìm thêm
 * trên Google (trang 1-2) rồi trả lời lại. Cần crawler dùng kho đã nạp (loadCorpus). Trả về { question, snippets, pages, searched }.
 */
export async function askMore(job, question, crawler, { allowSearch = true } = {}) {
  const product = spaced(job.query, job.product_code), tokens = core.queryKeywords(job.query);
  const ask = () => knowledge.answerCustom(question, crawler.corpus.list(), tokens);
  let ans = ask(), searched = false;
  if (knowledge.isWeak(ans) && allowSearch && (net.isExt || crawler.injected)) {
    const res = await crawler.google(spaced(product, question), 2, { label: "Câu hỏi thêm" });
    addPseudo(crawler, res.items, res.read); ans = ask(); searched = true;
  }
  const entry = { ...ans, pages_read: crawler.corpus.list({ real: true }).length };
  job.custom_answers = [...(job.custom_answers || []).filter((a) => a.question !== question), entry];
  job.queries = [...new Set([...(job.queries || []), ...crawler.queries])];
  await save(job, crawler);
  return { ...entry, searched };
}
export { loadCorpus };
