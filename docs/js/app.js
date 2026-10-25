// Giao diện và quy trình chạy hoàn toàn trên trình duyệt (GitHub Pages, không có máy chủ).
import * as core from "./core.js";
import { downloadEdits, downloadHistory, downloadJob, downloadLinks, readLinkFile } from "./excel.js";
import * as net from "./net.js";
import * as album from "./album.js";
import * as knowledge from "./knowledge.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = core.money;
const shortDate = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("T")[0].split("-"); return `${d}/${m}/${y}`; };
const dateTime = (iso) => (iso || "").replace("T", " ");
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
const uid = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));
const nowIso = () => new Date().toISOString().slice(0, 19);
function toast(msg) { const t = $("toast"); t.textContent = msg; t.style.display = "block"; setTimeout(() => (t.style.display = "none"), 2800); }

/* ------------------------------------------------------------------ lưu trữ (localStorage) */
const KEY_JOBS = "po_jobs", KEY_SET = "po_settings", KEY_UI = "po_ui";
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast("Không lưu được: bộ nhớ trình duyệt đầy hoặc bị chặn"); return false; } };
let jobs = load(KEY_JOBS, []), settings = load(KEY_SET, {}), ui = load(KEY_UI, {});
const persist = () => save(KEY_JOBS, jobs);
const getJob = (id) => jobs.find((j) => j.id === id);
const pendingImages = new Map(); // ảnh chỉ giữ trong bộ nhớ phiên, không lưu

let currentJobId = null, currentJob = null;

/* ------------------------------------------------------------------ mạng: tải trang, tìm kiếm, ảnh */
const SKIP_DOMAINS = ["youtube.com", "facebook.com", "tiktok.com", "wikipedia.org", "pinterest.", "bing.com", "yahoo.com", "google.", "reddit.com", "porn", "xxx", "xhamster", "sex", "baidu.com", "zhihu.com"];
const proxyReady = () => !!(settings.proxy && settings.proxy.includes("{url}") && settings.proxy_ok);
const proxied = (url) => settings.proxy.replace("{url}", encodeURIComponent(url));
function withTimeout(ms = 15000) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }

// Các sàn vẽ giá bằng JavaScript: fetch chỉ ra khung rỗng nên phải để trình duyệt thật mở trang.
const RENDER_DOMAINS = ["shopee.vn", "tiki.vn", "lazada.vn", "tiktok.com", "sendo.vn"];

// Bộ nhớ tạm trong phiên: trang đã tải ở bước tìm hiểu được dùng lại ở bước tìm NCC, khỏi mở lại (nhất là tab nền).
const htmlCache = new Map();
async function fetchHtml(url) {
  if (htmlCache.has(url)) return htmlCache.get(url);
  const html = await fetchHtmlUncached(url);
  if (htmlCache.size >= 30) htmlCache.delete(htmlCache.keys().next().value);
  htmlCache.set(url, html);
  return html;
}

/** Tải HTML. Tiện ích: fetch trực tiếp (không bị CORS), trang cần JavaScript hoặc fetch lỗi thì mở tab nền.
 *  Trang web thường: thử trực tiếp (chỉ được nếu website cho phép CORS), không được thì dùng proxy của người dùng. */
async function fetchHtmlUncached(url) {
  if (net.isExt) {
    if (!RENDER_DOMAINS.some((d) => core.domainOf(url).endsWith(d))) {
      try { const r = await fetch(url, { signal: withTimeout() }); if (r.ok) { const t = await r.text(); if (t.length > 2000) return t; } } catch { /* mở tab nền */ }
    }
    return (await net.renderPage(url, "html")).html;
  }
  try { const r = await fetch(url, { signal: withTimeout() }); if (r.ok) return await r.text(); } catch { /* thử proxy */ }
  if (!proxyReady()) throw new Error("Website chặn đọc trực tiếp (CORS) và chưa cấu hình proxy");
  const r = await fetch(proxied(url), { signal: withTimeout(25000) });
  if (!r.ok) throw new Error(`Proxy trả lỗi ${r.status}`);
  return r.text();
}
function filterDomains(urls, max) {
  const seen = new Set(), out = [];
  for (const u of urls) {
    const d = core.domainOf(u);
    if (!d || SKIP_DOMAINS.some((s) => d.includes(s)) || seen.has(d)) continue;
    seen.add(d); out.push(u); if (out.length >= max) break;
  }
  return out;
}
/* ------------------------------------------------------------------ tìm kiếm: crawl N TRANG KẾT QUẢ mỗi engine */
// "Trang" ở đây là trang kết quả của engine (1, 2, 3... như thanh phân trang), tối đa 10 trang mỗi engine; engine hết kết quả sớm thì dừng ở trang cuối.
// Kết quả của mọi trang (tiêu đề, đoạn mô tả, link) được thu thập; chỉ một phần link tốt nhất (MAX_DEEP) được mở ra đọc đầy đủ.
const PAGES_DEFAULT = 10, API_PAGE_CAP = 3, MAX_DEEP = 30;
const pagesPerEngine = () => Math.min(10, Math.max(1, parseInt(settings.serp_pages, 10) || PAGES_DEFAULT));
const ENGINE_NAMES = { googleweb: "Google", coccoc: "Cốc Cốc", duckduckgo: "DuckDuckGo", bing: "Bing", bravesearch: "Brave Search", google: "Google API", brave: "Brave API" };
const PAGE_FETCHERS = {
  googleweb: (q, p) => net.serpPage("googleweb", q, p),
  coccoc: (q, p) => net.serpPage("coccoc", q, p),
  bing: (q, p) => net.serpPage("bing", q, p),
  bravesearch: (q, p) => net.serpPage("bravesearch", q, p),
  duckduckgo: (q, p) => net.duckduckgoPage(q, p),
  async google(q, p) {
    const r = await fetch(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(settings.google_key)}&cx=${encodeURIComponent(settings.google_cx)}&q=${encodeURIComponent(q)}&num=10&start=${(p - 1) * 10 + 1}&gl=vn&lr=lang_vi`, { signal: withTimeout() });
    if (!r.ok) throw new Error(httpHint(r.status));
    const items = (await r.json()).items || [];
    return { results: items.map((i) => ({ url: i.link, title: i.title || "", snippet: i.snippet || "" })), raw: items.length };
  },
  async brave(q, p) {
    const target = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=20&offset=${p - 1}&country=vn&search_lang=vi`;
    const r = await fetch(net.isExt ? target : proxied(target), { headers: { "X-Subscription-Token": settings.brave_key, Accept: "application/json" }, signal: withTimeout(25000) });
    if (!r.ok) throw new Error(httpHint(r.status));
    const items = (await r.json()).web?.results || [];
    return { results: items.map((i) => ({ url: i.url, title: i.title || "", snippet: i.description || "" })), raw: items.length };
  },
};
function httpHint(status) {
  return `HTTP ${status}: ` + ({ 400: "yêu cầu không hợp lệ, kiểm tra khóa và ID", 401: "khóa không đúng", 403: "khóa chưa được cấp quyền hoặc hết hạn mức", 422: "khóa sai định dạng", 429: "hết hạn mức tạm thời" }[status] || "lỗi từ nhà cung cấp");
}
function engineStatus() {
  const ext = "Chỉ chạy khi cài làm tiện ích trình duyệt (Chrome, Cốc Cốc, Brave, Edge...)";
  // Thứ tự = thứ tự ưu tiên: engine chạy bằng trình duyệt (không cần khóa) đứng trước. Ba engine đầu tick sẵn.
  return [
    { id: "googleweb", label: "Google qua trình duyệt (không cần khóa)", available: net.isExt, reason: ext, recommended: true },
    { id: "coccoc", label: "Cốc Cốc (không cần khóa)", available: net.isExt, reason: ext, recommended: true },
    { id: "duckduckgo", label: "DuckDuckGo (không cần khóa)", available: net.isExt, reason: ext, recommended: true },
    { id: "bing", label: "Bing qua trình duyệt (không cần khóa)", available: net.isExt, reason: ext },
    { id: "bravesearch", label: "Brave Search qua trình duyệt (không cần khóa)", available: net.isExt, reason: ext },
    { id: "google", label: "Google (Custom Search API)", available: !!(settings.google_key && settings.google_cx), reason: "Chưa nhập Google API key và Search engine ID (tab Cài đặt)" },
    { id: "brave", label: net.isExt ? "Brave Search API" : "Brave Search API (qua proxy)", available: !!(settings.brave_key && (net.isExt || proxyReady())), reason: "Cần Brave API key (và proxy nếu không chạy dạng tiện ích)" },
  ];
}
/** Engine đang chọn (lưu trong trình duyệt, dùng chung cho tab Tư vấn và Yêu cầu mới). Mặc định: các engine ưu tiên không cần khóa. */
function selectedEngines() {
  const saved = ui.engines;
  return engineStatus().filter((e) => e.available && (saved ? saved.includes(e.id) : e.recommended || !net.isExt)).map((e) => e.id);
}

/**
 * Crawl `pages` trang kết quả của từng engine (chạy song song giữa các engine). Dừng sớm khi một trang không còn kết quả mới.
 * Engine API (Google, Brave) chỉ lấy tối đa API_PAGE_CAP trang để tiết kiệm hạn mức.
 * onProgress({ engine, page, pages, results, state: "start" | "done" | "end" | "error", message }).
 * Trả về { items: [{url,title,snippet,engine,page}], urls (link nên đọc sâu), errors, counts: {engine: {pages, results}} }.
 */
async function searchEngines(engines, query, pages = pagesPerEngine(), onProgress = null) {
  const items = [], errors = {}, counts = {};
  await Promise.all(engines.map(async (e) => {
    const cap = e === "google" || e === "brave" ? Math.min(pages, API_PAGE_CAP) : pages, seen = new Set();
    let read = 0, got = 0;
    for (let p = 1; p <= cap; p++) {
      onProgress && onProgress({ engine: e, page: p, pages: cap, results: got, state: "start" });
      let res;
      try { res = await PAGE_FETCHERS[e](query, p); } catch (err) { errors[e] = `trang ${p}: ${err.message}`; onProgress && onProgress({ engine: e, page: p, pages: cap, results: got, state: "error", message: err.message }); break; }
      const fresh = res.results.filter((r) => r.url && !seen.has(r.url));
      if (fresh.length) read++;
      for (const r of fresh) { seen.add(r.url); items.push({ ...r, engine: e, page: p }); got++; }
      onProgress && onProgress({ engine: e, page: p, pages: cap, results: got, state: fresh.length ? "done" : "end" });
      if (!fresh.length) break; // hết trang kết quả
    }
    counts[e] = { pages: read, results: got };
  }));
  return { items, urls: deepUrls(items, engines), errors, counts };
}
/** Chọn tối đa `max` link để đọc đầy đủ: xen kẽ theo engine, mỗi website một link, bỏ website không phải NCC. */
function deepUrls(items, engines, max = MAX_DEEP) {
  const lists = engines.map((e) => items.filter((i) => i.engine === e)), domains = new Set(), out = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)) && out.length < max; i++) for (const l of lists) {
    const it = l[i]; if (!it || out.length >= max) continue;
    const d = core.domainOf(it.url);
    if (!d || SKIP_DOMAINS.some((s) => d.includes(s)) || domains.has(d)) continue;
    domains.add(d); out.push(it.url);
  }
  return out;
}
const escHtml = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
/** Các kết quả không được đọc sâu vẫn dùng được: tiêu đề + đoạn mô tả của trang kết quả (có thể chứa giá, thông số). */
function serpPseudoPages(items, skip = new Set()) {
  return items.filter((i) => !skip.has(i.url)).map((i) => ({ url: i.url, pseudo: true, html: `<html><head><title>${escHtml(i.title)}</title></head><body><p>${escHtml(i.title)}. ${escHtml(i.snippet)}</p></body></html>` }));
}
const countsText = (counts) => Object.entries(counts).map(([e, c]) => `${ENGINE_NAMES[e] || e}: ${c.pages} trang, ${c.results} kết quả`).join("; ");
const progressText = (ev) => `${ENGINE_NAMES[ev.engine] || ev.engine}: ${ev.state === "start" ? `đang mở trang ${ev.page}/${ev.pages}` : ev.state === "end" ? `hết kết quả sau ${ev.page - 1} trang` : ev.state === "error" ? `lỗi (${ev.message})` : `xong trang ${ev.page}/${ev.pages}, ${ev.results} kết quả`}`;
async function pool(items, worker, size = 4, onTick = null) {
  const out = new Array(items.length); let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await worker(items[i]); onTick && onTick(++done, items.length); } }));
  return out;
}
async function analyzeImages(images) {
  if (!images.length || !settings.anthropic_key) return { keyword: "", text: "" };
  const content = images.slice(0, 4).map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.b64 } }));
  content.push({ type: "text", text: 'Đây là ảnh một sản phẩm cần mua. Trả về đúng một đối tượng JSON, không giải thích thêm, dạng {"keyword": "...", "text": "..."}. "keyword" là một dòng tiếng Việt ngắn làm từ khóa tìm kiếm (loại sản phẩm kèm thông số nhìn thấy). "text" là toàn bộ chữ đọc được trong ảnh, để trống nếu không có chữ.' });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: withTimeout(60000),
    headers: { "x-api-key": settings.anthropic_key, "anthropic-version": "2023-06-01", "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 400, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error(httpHint(r.status));
  const text = ((await r.json()).content || []).map((b) => b.text || "").join("");
  const m = /\{[\s\S]*\}/.exec(text); let data = {}; try { data = m ? JSON.parse(m[0]) : {}; } catch { /* bỏ qua */ }
  return { keyword: String(data.keyword || "").trim(), text: String(data.text || "").trim() };
}
const fileToImage = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader(); fr.onerror = reject;
  fr.onload = () => resolve({ name: file.name, mime: file.type || "image/jpeg", b64: String(fr.result).split(",")[1] });
  fr.readAsDataURL(file);
});

/* ------------------------------------------------------------------ quy trình xử lý yêu cầu */
function log(job, msg) { job.log.push(`${new Date().toLocaleTimeString("vi-VN")} ${msg}`); persist(); if (job.id === currentJobId) renderStatus(job); }

async function createJob(form, images) {
  const job = {
    id: uid(), status: "awaiting_confirmation", created: nowIso(), query: form.query, product_code: form.product_code, quantity: form.quantity,
    purpose: form.purpose, engines: form.engines, seed_urls: form.seed_urls, topics: [], research_on: form.research_on, advice: form.advice, advice_budget: form.advice ? form.advice.input?.budget || null : null, extra_keywords: form.extra_keywords, crawl_images: form.crawl_images,
    images: images.map((i) => i.name), suggested_name: null, ocr_text: "", questions: [], answers: {}, spec: {}, keywords: null, errors: {}, log: [],
    suppliers: [], research: {}, sites_searched: [], edits: [], price_stats: null, analysis: { negotiation: [], persuasion: { title: "", sections: [], points: [], closing: "" } }, error: null,
  };
  log(job, "Đã nhận yêu cầu, chờ bạn xác nhận thông tin sản phẩm");
  if (images.length) {
    pendingImages.set(job.id, images);
    try { const seen = await analyzeImages(images); job.suggested_name = seen.keyword || null; job.ocr_text = seen.text; } catch (e) { log(job, `Không nhận diện được ảnh: ${e.message}`); }
    if (job.suggested_name) log(job, `Nhận diện từ ảnh: ${job.suggested_name}`);
    if (job.ocr_text) log(job, `Chữ đọc được trong ảnh: ${job.ocr_text.slice(0, 120)}`);
    if (!job.suggested_name && !job.ocr_text) log(job, "Chưa đọc được ảnh (cần Anthropic API key trong tab Cài đặt), hãy nhập tên sản phẩm");
  }
  job.status = "researching"; job.discovery = null;
  jobs.unshift(job); persist();
  return job;
}

const jobProgress = (job) => (ev) => { if (ev.state !== "start") log(job, progressText(ev)); };

/** Tìm hiểu sản phẩm trên web trước khi hỏi: crawl các trang kết quả, đọc các trang tốt nhất, rút tên/model/thông số/mục đích,
 *  rồi mới dựng question card. Nếu đã nạp dữ liệu từ tab Tư vấn (file .json) thì dùng luôn, không crawl lại. */
async function prepareCards(job) {
  const subject = job.query || job.suggested_name || job.product_code;
  const engines = job.engines.filter((e) => engineStatus().find((s) => s.id === e)?.available);
  if (job.advice && job.advice.discovery) {
    job.discovery = job.advice.discovery; job.research = job.advice.research || {};
    job.advice = { created: job.advice.created, query: job.advice.input?.query }; // giữ dấu vết, bỏ bản sao dữ liệu lớn
    const d = job.discovery;
    log(job, `Dùng dữ liệu từ tab Tư vấn (${d.total} trang đúng sản phẩm, nhóm ngành ${core.CATEGORIES[d.category]?.label || ""}), không crawl lại`);
  } else if (subject && (engines.length || job.seed_urls.length)) {
    try {
      const pages = pagesPerEngine();
      log(job, `Đang tìm hiểu "${subject}" trên web: crawl tối đa ${pages} trang kết quả mỗi engine...`);
      let urls = [...job.seed_urls], items = [];
      if (engines.length) {
        const res = await searchEngines(engines, `${subject} ${job.product_code}`.trim(), pages, jobProgress(job));
        items = res.items; urls = [...new Set([...urls, ...res.urls])];
        log(job, `Tổng kết crawl: ${countsText(res.counts)}`);
        for (const [e, m] of Object.entries(res.errors)) log(job, `Engine ${ENGINE_NAMES[e] || e} lỗi: ${m}`);
      }
      log(job, `Đang đọc đầy đủ ${urls.length} trang web, dùng thêm tiêu đề và mô tả của ${items.filter((i) => !urls.includes(i.url)).length} kết quả còn lại...`);
      const read = await pool(urls, async (url) => { try { return { url, html: await fetchHtml(url) }; } catch { return null; } });
      job.discovery = core.buildDiscovery([...read, ...serpPseudoPages(items, new Set(urls.filter((_, i) => read[i])))], core.queryKeywords(subject), subject);
      const d = job.discovery;
      log(job, `Đọc được ${read.filter(Boolean).length}/${urls.length} trang, ${d.total} nguồn đúng sản phẩm, nhóm ngành: ${core.CATEGORIES[d.category].label}` + (d.price ? `, giá thấy trên web ${money(d.price.min)} đến ${money(d.price.max)}` : ""));
    } catch (e) { log(job, `Không tìm hiểu được trên web: ${e.message}`); }
  } else log(job, "Chưa có engine hoặc link NCC nên không tìm hiểu trước trên web, dùng gợi ý chung");
  job.questions = core.buildCards(job, job.suggested_name, job.ocr_text, job.discovery);
  job.status = "awaiting_confirmation"; log(job, "Chờ bạn xác nhận thông tin sản phẩm");
}

async function runJob(job) {
  try {
    job.status = "running"; log(job, "Bắt đầu tìm kiếm");
    job.keywords = core.searchKeywords(job); log(job, `Từ khóa tìm kiếm: ${job.keywords}`);
    const tokens = core.queryKeywords(`${job.keywords} giá mua`);
    const engines = job.engines.filter((e) => engineStatus().find((s) => s.id === e)?.available);
    let searched = [];
    if (engines.length) {
      const pages = Math.min(pagesPerEngine(), 3); // bước tìm NCC chỉ cần vài trang đầu, phần tìm hiểu rộng đã crawl đủ trang ở trên
      log(job, `Tìm NCC trên ${engines.map((e) => ENGINE_NAMES[e] || e).join(", ")}: ${pages} trang kết quả mỗi engine`);
      const res = await searchEngines(engines, `${job.keywords} giá mua`, pages, jobProgress(job));
      searched = res.urls; job.errors = res.errors;
      log(job, `Tổng kết crawl: ${countsText(res.counts)}`);
      for (const [e, m] of Object.entries(res.errors)) log(job, `Engine ${ENGINE_NAMES[e] || e} lỗi: ${m}`);
    } else if (job.engines.length) log(job, "Engine đã chọn chưa dùng được, chỉ dùng link nhập tay");
    const seeds = job.seed_urls, urls = [...new Set([...seeds, ...searched])];
    job.sites_searched = urls;
    let unreadable = 0;
    log(job, `Đang đọc ${urls.length} trang NCC...`);
    const results = await pool(urls, async (url) => {
      try { return { url, supplier: core.parsePage(await fetchHtml(url), url, tokens, job.product_code) }; }
      catch (e) { return { url, error: e.message }; }
    });
    const found = [];
    for (const r of results) {
      if (r.supplier && (r.supplier.relevance >= 0.5 || seeds.includes(r.url))) found.push({ id: uid(), quantity: job.quantity, ...r.supplier });
      else if (r.error && seeds.includes(r.url)) { unreadable++; found.push({ ...placeholder(r.url, r.error), quantity: job.quantity }); }
    }
    log(job, `Đã thử ${urls.length} trang, đọc được ${found.filter((s) => !s.unreadable).length} trang, ${unreadable} trang cần nhập tay`);
    job.suppliers = found;
    if (job.crawl_images !== false && net.isExt) {
      log(job, "Đang crawl ảnh về album...");
      const res = await album.crawlAlbum(job.id, job.keywords, 12, engines, (src, n, err) => log(job, err ? `Ảnh ${src}: lỗi ${err}` : `Ảnh ${src}: lấy được ${n} ảnh`));
      log(job, res.error ? `Album: ${res.error}` : `Album: thêm ${res.added.length} ảnh (đã thử ${res.tried} ảnh)`);
    }
    if (job.research_on !== false && !Object.keys(job.research || {}).length) {
      log(job, "Đang tìm hiểu sản phẩm theo nhóm ngành hàng (giá, hãng, ưu nhược điểm, công nghệ, lưu ý khi mua)...");
      try { await researchJob(job, engines, urls); } catch (e) { log(job, `Không tìm hiểu được thêm: ${e.message}`); }
    }
    buildOutputs(job);
    job.status = "done";
    log(job, found.length ? "Đã xếp hạng NCC và lập kịch bản" : "Chưa có NCC nào. Bấm '+ Thêm NCC' để nhập tay hoặc thêm link ở yêu cầu sau");
  } catch (e) { job.status = "error"; job.error = e.message; log(job, `Lỗi: ${e.message}`); }
  persist(); if (job.id === currentJobId) { currentJob = job; renderAll(job); }
}
function placeholder(url, reason) {
  return { id: uid(), name: core.domainOf(url) || "NCC", title: url, url, description: "", date: null, price: null, vat: null, vat_included: false, mah: null, volt: null,
    warranty_months: null, relevance: 1, contacts: {}, note: `Không đọc tự động được (${reason}). Hãy mở link và nhập tay.`, unreadable: true };
}
/** Tìm hiểu sản phẩm theo nhóm ngành: tìm thêm 3 lượt (giá/hãng, ưu nhược điểm/công nghệ, lưu ý khi mua), mỗi lượt 2 trang kết quả,
 *  đọc các trang tốt nhất rồi trả lời bộ câu hỏi của ngành bằng câu trích từ trang (kèm nguồn). Dùng lại trang đã tải ở bước trước.
 *  onStage(text, fraction) báo tiến trình cho giao diện. */
async function researchProduct(subject, engines, knownUrls = [], seeds = [], onProgress = null, onStage = null, knownItems = []) {
  const plan = knowledge.planKnowledge(subject, core.detectCategory(subject));
  let urls = [...knownUrls, ...seeds], items = [...knownItems];
  if (engines.length) {
    for (const [i, q] of plan.queries.entries()) {
      onStage && onStage(`Tìm bổ sung ${i + 1}/${plan.queries.length}: ${q.query}`, i / plan.queries.length);
      const res = await searchEngines(engines, q.query, 2, onProgress);
      urls.push(...res.urls.slice(0, 10)); items.push(...res.items);
    }
  }
  urls = [...new Set(urls)].slice(0, 60);
  const pages = await pool(urls, async (url) => { try { return { url, html: await fetchHtml(url) }; } catch { return null; } }, 4, (done, total) => onStage && onStage(`Đọc trang ${done}/${total}`, done / total));
  const pseudo = serpPseudoPages(items, new Set(urls.filter((_, i) => pages[i])));
  onStage && onStage("Trả lời bộ câu hỏi theo ngành hàng", 1);
  return { plan, research: knowledge.answerKnowledge(plan, [...pages, ...pseudo], core.queryKeywords(subject)), pages, read: pages.filter(Boolean).length, total: urls.length };
}
async function researchJob(job, engines, knownUrls) {
  const r = await researchProduct(job.query, engines, knownUrls, job.seed_urls, jobProgress(job));
  job.research = r.research; job.knowledge_plan = { category: r.plan.category, label: r.plan.categoryLabel };
  const answered = Object.values(r.research).filter((x) => x.snippets.length || x.brands?.length).length;
  log(job, `Nhóm ngành ${r.plan.categoryLabel}: đọc ${r.read}/${r.total} trang, trả lời được ${answered}/${Object.keys(r.research).length} câu hỏi tìm hiểu`);
}
function buildOutputs(job) {
  job.suppliers = core.scoreSuppliers(job.suppliers, job.spec?.vat_required !== false, job.spec?.budget || null);
  job.price_stats = core.priceStats(job.suppliers);
  job.analysis = core.buildInsights(job.suppliers, job.quantity, { product: job.query, spec: core.specText(job.spec), purpose: job.purpose, research: job.research });
}

/* ------------------------------------------------------------------ sửa ô, thêm/xóa NCC (tự lưu) */
function addEdit(job, supplier, field_label, oldV, newV) {
  job.edits.push({ time: nowIso(), supplier: supplier.name, id: supplier.id, field: field_label, field_label, old: oldV ?? "", new: newV ?? "" });
}
function updateSupplier(job, id, field, value) {
  if (job.status !== "done") throw new Error("Chỉ sửa được khi yêu cầu đã xử lý xong");
  const s = job.suppliers.find((x) => x.id === id); if (!s) throw new Error("Không tìm thấy NCC trong bảng");
  const nv = core.parseField(field, value), ov = s[field] ?? null;
  if (nv === ov) return false;
  addEdit(job, s, core.EDIT_LABELS[field], ov, nv);
  s[field] = nv; if (field === "price") s.vat_included = false; if (field === "note") s.unreadable = s.unreadable && !nv;
  buildOutputs(job); persist(); return true;
}
function addSupplier(job) {
  const s = { id: uid(), name: "NCC mới", title: "", url: "", description: "", date: null, price: null, vat: null, vat_included: false, mah: null, volt: null, warranty_months: null, relevance: 1, contacts: {}, note: "", manual: true };
  job.suppliers.push(s); addEdit(job, s, "Thêm NCC", "", s.name); buildOutputs(job); persist();
}
function removeSupplier(job, id) {
  const s = job.suppliers.find((x) => x.id === id); if (!s) return;
  addEdit(job, s, "Xóa NCC", s.name, ""); job.suppliers = job.suppliers.filter((x) => x.id !== id); buildOutputs(job); persist();
}

/* ------------------------------------------------------------------ giao diện: tab, giao diện sáng/tối */
const TABS = ["advice", "new", "history", "edits", "settings"];
function showTab(name) {
  TABS.forEach((t) => ($("tab-" + t).hidden = t !== name));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  if (name === "history") renderHistory();
  if (name === "edits") renderEditsTab();
  if (name === "settings") loadSettingsForm();
}
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
document.querySelectorAll("[data-goto]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); showTab(a.dataset.goto); }));
if (ui.theme === "dark") document.body.classList.add("dark");
$("theme-btn").addEventListener("click", () => { document.body.classList.toggle("dark"); ui.theme = document.body.classList.contains("dark") ? "dark" : "light"; save(KEY_UI, ui); });

/* ------------------------------------------------------------------ form yêu cầu */
/** Hai nơi chọn engine (tab Tư vấn và Yêu cầu mới) dùng chung một lựa chọn, lưu trong trình duyệt. */
function renderEngines() {
  const chosen = new Set(selectedEngines());
  const html = engineStatus().map((e) => `<label class="chip ${e.available ? "" : "off"}" title="${esc(e.available ? "" : e.reason)}">
    <input type="checkbox" data-engine="${e.id}" ${chosen.has(e.id) ? "checked" : ""} ${e.available ? "" : "disabled"}> ${esc(e.label)}${e.available ? "" : e.recommended || e.reason.startsWith("Chỉ chạy") ? " (cần cài tiện ích)" : " (chưa cấu hình)"}</label>`).join("");
  for (const id of ["engines", "engines-advice"]) {
    const box = $(id); if (!box) continue;
    box.innerHTML = html;
    box.querySelectorAll("[data-engine]").forEach((cb) => cb.addEventListener("change", () => {
      ui.engines = [...box.querySelectorAll("[data-engine]:checked")].map((c) => c.dataset.engine); save(KEY_UI, ui); renderEngines();
    }));
  }
}
function renderPagesSelect() {
  for (const id of ["serp-pages", "adv-serp-pages"]) {
    const el = $(id); if (!el) continue;
    el.value = String(pagesPerEngine());
    el.onchange = () => { settings.serp_pages = +el.value; save(KEY_SET, settings); renderPagesSelect(); };
  }
}
$("link-file").addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const urls = await readLinkFile(file);
    $("seed-urls").value = [$("seed-urls").value.trim(), ...urls].filter(Boolean).join("\n");
    $("link-status").textContent = `Đã nhập ${urls.length} link từ ${file.name}`;
  } catch (err) { $("link-status").textContent = `Không đọc được file: ${err.message}`; }
  e.target.value = "";
});
$("request-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("query").value.trim(), code = $("product-code").value.trim(), files = [...$("images").files];
  if (!query && !code && !files.length) { showError("Nhập tên hoặc mã sản phẩm, hoặc chọn ảnh"); return; }
  const quantity = parseInt($("quantity").value, 10);
  if (!(quantity >= 1)) { showError("Số lượng phải là số nguyên dương"); return; }
  $("submit-btn").disabled = true; $("result-card").hidden = true; $("status-card").hidden = true;
  const form = {
    query, product_code: code, quantity, purpose: $("purpose").value.trim(), extra_keywords: $("extra-keywords").value.trim(),
    engines: selectedEngines(), seed_urls: core.parseUrls($("seed-urls").value),
    research_on: $("research-on").checked, advice: pendingAdvice,
    crawl_images: $("crawl-images").checked,
  };
  try {
    const images = await Promise.all(files.map(fileToImage));
    const job = await createJob(form, images);
    pendingAdvice = null; $("advice-loaded").hidden = true;
    if (files.length) await album.addUploads(job.id, files);
    currentJobId = job.id; currentJob = job; $("status-card").hidden = false;
    await prepareCards(job); persist(); renderStatus(job); showCards(job);
  } catch (err) { showError(err.message); }
  $("submit-btn").disabled = false;
});
function showError(msg) { $("status-card").hidden = false; $("error").textContent = msg; }

/* ------------------------------------------------------------------ question card */
function showCards(job) {
  $("cards-card").hidden = false; $("cards-error").textContent = ""; $("confirm-btn").disabled = false;
  const d = job.discovery;
  $("cards-sources").innerHTML = d && d.total ? `<div class="notice">Đã tìm hiểu trên web: đọc ${d.read} trang, ${d.total} trang đúng sản phẩm.${d.price ? ` Giá thấy trên web ${esc(money(d.price.min))} đến ${esc(money(d.price.max))}.` : ""}
    <details><summary>Các trang đã dùng</summary><ul class="points">${d.pages.map((p) => `<li><a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(p.domain)}</a> · ${esc(p.title)}</li>`).join("")}</ul></details></div>`
    : '<div class="notice">Chưa đọc được trang web nào về sản phẩm này nên các lựa chọn dưới đây chỉ là gợi ý chung.</div>';
  $("cards").innerHTML = job.questions.map((card) => `<div class="block q-card"><div class="q-title">${esc(card.title)}</div><div class="muted">${esc(card.question)}</div>${card.evidence ? `<div class="muted">${esc(card.evidence)}</div>` : ""}
    ${card.options.map((o) => `<label class="opt"><input type="radio" name="card-${esc(card.id)}" value="${esc(o.value)}" ${o.value === card.default ? "checked" : ""}> ${esc(o.label)}</label>`).join("")}
    <input type="text" class="custom" data-custom="${esc(card.id)}" placeholder="Nhập nội dung khác"></div>`).join("");
  document.querySelectorAll("#cards input[type=radio]").forEach((r) => r.addEventListener("change", () => r.closest(".q-card").querySelector(".custom").classList.toggle("show", r.value === core.CUSTOM && r.checked)));
  $("cards-card").scrollIntoView({ behavior: "smooth" });
}
$("confirm-btn").addEventListener("click", () => {
  const job = currentJob; if (!job || job.status !== "awaiting_confirmation") return;
  const answers = {};
  for (const card of job.questions) {
    const checked = document.querySelector(`input[name="card-${card.id}"]:checked`), custom = document.querySelector(`[data-custom="${card.id}"]`);
    answers[card.id] = { value: checked ? checked.value : "", custom: custom ? custom.value.trim() : "" };
  }
  try { core.applyAnswers(job, answers); } catch (err) { $("cards-error").textContent = err.message; return; }
  if (!job.engines.length && !job.seed_urls.length) { $("cards-error").textContent = "Cần chọn ít nhất một engine có khóa hoặc nhập link NCC (hoặc thêm NCC thủ công sau)."; }
  $("cards-card").hidden = true; job.status = "queued"; log(job, `Đã xác nhận: ${job.query} | số lượng ${job.quantity}`);
  $("status-card").hidden = false; runJob(job);
});

/* ------------------------------------------------------------------ hiển thị tiến trình + kết quả */
function renderStatus(job) {
  $("status-card").hidden = false;
  $("status-text").textContent = `Trạng thái: ${job.status}` + (job.keywords ? ` | Từ khóa: ${job.keywords}` : "");
  $("log").textContent = job.log.join("\n"); $("error").textContent = job.error || "";
}
function renderAll(job) { renderStatus(job); if (job.status === "done") renderResult(job); }
function renderResult(job) {
  $("result-card").hidden = false;
  const unread = job.suppliers.filter((s) => s.unreadable).length;
  $("manual-notice").hidden = !unread && job.suppliers.length > 0;
  $("manual-notice").textContent = job.suppliers.length ? `${unread} NCC không đọc tự động được (website chặn). Mở link và nhập tay giá, bảo hành, VAT vào bảng.` : "Chưa có NCC nào. Bấm '+ Thêm NCC' để nhập tay, hoặc tạo yêu cầu mới có link NCC.";
  renderTable(job); renderPrice(job); renderAlbum(job); renderResearch(job); renderAnalysis(job);
}

/* ------------------------------------------------------------------ album ảnh đối chiếu */
let albumUrls = [];
async function renderAlbum(job) {
  const photos = (await album.listPhotos(job.id)).sort((a, b) => (a.source === "upload" ? -1000 : -(a.match ?? -1)) - (b.source === "upload" ? -1000 : -(b.match ?? -1)));
  if (job.id !== currentJobId) return;
  albumUrls.forEach((u) => URL.revokeObjectURL(u)); albumUrls = [];
  $("album").innerHTML = photos.length ? photos.map((p) => {
    const src = URL.createObjectURL(p.blob); albumUrls.push(src);
    const badge = p.source === "upload" ? '<span class="badge high">Ảnh bạn up</span>' : p.match != null && p.match >= 70 ? `<span class="badge ${p.match >= 80 ? "high" : ""}">Giống ảnh up ${p.match}%</span>` : "";
    return `<div class="photo"><img src="${src}" data-zoom alt="${esc(p.title)}"><div class="cap">${badge}<span class="t" title="${esc(p.title)}">${esc(p.title || "(không tiêu đề)")}</span>
      <span class="muted">${p.width}×${p.height} · ${esc(p.engine)}</span>
      <span>${safeUrl(p.page_url) ? `<a href="${esc(p.page_url)}" target="_blank" rel="noopener">Trang nguồn</a> · ` : ""}<a href="#" data-del-photo="${esc(p.id)}">Xóa</a></span></div></div>`;
  }).join("") : `<p class="muted">Chưa có ảnh. ${net.isExt ? 'Bấm "Tìm thêm ảnh" hoặc "Up ảnh của bạn".' : "Crawl ảnh chỉ chạy khi cài làm tiện ích Cốc Cốc/Chrome, bạn vẫn up ảnh của mình được."}</p>`;
  document.querySelectorAll("#album [data-zoom]").forEach((img) => img.addEventListener("click", () => { $("lightbox").querySelector("img").src = img.src; $("lightbox").classList.add("show"); }));
  document.querySelectorAll("[data-del-photo]").forEach((a) => a.addEventListener("click", async (e) => { e.preventDefault(); await album.deletePhoto(a.dataset.delPhoto); renderAlbum(job); }));
}
$("lightbox").addEventListener("click", () => $("lightbox").classList.remove("show"));
$("album-more").addEventListener("click", async () => {
  if (!currentJob) return;
  $("album-more").disabled = true; $("album-state").textContent = "Đang tìm và tải ảnh...";
  const res = await album.crawlAlbum(currentJob.id, $("album-query").value.trim() || currentJob.keywords || currentJob.query);
  $("album-more").disabled = false;
  $("album-state").textContent = res.error || (res.added.length ? `Đã thêm ${res.added.length} ảnh` : "Không có ảnh mới, thử từ khóa khác");
  renderAlbum(currentJob);
});
$("album-upload").addEventListener("change", async (e) => {
  if (!currentJob || !e.target.files.length) return;
  const added = await album.addUploads(currentJob.id, [...e.target.files]); e.target.value = "";
  $("album-state").textContent = added.length ? `Đã thêm ${added.length} ảnh của bạn` : "Không có ảnh hợp lệ hoặc ảnh đã có";
  renderAlbum(currentJob);
});

const COLUMNS = [
  { key: "name", label: "NCC" }, { key: "product", label: "Tên sản phẩm" }, { key: "qty", label: "Số lượng" }, { key: "price", label: "Đơn giá" },
  { key: "vat", label: "VAT" }, { key: "info", label: "Thông tin sản phẩm" }, { key: "date", label: "Ngày cập nhật" },
  { key: "contact", label: "Liên hệ" }, { key: "score", label: "Điểm" }, { key: "status", label: "Trạng thái" }, { key: "del", label: "" },
];
let hiddenCols = new Set(ui.hiddenCols || []);
function buildColMenu() {
  $("col-menu").innerHTML = COLUMNS.filter((c) => c.label).map((c) => `<label><input type="checkbox" data-col-toggle="${c.key}" ${hiddenCols.has(c.key) ? "" : "checked"} ${c.key === "name" ? "disabled" : ""}> ${esc(c.label)}</label>`).join("") + '<button type="button" class="secondary small" id="col-reset" style="margin-top:6px">Hiện tất cả</button>';
  document.querySelectorAll("[data-col-toggle]").forEach((cb) => cb.addEventListener("change", () => { cb.checked ? hiddenCols.delete(cb.dataset.colToggle) : hiddenCols.add(cb.dataset.colToggle); ui.hiddenCols = [...hiddenCols]; save(KEY_UI, ui); applyColumns(); }));
  $("col-reset").addEventListener("click", () => { hiddenCols.clear(); ui.hiddenCols = []; save(KEY_UI, ui); buildColMenu(); applyColumns(); });
}
const applyColumns = () => document.querySelectorAll("#result-table [data-col]").forEach((el) => (el.hidden = hiddenCols.has(el.dataset.col)));
function applyFilters() {
  if (!currentJob) return;
  const text = $("filter-text").value.trim().toLowerCase(), mode = $("filter-status").value;
  document.querySelectorAll("#result-table tbody tr").forEach((tr) => {
    const s = currentJob.suppliers.find((x) => x.id === tr.dataset.id) || {};
    let ok = !text || tr.textContent.toLowerCase().includes(text);
    if (mode === "recommended") ok = ok && s.recommended; if (mode === "eligible") ok = ok && s.eligible;
    if (mode === "excluded") ok = ok && !s.eligible; if (mode === "priced") ok = ok && !!s.price;
    tr.hidden = !ok;
  });
}
$("filter-text").addEventListener("input", applyFilters); $("filter-status").addEventListener("change", applyFilters);

const editable = (s, field, text) => `<span contenteditable="true" spellcheck="false" data-edit="${field}" data-id="${esc(s.id)}" data-orig="${esc(text)}">${esc(text)}</span>`;
function renderTable(job) {
  const wrap = $("table-wrap"), left = wrap.scrollLeft, top = wrap.scrollTop;
  const rows = job.suppliers.map((s) => {
    const cls = s.recommended ? "recommended" : s.eligible ? "" : "excluded";
    const vatNow = s.vat === true ? "Có" : s.vat === false ? "Không" : "Chưa rõ";
    const vatSel = `<select data-edit="vat" data-id="${esc(s.id)}" data-orig="${vatNow}">${["Có", "Không", "Chưa rõ"].map((o) => `<option ${o === vatNow ? "selected" : ""}>${o}</option>`).join("")}</select>`;
    const status = (s.recommended ? "★ Khuyến nghị" : s.eligible ? "Đủ điều kiện" : esc(s.reason)) + (s.over_budget ? " · vượt ngân sách" : "");
    return `<tr class="${cls}" data-id="${esc(s.id)}">
      <td data-col="name">${safeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="Mở website">↗</a> ` : ""}${editable(s, "name", s.name)}</td>
      <td data-col="product">${editable(s, "product_name", s.product_name || s.title || job.query)}</td>
      <td data-col="qty">${editable(s, "quantity", String(s.quantity ?? job.quantity))}</td>
      <td data-col="price">${editable(s, "price", s.price ? String(s.price) : "")}${s.vat_included ? '<div class="muted">(đã gồm VAT)</div>' : ""}</td>
      <td data-col="vat">${vatSel}</td>
      <td data-col="info"><div class="info-line">${esc(core.supplierInfo(s))}</div>${s.note ? `<div class="muted">${esc(s.note)}</div>` : ""}<button type="button" class="secondary small" data-info="${esc(s.id)}">Sửa thông tin</button></td>
      <td data-col="date">${editable(s, "date", shortDate(s.date))}</td>
      <td data-col="contact"><button type="button" class="secondary small" data-contact="${esc(s.id)}">Liên hệ NCC</button></td>
      <td data-col="score">${s.score ?? "-"}</td><td data-col="status">${status}</td>
      <td data-col="del"><button type="button" class="secondary small danger" data-del="${esc(s.id)}" title="Xóa NCC này">✕</button></td></tr>`;
  }).join("");
  $("result-table").innerHTML = `<table><thead><tr>${COLUMNS.map((c) => `<th data-col="${c.key}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
  document.querySelectorAll("#result-table td[data-col]").forEach((td) => { td.dataset.label = COLUMNS.find((c) => c.key === td.dataset.col)?.label || ""; }); // nhãn cho giao diện điện thoại
  document.querySelectorAll("[data-contact]").forEach((b) => b.addEventListener("click", () => openContact(b.dataset.contact)));
  document.querySelectorAll("[data-info]").forEach((b) => b.addEventListener("click", () => openInfoEditor(b.dataset.info)));
  document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    const s = job.suppliers.find((x) => x.id === b.dataset.del); if (!s || !confirm(`Xóa NCC "${s.name}" khỏi bảng?`)) return;
    removeSupplier(job, s.id); renderResult(job); $("save-state").textContent = "Đã tự lưu " + new Date().toLocaleTimeString("vi-VN");
  }));
  document.querySelectorAll("#result-table [data-edit]").forEach((el) => {
    if (el.tagName === "SELECT") el.addEventListener("change", () => saveEdit(el));
    else { el.addEventListener("blur", () => saveEdit(el)); el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } if (e.key === "Escape") { el.textContent = el.dataset.orig; el.blur(); } }); }
  });
  applyColumns(); applyFilters(); wrap.scrollLeft = left; wrap.scrollTop = top;
}
function saveEdit(el) {
  const value = el.tagName === "SELECT" ? el.value : el.textContent.trim();
  if (value === el.dataset.orig) return;
  try {
    if (updateSupplier(currentJob, el.dataset.id, el.dataset.edit, value)) { renderResult(currentJob); $("save-state").textContent = "Đã tự lưu " + new Date().toLocaleTimeString("vi-VN"); }
  } catch (err) { toast(err.message); el.tagName === "SELECT" ? (el.value = el.dataset.orig) : (el.textContent = el.dataset.orig); }
}
$("add-supplier").addEventListener("click", () => { if (!currentJob) return; addSupplier(currentJob); renderResult(currentJob); $("save-state").textContent = "Đã thêm NCC, sửa các ô để nhập thông tin"; });
(function dragScroll() {
  const wrap = $("table-wrap"); let drag = false, sx = 0, sy = 0, sl = 0, st = 0;
  wrap.addEventListener("mousedown", (e) => { if (e.target.closest("[contenteditable],select,button,a,input")) return; drag = true; sx = e.clientX; sy = e.clientY; sl = wrap.scrollLeft; st = wrap.scrollTop; wrap.classList.add("dragging"); });
  window.addEventListener("mousemove", (e) => { if (!drag) return; wrap.scrollLeft = sl - (e.clientX - sx); wrap.scrollTop = st - (e.clientY - sy); });
  window.addEventListener("mouseup", () => { drag = false; wrap.classList.remove("dragging"); });
})();

function renderPrice(job) {
  const st = job.price_stats;
  $("price-stats").innerHTML = st ? `<div class="stat">Giá trung bình<b>${money(st.mean)}</b></div><div class="stat">Trung vị<b>${money(st.median)}</b></div><div class="stat">Thấp nhất<b>${money(st.min)}</b></div><div class="stat">Cao nhất<b>${money(st.max)}</b></div><div class="stat">Số NCC có giá<b>${st.count}</b></div>` : "";
  const priced = job.suppliers.filter((s) => s.price).sort((a, b) => a.price - b.price);
  if (!priced.length) { $("price-bars").innerHTML = '<p class="muted">Chưa có giá để so sánh.</p>'; return; }
  const max = Math.max(...priced.map((s) => s.price)), min = priced[0].price;
  $("price-bars").innerHTML = priced.map((s) => `<div class="bar-row"><div class="bar-label" title="${esc(s.name)}">${esc(s.name)}</div><div class="bar-track"><div class="bar-fill ${s.recommended ? "best" : ""}" style="width:${(s.price / max * 100).toFixed(1)}%"></div></div><div class="bar-value">${money(s.price)} · ${(s.price / min * 100).toFixed(0)}%</div></div>`).join("") + '<p class="muted">Tỷ lệ % tính theo NCC có giá thấp nhất (100%).</p>';
}
const snippetList = (snippets) => (snippets.length ? `<ul class="points">${snippets.map((s) => `<li>${esc(s.text)} <a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">[nguồn]</a></li>`).join("")}</ul>` : '<p class="muted">Chưa tìm được câu trả lời rõ ràng trên các trang đã đọc.</p>');
function researchBlock(r) {
  const brands = r.brands && r.brands.length ? `<div class="chips">${r.brands.map((b) => `<span class="chip static">${esc(b.value)} · ${b.count} trang</span>`).join("")}</div>` : "";
  const price = r.price ? `<div class="chips"><span class="chip static">Thấp nhất ${esc(money(r.price.min))}</span><span class="chip static">Trung vị ${esc(money(r.price.median))}</span><span class="chip static">Cao nhất ${esc(money(r.price.max))}</span></div>` : "";
  return `<div class="block"><h4>${esc(r.label)}</h4><div class="muted">${esc(r.query)}</div>${price}${brands}${snippetList(r.snippets)}</div>`;
}
function renderResearch(job) {
  const entries = Object.entries(job.research || {}); $("research-wrap").hidden = !entries.length;
  const info = job.knowledge_plan ? `<p class="muted">Nhóm ngành nhận diện: <b>${esc(job.knowledge_plan.label)}</b>. Câu trả lời là câu trích nguyên văn từ các trang đã crawl, hãy mở nguồn để kiểm tra.</p>` : "";
  const groups = new Map();
  for (const [, r] of entries) { const g = r.group_label || r.label; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  $("research").innerHTML = info + [...groups].map(([g, list]) => `<details class="guide" open><summary>${esc(g)}</summary>${list.map(researchBlock).join("")}</details>`).join("");
}
const list = (title, items) => (items && items.length ? `<h4>${title}</h4><ul class="points">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
function renderAnalysis(job) {
  const neg = job.analysis.negotiation || [];
  $("negotiation").innerHTML = neg.length ? neg.map((n) => `<div class="block"><b>${esc(n.ncc)}</b> · Giá hiện tại ${money(n.current_price)} · Dự phòng: ${esc(n.backup)}<p class="muted">${esc(n.target_note)}</p>
    ${list("Điểm mạnh thương lượng (từ dữ liệu thu thập)", n.leverage)}${list("Câu hỏi cần làm rõ với NCC", n.questions)}${list("Chiến lược thuyết phục NCC", n.strategies)}${list("Các bước đàm phán theo quy trình mua hàng", n.steps)}
    ${n.references.length ? `<h4>Căn cứ tham khảo trên web</h4><ul class="points">${n.references.map((r) => `<li>[${esc(r.topic)}] ${esc(r.text)} <a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">[nguồn]</a></li>`).join("")}</ul>` : ""}</div>`).join("") : '<p class="muted">Chưa có NCC khuyến nghị.</p>';
  const p = job.analysis.persuasion || {};
  $("persuasion").innerHTML = p.title ? `<p><b>${esc(p.title)}</b></p>${p.sections.map((s) => `<div class="block">${list(esc(s.heading), s.points)}</div>`).join("")}<div class="closing">${esc(p.closing)}</div>` : '<p class="muted">Chưa có luận điểm.</p>';
}
$("print-btn").addEventListener("click", () => window.print());
$("copy-persuasion").addEventListener("click", () => { const t = core.persuasionText(currentJob?.analysis.persuasion); if (t) navigator.clipboard.writeText(t).then(() => toast("Đã sao chép")); });

/* ------------------------------------------------------------------ liên hệ NCC */
/** Sửa "Thông tin sản phẩm" của một NCC: pin, điện áp, bảo hành, ghi chú. Mỗi thay đổi được ghi vào lịch sử điều chỉnh. */
function openInfoEditor(id) {
  const job = currentJob, s = job.suppliers.find((x) => x.id === id);
  const field = (key, label, val, hint) => `<label>${label}</label><input type="text" data-f="${key}" value="${esc(val ?? "")}" placeholder="${esc(hint)}">`;
  $("contact-body").innerHTML = `<h3 class="first">Thông tin sản phẩm: ${esc(s.name)}</h3>
    ${field("mah", "Dung lượng pin (mAh)", s.mah, "VD 20000, để trống nếu không có")}${field("volt", "Điện áp (V)", s.volt, "VD 18")}${field("warranty_months", "Bảo hành (tháng)", s.warranty_months, "VD 12")}
    <label>Ghi chú</label><textarea data-f="note" rows="3" placeholder="Thông tin thêm về sản phẩm của NCC này">${esc(s.note || "")}</textarea>
    <div class="error" id="info-error"></div>
    <div class="actions"><button type="button" id="info-save">Lưu</button><button type="button" class="secondary" id="info-cancel">Đóng</button></div>`;
  $("info-cancel").onclick = () => $("contact-modal").classList.remove("show");
  $("info-save").onclick = () => {
    try {
      for (const input of $("contact-body").querySelectorAll("[data-f]")) {
        const key = input.dataset.f, cur = s[key] == null ? "" : String(s[key]);
        if (input.value.trim() !== cur) updateSupplier(job, id, key, input.value);
      }
    } catch (err) { $("info-error").textContent = err.message; return; }
    $("contact-modal").classList.remove("show"); renderResult(job); $("save-state").textContent = "Đã tự lưu " + new Date().toLocaleTimeString("vi-VN");
  };
  $("contact-modal").classList.add("show");
}
function openContact(id) {
  const job = currentJob, s = job.suppliers.find((x) => x.id === id), c = s.contacts || {}, tiles = [];
  const tile = (title, links) => { if (links.length) tiles.push(`<div class="contact-tile"><div class="t">${title}</div>${links.join("")}</div>`); };
  const ext = (u, label) => `<a href="${esc(u)}" target="_blank" rel="noopener">${label}</a>`;
  tile("Gọi điện", (c.phones || []).map((p) => `<a href="tel:${esc(p)}">${esc(p)}</a>`));
  tile("Zalo" + (c.zalo_guess ? " (theo số ĐT, chưa xác nhận)" : ""), (c.zalo || []).filter(safeUrl).map((u) => ext(u, "Mở Zalo")));
  tile("Messenger", (c.messenger || []).filter(safeUrl).map((u) => ext(u, "Nhắn Messenger")));
  tile("Facebook", (c.facebook || []).filter(safeUrl).map((u) => ext(u, "Trang Facebook")));
  const subject = encodeURIComponent("Đề nghị báo giá: " + job.query), body = encodeURIComponent(core.rfqText(job, s));
  tile("Email", (c.emails || []).map((m) => `<a href="mailto:${esc(m)}?subject=${subject}&body=${body}">${esc(m)}</a>`));
  tile("Skype", (c.skype || []).map((k) => `<a href="skype:${esc(k)}?chat">${esc(k)}</a>`));
  tile("Website", safeUrl(c.website) ? [ext(c.website, "Mở website"), ...(safeUrl(s.url) ? [ext(s.url, "Trang sản phẩm")] : [])] : []);
  $("contact-body").innerHTML = `<h3 class="first">Liên hệ ${esc(s.name)}</h3>${tiles.length ? `<div class="contact-grid">${tiles.join("")}</div>` : '<p class="muted">Không có thông tin liên hệ. Hãy mở website và tìm mục Liên hệ.</p>'}
    <p class="muted">Liên hệ lấy từ nội dung trang web, hãy kiểm tra lại trước khi dùng.</p>
    <div class="actions"><button type="button" id="copy-rfq">Sao chép email hỏi giá</button><button type="button" class="secondary" id="close-contact">Đóng</button></div>`;
  $("copy-rfq").onclick = () => navigator.clipboard.writeText(core.rfqText(job, s)).then(() => toast("Đã sao chép nội dung hỏi giá"));
  $("close-contact").onclick = () => $("contact-modal").classList.remove("show");
  $("contact-modal").classList.add("show");
}
$("contact-modal").addEventListener("click", (e) => { if (e.target.id === "contact-modal") $("contact-modal").classList.remove("show"); });

/* ------------------------------------------------------------------ tiến trình chạy (hiện từng bước đang làm gì) */
function makeProgress(el, steps) {
  el.hidden = false;
  el.innerHTML = `<div class="progress-bar"><i></i></div><ol class="steps">${steps.map((s) => `<li data-step="${s.id}" class="pending"><span class="dot"></span><span class="s-label">${esc(s.label)}</span><span class="s-detail muted"></span></li>`).join("")}</ol>`;
  const bar = el.querySelector(".progress-bar i"), li = (id) => el.querySelector(`[data-step="${id}"]`);
  let finished = 0;
  let top = 0; // thanh chỉ tiến, không lùi khi phần trăm của bước con thay đổi
  const paint = (frac = 0) => { top = Math.max(top, Math.min(100, Math.round(((finished + Math.min(frac, 0.99)) / steps.length) * 100))); bar.style.width = `${top}%`; };
  const setDetail = (id, t) => { if (t !== undefined) li(id).querySelector(".s-detail").textContent = t; };
  const close = (id, cls, t) => { const n = li(id); if (n.className === "pending" || n.className === "active") finished++; n.className = cls; setDetail(id, t); paint(0); };
  paint(0);
  return {
    start(id, t) { li(id).className = "active"; setDetail(id, t); paint(0); li(id).scrollIntoView({ block: "nearest" }); },
    detail(id, t, frac = 0) { setDetail(id, t); paint(frac); },
    done(id, t) { close(id, "done", t); },
    skip(id, t) { close(id, "skipped", t); },
    fail(id, t) { close(id, "error", t); },
    finish() { bar.style.width = "100%"; },
  };
}
/** Báo tiến trình crawl từng engine: "Google 3/10 · Cốc Cốc 2/10 (hết)" và phần trăm theo tổng số trang đã xong. */
function crawlReporter(prog, stepId) {
  const per = {};
  return (ev) => {
    per[ev.engine] = { page: ev.state === "start" ? ev.page - 1 : ev.page, pages: ev.pages, ended: ev.state === "end" || ev.state === "error", results: ev.results, err: ev.state === "error" };
    const done = Object.values(per).reduce((n, x) => n + (x.ended ? x.pages : x.page), 0), total = Object.values(per).reduce((n, x) => n + x.pages, 0);
    prog.detail(stepId, Object.entries(per).map(([e, x]) => `${ENGINE_NAMES[e] || e} ${x.err ? "lỗi" : `${x.page}/${x.pages}${x.ended ? " (hết)" : ""}`} · ${x.results} kết quả`).join("  |  "), total ? done / total : 0);
  };
}

/* ------------------------------------------------------------------ tư vấn: tên sản phẩm / ảnh, ngân sách, nhu cầu */
const KEY_ADVICE = "po_last_advice";
let lastAdvice = load(KEY_ADVICE, null), pendingAdvice = null;

function adviceExport(adv, discovery, research, engines) {
  const d = { ...discovery, items: discovery.items.slice(0, 150) }; delete d.pages;
  return { type: "purchasing-advice", version: 1, created: nowIso(), input: { query: adv.query, need: adv.need, budget: adv.budget }, engines, serp_pages: pagesPerEngine(), category: discovery.category,
    discovery: d, research, advice: { sections: adv.sections, category: adv.category, domains: adv.domains } };
}
function adviceFromData(data) {
  if (!data || data.type !== "purchasing-advice" || !data.discovery) throw new Error("File không phải dữ liệu tư vấn của app này");
  const d = data.discovery; d.pages = (d.items || []).slice(0, 40).map(({ url, domain, title }) => ({ url, domain, title }));
  return data;
}
function downloadAdvice(data) {
  const slug = core.stripAccents(data.input.query || "tu-van").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "tu-van";
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })), download: `tu_van_${slug}_${data.created.slice(0, 10)}.json` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
/** Nạp dữ liệu tư vấn vào form Yêu cầu mới: điền tên, nhu cầu, thêm link gợi ý, và giữ dữ liệu crawl để dựng card mà không crawl lại. */
function applyAdviceToForm(data) {
  pendingAdvice = adviceFromData(data);
  const inp = data.input || {}, picks = ((data.advice.sections || []).find((s) => s.picks) || {}).picks || [];
  $("query").value = inp.query || $("query").value; if (inp.need && !$("purpose").value) $("purpose").value = inp.need;
  const links = picks.slice(0, 5).map((p) => p.url).filter(Boolean);
  $("seed-urls").value = [...new Set([...core.parseUrls($("seed-urls").value), ...links])].join("\n");
  $("advice-loaded").hidden = false;
  $("advice-loaded").innerHTML = `Đã nạp dữ liệu tư vấn "${esc(inp.query)}" (${esc(dateTime(data.created))}): ${data.discovery.total} nguồn, nhóm ngành ${esc(core.CATEGORIES[data.discovery.category]?.label || "")}${inp.budget ? `, ngân sách ${esc(money(inp.budget))}` : ""}. Question card sẽ dùng dữ liệu này, không crawl lại. <a href="#" id="advice-unload">Bỏ</a>`;
  $("advice-unload").addEventListener("click", (e) => { e.preventDefault(); pendingAdvice = null; $("advice-loaded").hidden = true; });
  toast("Đã nạp dữ liệu tư vấn vào yêu cầu mới");
}
$("advice-file").addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try { applyAdviceToForm(JSON.parse(await file.text())); } catch (err) { toast(err.message); }
  e.target.value = "";
});
$("advice-last").addEventListener("click", () => { if (!lastAdvice) { toast("Chưa có lần tư vấn nào được lưu"); return; } try { applyAdviceToForm(lastAdvice); } catch (err) { toast(err.message); } });

function renderAdvice(adv, data) {
  const point = (p) => `<li>${esc(p.text)}${p.url ? ` <a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">[nguồn]</a>` : ""}</li>`;
  const picks = (list) => (list && list.length ? `<div class="picks">${list.map((i) => `<a class="pick" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener"><b>${esc(money(i.price))}</b>${i.fit ? `<span class="badge ${i.fit === "Trong ngân sách" ? "high" : ""}">${esc(i.fit)}</span>` : ""}<span class="t">${esc(i.title || i.domain)}</span><span class="muted">${esc(i.domain)}</span></a>`).join("")}</div>` : "");
  $("adv-result").hidden = false;
  $("adv-result").innerHTML = `<h3 class="first">Tư vấn: ${esc(adv.query)}</h3>
    ${adv.sections.map((s) => `<div class="block"><h4>${esc(s.heading)}</h4>${s.points.length ? `<ul class="points">${s.points.map(point).join("")}</ul>` : ""}${picks(s.picks)}</div>`).join("")}
    <div class="actions"><button type="button" id="adv-to-request">Tạo yêu cầu mua từ tư vấn này</button><button type="button" class="secondary" id="adv-save">Tải file tư vấn (.json)</button></div>
    <p class="muted">Tổng hợp tự động từ ${adv.domains.length} website. Dữ liệu tư vấn đã được lưu trong trình duyệt và có thể tải về file .json để nạp vào "Yêu cầu mới" (nút "Nạp dữ liệu tư vấn"). Hãy mở nguồn để kiểm tra và xin báo giá chính thức từ NCC.</p>`;
  $("adv-to-request").addEventListener("click", () => { applyAdviceToForm(data); showTab("new"); $("query").focus(); });
  $("adv-save").addEventListener("click", () => downloadAdvice(data));
}
$("advice-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("adv-query").value.trim(), need = $("adv-need").value.trim(), files = [...$("adv-images").files];
  const budget = parseInt($("adv-budget").value.replace(/\D/g, ""), 10) || null, state = $("adv-state");
  const engines = selectedEngines();
  state.textContent = "";
  if (!query && !need && !files.length) { state.textContent = "Nhập tên sản phẩm, nhu cầu hoặc chọn ảnh"; return; }
  if (!engines.length) { state.textContent = "Chưa chọn engine nào dùng được: cài làm tiện ích trình duyệt hoặc nhập khóa ở tab Cài đặt"; return; }
  $("adv-btn").disabled = true; $("adv-result").hidden = true;
  const prog = makeProgress($("adv-progress"), [
    { id: "prep", label: "Chuẩn bị yêu cầu" }, { id: "image", label: "Đọc ảnh" }, { id: "crawl", label: `Crawl kết quả tìm kiếm (tối đa ${pagesPerEngine()} trang mỗi engine)` },
    { id: "read", label: "Đọc các trang web" }, { id: "analyze", label: "Phân tích dữ liệu, nhận diện ngành hàng" }, { id: "research", label: "Tìm hiểu theo ngành hàng" },
    { id: "compose", label: "Tổng hợp tư vấn" }, { id: "save", label: "Lưu dữ liệu tư vấn" },
  ]);
  let step = "prep";
  try {
    prog.start("prep"); prog.done("prep", `Engine: ${engines.map((x) => ENGINE_NAMES[x] || x).join(", ")}`);
    let subject = query; step = "image";
    if (!subject && files.length) {
      prog.start("image", "Đang nhờ Claude đọc ảnh...");
      try { subject = (await analyzeImages(await Promise.all(files.map(fileToImage)))).keyword; } catch (err) { prog.fail("image", err.message); }
      if (subject) prog.done("image", `Nhận diện: ${subject}`);
      else if (!need) { state.textContent = "Chưa đọc được tên sản phẩm từ ảnh (cần khóa Anthropic ở tab Cài đặt). Hãy nhập tên sản phẩm hoặc nhu cầu."; prog.fail("image", "Không đọc được ảnh"); return; }
    } else prog.skip("image", files.length ? "Đã có tên sản phẩm" : "Không có ảnh");
    subject = subject || need;
    step = "crawl"; prog.start("crawl", "Đang mở trang kết quả...");
    const res = await searchEngines(engines, subject, pagesPerEngine(), crawlReporter(prog, "crawl"));
    prog.done("crawl", countsText(res.counts));
    if (!res.items.length) throw new Error(Object.keys(res.errors).length ? `Không engine nào trả kết quả: ${Object.entries(res.errors).map(([k, v]) => `${ENGINE_NAMES[k] || k} (${v})`).join("; ")}` : "Không có kết quả tìm kiếm");
    step = "read"; prog.start("read", `0/${res.urls.length} trang`);
    const pages = await pool(res.urls, async (url) => { try { return { url, html: await fetchHtml(url) }; } catch { return null; } }, 4, (d, t) => prog.detail("read", `${d}/${t} trang`, d / t));
    prog.done("read", `Đọc được ${pages.filter(Boolean).length}/${res.urls.length} trang, thêm ${res.items.filter((i) => !res.urls.includes(i.url)).length} kết quả chỉ dùng tiêu đề và mô tả`);
    step = "analyze"; prog.start("analyze");
    const discovery = core.buildDiscovery([...pages, ...serpPseudoPages(res.items, new Set(res.urls.filter((_, i) => pages[i])))], core.queryKeywords(subject), subject);
    prog.done("analyze", `${discovery.total} nguồn đúng sản phẩm, nhóm ngành: ${core.CATEGORIES[discovery.category].label}`);
    step = "research"; prog.start("research", "Chuẩn bị...");
    const r = await researchProduct(subject, engines, res.urls, [], crawlReporter(prog, "research"), (t, f) => prog.detail("research", t, f), res.items);
    prog.done("research", `Đọc ${r.read}/${r.total} trang, trả lời ${Object.values(r.research).filter((x) => x.snippets.length || x.brands?.length).length}/${Object.keys(r.research).length} câu hỏi`);
    step = "compose"; prog.start("compose");
    const adv = knowledge.buildAdvice({ query: subject, need, budget }, discovery, r.research);
    prog.done("compose", `${adv.sections.length} phần`);
    step = "save"; prog.start("save");
    const data = adviceExport(adv, discovery, r.research, engines); lastAdvice = data;
    prog.done("save", save(KEY_ADVICE, data) ? "Đã lưu trong trình duyệt (có thể tải file .json)" : "Không lưu được trong trình duyệt, hãy tải file .json");
    prog.finish(); renderAdvice(adv, data);
    state.textContent = Object.keys(res.errors).length ? `Một số engine lỗi: ${Object.entries(res.errors).map(([k, v]) => `${ENGINE_NAMES[k] || k} (${v})`).join("; ")}` : "";
  } catch (err) { prog.fail(step, err.message); state.textContent = `Lỗi: ${err.message}`; }
  $("adv-btn").disabled = false;
});

/* ------------------------------------------------------------------ xuất file, soạn email */
$("download").addEventListener("click", () => currentJob && downloadJob(currentJob));
$("export-links").addEventListener("click", () => currentJob && downloadLinks(currentJob));
$("send-btn").addEventListener("click", async () => {
  if (!currentJob) return;
  const to = $("boss-email").value.trim() || settings.boss_email || "";
  await downloadJob(currentJob);
  if (!to) { $("send-status").textContent = "Chưa có email sếp nên chỉ tải file xlsx để bạn gửi thủ công."; return; }
  const text = core.persuasionText(currentJob.analysis.persuasion);
  const body = `Kính gửi anh/chị,\n\nĐính kèm form duyệt báo giá: ${currentJob.keywords} (số lượng ${currentJob.quantity}). Em đính kèm file xlsx vừa tải về.\n\n${text}\n\nTrân trọng.`;
  $("send-status").textContent = `Đã tải file xlsx. Đang mở email nháp tới ${to}: hãy đính kèm file vừa tải và bấm gửi.`;
  location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent("Duyệt báo giá: " + currentJob.keywords)}&body=${encodeURIComponent(body.slice(0, 1800))}`;
});

/* ------------------------------------------------------------------ lịch sử tìm kiếm */
const jobLabel = { done: "Hoàn tất", error: "Lỗi", researching: "Đang tìm hiểu", awaiting_confirmation: "Chờ xác nhận", running: "Đang chạy", queued: "Đang chờ" };
const chips = (items, fmt) => (items.length ? `<div class="chips">${items.map((i) => `<span class="chip static">${fmt(i)}</span>`).join("")}</div>` : '<span class="muted">Chưa có</span>');
function groupBody(g) {
  const change = g.price_change_pct == null ? "Chưa đủ dữ liệu" : (g.price_change_pct > 0 ? "+" : "") + g.price_change_pct + "%";
  const tiles = [["Số lượt tìm kiếm", g.searches], ["Giá trung bình", money(g.avg_price)], ["Giá trung vị", money(g.median_price)], ["Giá thấp nhất", money(g.min_price)], ["Giá cao nhất", money(g.max_price)],
    ["Biến động giá (đầu → cuối)", change], ["Số trang web", g.sites.length], ["Số NCC", g.supplier_count], ["NCC trung bình mỗi lượt", g.avg_suppliers_per_search], ["Tổng số lượng yêu cầu", g.total_quantity],
    ["Số lần sửa bảng", g.edit_count], ["Engine đã dùng", g.engines.join(", ") || "Chỉ link nhập tay"], ["Lần đầu tìm", dateTime(g.first_search)], ["Lần gần nhất", dateTime(g.last_search)]];
  return `<div class="metrics">${tiles.map(([k, v]) => `<div class="stat">${esc(k)}<b>${esc(v)}</b></div>`).join("")}</div>
    <h4>Từ khóa đã dùng để tìm</h4>${chips(g.keywords, esc)}<h4>Các trang web đã tìm</h4>${chips(g.sites, (s) => `${esc(s.domain)} (${s.visits})`)}
    <h4>Các nhà cung cấp</h4>${chips(g.suppliers, (s) => `${esc(s.name)} · ${s.times} lần${s.min_price ? " · thấp nhất " + money(s.min_price) : ""}`)}
    <h4>NCC được khuyến nghị</h4>${chips(g.recommended, (r) => `${esc(r.name)} (${r.times})`)}
    <h4>Các lần tìm (bấm để mở)</h4>${g.jobs.map((j) => `<div class="jobrow" data-job="${esc(j.id)}"><span>${esc(dateTime(j.created))} · SL ${j.quantity}</span><span>${jobLabel[j.status] || esc(j.status)}</span></div>`).join("")}
    <div class="actions"><button type="button" class="secondary small" data-close-group>Đóng</button></div>`;
}
function renderHistory() {
  const q = $("history-filter").value.trim().toLowerCase(), groups = core.groupHistory(jobs).filter((g) => !q || g.name.toLowerCase().includes(q));
  $("history").innerHTML = groups.length ? groups.map((g) => `<div class="group"><div class="group-head" tabindex="0" role="button"><span class="name">${esc(g.name)}</span>
    <span class="chips"><span class="chip static">${g.searches} lượt tìm</span><span class="chip static">TB ${money(g.avg_price)}</span><span class="chip static">${g.supplier_count} NCC</span><span class="chip static">▾</span></span></div>
    <div class="group-body" hidden>${groupBody(g)}</div></div>`).join("") : '<p class="muted">Chưa có yêu cầu nào.</p>';
  document.querySelectorAll(".group").forEach((el) => {
    const head = el.querySelector(".group-head"), body = el.querySelector(".group-body"), toggle = () => (body.hidden = !body.hidden);
    head.addEventListener("click", toggle); head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    el.querySelector("[data-close-group]").addEventListener("click", () => { body.hidden = true; head.scrollIntoView({ block: "nearest" }); });
  });
  document.querySelectorAll("[data-job]").forEach((r) => r.addEventListener("click", () => {
    const job = getJob(r.dataset.job); if (!job) return; showTab("new"); currentJobId = job.id; currentJob = job;
    $("cards-card").hidden = true; $("result-card").hidden = true;
    if (job.status === "awaiting_confirmation") showCards(job); else renderAll(job);
  }));
}
$("history-filter").addEventListener("input", renderHistory);
$("export-history").addEventListener("click", () => downloadHistory(core.groupHistory(jobs)));

/* ------------------------------------------------------------------ lịch sử điều chỉnh */
const EDIT_COLS = [{ key: "time", label: "Thời gian" }, { key: "product", label: "Sản phẩm" }, { key: "supplier", label: "NCC" }, { key: "field_label", label: "Trường" }, { key: "old", label: "Giá trị cũ" }, { key: "new", label: "Giá trị mới" }];
let hiddenEditCols = new Set(ui.hiddenEditCols || []);
const allEdits = () => jobs.flatMap((j) => (j.edits || []).map((e) => ({ ...e, job_id: j.id, product: j.query }))).sort((a, b) => b.time.localeCompare(a.time));
function renderEditsTab() {
  const rows0 = allEdits(), fields = [...new Set(rows0.map((e) => e.field_label))], cur = $("edit-field").value;
  $("edit-field").innerHTML = '<option value="">Mọi trường</option>' + fields.map((f) => `<option ${f === cur ? "selected" : ""}>${esc(f)}</option>`).join("");
  $("edit-col-menu").innerHTML = EDIT_COLS.map((c) => `<label><input type="checkbox" data-ecol="${c.key}" ${hiddenEditCols.has(c.key) ? "" : "checked"}> ${esc(c.label)}</label>`).join("");
  document.querySelectorAll("[data-ecol]").forEach((cb) => cb.addEventListener("change", () => { cb.checked ? hiddenEditCols.delete(cb.dataset.ecol) : hiddenEditCols.add(cb.dataset.ecol); ui.hiddenEditCols = [...hiddenEditCols]; save(KEY_UI, ui); drawEdits(); }));
  drawEdits();
}
function drawEdits() {
  const q = $("edit-filter").value.trim().toLowerCase(), field = $("edit-field").value;
  const rows = allEdits().filter((e) => (!field || e.field_label === field) && (!q || [e.product, e.supplier, e.field_label, e.old, e.new].join(" ").toLowerCase().includes(q)));
  const cols = EDIT_COLS.filter((c) => !hiddenEditCols.has(c.key));
  $("edits-table").innerHTML = rows.length ? `<table class="plain"><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((e) => `<tr>${cols.map((c) => `<td>${esc(c.key === "time" ? dateTime(e.time) : e[c.key])}</td>`).join("")}</tr>`).join("")}</tbody></table>` : '<p class="muted" style="padding:14px">Chưa có chỉnh sửa nào.</p>';
}
$("edit-filter").addEventListener("input", drawEdits); $("edit-field").addEventListener("change", drawEdits);
$("export-edits").addEventListener("click", () => downloadEdits(allEdits()));

/* ------------------------------------------------------------------ cài đặt */
const SETTING_FIELDS = { "set-google-key": "google_key", "set-google-cx": "google_cx", "set-brave-key": "brave_key", "set-anthropic-key": "anthropic_key", "set-boss": "boss_email", "set-proxy": "proxy" };
const SECRET = new Set(["google_key", "brave_key", "anthropic_key"]);
const mask = (v) => (v.length <= 8 ? "*".repeat(v.length) : v.slice(0, 3) + "******" + v.slice(-3));
function loadSettingsForm() {
  for (const [id, key] of Object.entries(SETTING_FIELDS)) {
    const input = $(id), v = settings[key] || "";
    input.value = SECRET.has(key) ? "" : v;
    input.placeholder = SECRET.has(key) ? (v ? `Đã có: ${mask(v)} (để trống = giữ nguyên, nhập - để xóa)` : "") : input.placeholder;
  }
  $("set-proxy-ok").checked = !!settings.proxy_ok;
}
$("save-settings").addEventListener("click", () => {
  for (const [id, key] of Object.entries(SETTING_FIELDS)) {
    const v = $(id).value.trim();
    if (SECRET.has(key)) { if (v === "-") delete settings[key]; else if (v) settings[key] = v; }
    else if (v) settings[key] = v; else delete settings[key];
  }
  settings.proxy_ok = $("set-proxy-ok").checked;
  if (settings.proxy && !settings.proxy.includes("{url}")) { $("settings-status").textContent = "Địa chỉ proxy phải chứa {url}"; return; }
  save(KEY_SET, settings); $("settings-status").textContent = "Đã lưu"; toast("Đã lưu cài đặt"); loadSettingsForm(); renderEngines(); renderPagesSelect();
});
$("test-proxy").addEventListener("click", async () => {
  $("proxy-result").textContent = "Đang thử...";
  if (!proxyReady()) { $("proxy-result").textContent = "Chưa lưu địa chỉ proxy hoặc chưa tick đồng ý"; return; }
  try { const r = await fetch(proxied("https://example.com/"), { signal: withTimeout(20000) }); const t = await r.text(); $("proxy-result").textContent = r.ok && t.includes("Example Domain") ? "OK: proxy hoạt động" : `Lỗi: HTTP ${r.status}, nội dung không đúng`; }
  catch (e) { $("proxy-result").textContent = `Lỗi: ${e.message}`; }
});
document.querySelectorAll("[data-test]").forEach((btn) => btn.addEventListener("click", async () => {
  const service = btn.dataset.test, out = document.querySelector(`[data-result="${service}"]`);
  out.textContent = "Đang thử..."; btn.disabled = true;
  try {
    if (service === "google") { if (!(settings.google_key && settings.google_cx)) throw new Error("Cần lưu cả Google API key và Search engine ID trước"); await PAGE_FETCHERS.google("quạt", 1); }
    else if (service === "googleweb") { const urls = await net.googleWeb("quạt mini"); if (!urls.length) throw new Error("Mở được Google nhưng không đọc được link nào"); }
    else if (service === "coccoc") { const urls = await net.coccocWeb("quạt mini"); if (!urls.length) throw new Error("Mở được Cốc Cốc nhưng không đọc được link nào"); }
    else if (service === "bing") { const urls = await net.bingWeb("quạt mini"); if (!urls.length) throw new Error("Mở được Bing nhưng không đọc được link nào"); }
    else if (service === "bravesearch") { const urls = await net.braveWeb("quạt mini"); if (!urls.length) throw new Error("Mở được Brave Search nhưng không đọc được link nào"); }
    else if (service === "duckduckgo") { const urls = await net.duckduckgoWeb("quạt mini"); if (!urls.length) throw new Error("DuckDuckGo không trả link nào"); }
    else if (service === "brave") { if (!settings.brave_key) throw new Error("Chưa lưu Brave API key"); if (!net.isExt && !proxyReady()) throw new Error("Brave chặn gọi trực tiếp từ trình duyệt, cần cấu hình proxy trước"); await PAGE_FETCHERS.brave("quạt", 1); }
    else { if (!settings.anthropic_key) throw new Error("Chưa lưu Anthropic API key"); const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": settings.anthropic_key, "anthropic-version": "2023-06-01", "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 5, messages: [{ role: "user", content: "ping" }] }) }); if (!r.ok) throw new Error(httpHint(r.status)); }
    out.textContent = "OK: kết nối thành công";
  } catch (e) { out.textContent = `Lỗi: ${e.message}`; }
  btn.disabled = false;
}));
$("backup").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ version: 1, jobs }, null, 1)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "sao_luu_mua_hang.json" }); a.click();
});
$("restore").addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text()); if (!Array.isArray(data.jobs)) throw new Error("File không đúng định dạng");
    const have = new Set(jobs.map((j) => j.id)); jobs = [...jobs, ...data.jobs.filter((j) => j && j.id && !have.has(j.id))]; persist(); toast(`Đã khôi phục ${data.jobs.length} yêu cầu`);
  } catch (err) { toast(err.message); }
  e.target.value = "";
});
$("wipe").addEventListener("click", () => { if (confirm("Xóa toàn bộ lịch sử trong trình duyệt này? Không thể hoàn tác.")) { jobs = []; persist(); album.clearAll().catch(() => {}); currentJob = null; $("result-card").hidden = true; toast("Đã xóa lịch sử"); } });

buildColMenu(); renderEngines(); renderPagesSelect();
// Yêu cầu bị dở dang khi tải lại trang (đang chạy) được đánh dấu lỗi để người dùng tạo lại.
jobs.forEach((j) => { if (["running", "queued", "researching"].includes(j.status)) { j.status = "error"; j.error = "Bị gián đoạn khi tải lại trang"; } });
persist();
// Chỉ phục vụ kiểm thử: mở trang với ?debug để thay các engine bằng engine giả.
if (new URLSearchParams(location.search).has("debug")) window.__po = { PAGE_FETCHERS, searchEngines, deepUrls, serpPseudoPages, engineStatus, selectedEngines, pagesPerEngine, settings };
