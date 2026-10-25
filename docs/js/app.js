// Giao diện và quy trình chạy hoàn toàn trên trình duyệt (GitHub Pages, không có máy chủ).
import * as core from "./core.js";
import { downloadEdits, downloadHistory, downloadJob, downloadLinks, readLinkFile } from "./excel.js";
import * as net from "./net.js";
import * as album from "./album.js";

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

/** Tải HTML. Tiện ích: fetch trực tiếp (không bị CORS), trang cần JavaScript hoặc fetch lỗi thì mở tab nền.
 *  Trang web thường: thử trực tiếp (chỉ được nếu website cho phép CORS), không được thì dùng proxy của người dùng. */
async function fetchHtml(url) {
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
const SEARCHERS = {
  async google(q, n) {
    const r = await fetch(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(settings.google_key)}&cx=${encodeURIComponent(settings.google_cx)}&q=${encodeURIComponent(q)}&num=${Math.min(n, 10)}&gl=vn&lr=lang_vi`, { signal: withTimeout() });
    if (!r.ok) throw new Error(httpHint(r.status));
    return filterDomains(((await r.json()).items || []).map((i) => i.link), n);
  },
  async coccoc(q, n) { return filterDomains(await net.coccocWeb(q, n), n); },
  async duckduckgo(q, n) { return filterDomains(await net.duckduckgoWeb(q, n), n); },
  async brave(q, n) {
    const target = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${Math.min(n * 2, 20)}&country=vn&search_lang=vi`;
    const r = await fetch(net.isExt ? target : proxied(target), { headers: { "X-Subscription-Token": settings.brave_key, Accept: "application/json" }, signal: withTimeout(25000) });
    if (!r.ok) throw new Error(httpHint(r.status));
    return filterDomains(((await r.json()).web?.results || []).map((i) => i.url), n);
  },
};
function httpHint(status) {
  return `HTTP ${status}: ` + ({ 400: "yêu cầu không hợp lệ, kiểm tra khóa và ID", 401: "khóa không đúng", 403: "khóa chưa được cấp quyền hoặc hết hạn mức", 422: "khóa sai định dạng", 429: "hết hạn mức tạm thời" }[status] || "lỗi từ nhà cung cấp");
}
function engineStatus() {
  return [
    { id: "coccoc", label: "Cốc Cốc (không cần khóa)", available: net.isExt, reason: "Chỉ chạy khi cài làm tiện ích Cốc Cốc/Chrome", recommended: true },
    { id: "duckduckgo", label: "DuckDuckGo (không cần khóa)", available: net.isExt, reason: "Chỉ chạy khi cài làm tiện ích Cốc Cốc/Chrome", recommended: true },
    { id: "google", label: "Google (Custom Search API)", available: !!(settings.google_key && settings.google_cx), reason: "Chưa nhập Google API key và Search engine ID (tab Cài đặt)" },
    { id: "brave", label: net.isExt ? "Brave Search API" : "Brave Search API (qua proxy)", available: !!(settings.brave_key && (net.isExt || proxyReady())), reason: "Cần Brave API key (và proxy nếu không chạy dạng tiện ích)" },
  ];
}
async function searchEngines(engines, query, per) {
  const lists = [], errors = {};
  for (const e of engines) { try { lists.push(await SEARCHERS[e](query, per)); } catch (err) { errors[e] = err.message; lists.push([]); } }
  const merged = [], seen = new Set();
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i] && !seen.has(l[i])) { seen.add(l[i]); merged.push(l[i]); }
  return { urls: merged, errors };
}
async function pool(items, worker, size = 4) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await worker(items[i]); } }));
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
    purpose: form.purpose, engines: form.engines, seed_urls: form.seed_urls, topics: form.topics, extra_keywords: form.extra_keywords, crawl_images: form.crawl_images,
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
  job.questions = core.buildCards(job, job.suggested_name, job.ocr_text);
  jobs.unshift(job); persist();
  return job;
}

async function runJob(job) {
  try {
    job.status = "running"; log(job, "Bắt đầu tìm kiếm");
    job.keywords = core.searchKeywords(job); log(job, `Từ khóa tìm kiếm: ${job.keywords}`);
    const tokens = core.queryKeywords(`${job.keywords} giá mua`);
    const engines = job.engines.filter((e) => engineStatus().find((s) => s.id === e)?.available);
    let searched = [];
    if (engines.length) {
      log(job, `Tìm trên engine: ${engines.join(", ")}`);
      const res = await searchEngines(engines, `${job.keywords} giá mua`, 8);
      searched = res.urls; job.errors = res.errors;
      for (const [e, m] of Object.entries(res.errors)) log(job, `Engine ${e} lỗi: ${m}`);
    } else if (job.engines.length) log(job, "Engine đã chọn chưa cấu hình khóa, chỉ dùng link nhập tay");
    const seeds = job.seed_urls, urls = [...new Set([...seeds, ...searched])];
    job.sites_searched = urls;
    let unreadable = 0;
    const results = await pool(urls, async (url) => {
      try { return { url, supplier: core.parsePage(await fetchHtml(url), url, tokens, job.product_code) }; }
      catch (e) { return { url, error: e.message }; }
    });
    const found = [];
    for (const r of results) {
      if (r.supplier && (r.supplier.relevance >= 0.5 || seeds.includes(r.url))) found.push({ id: uid(), ...r.supplier });
      else if (r.error && seeds.includes(r.url)) { unreadable++; found.push(placeholder(r.url, r.error)); }
    }
    log(job, `Đã thử ${urls.length} trang, đọc được ${found.filter((s) => !s.unreadable).length} trang, ${unreadable} trang cần nhập tay`);
    job.suppliers = found;
    if (job.crawl_images !== false && net.isExt) {
      log(job, "Đang crawl ảnh về album...");
      const res = await album.crawlAlbum(job.id, job.keywords);
      log(job, res.error ? `Album: ${res.error}` : `Album: thêm ${res.added.length} ảnh (đã thử ${res.tried} link ảnh)`);
    }
    if (job.topics.length && engines.length) { log(job, `Nghiên cứu chủ đề: ${job.topics.join(", ")}`); job.research = await research(job, engines); }
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
async function research(job, engines) {
  const out = {}, tokens = core.queryKeywords(job.query);
  for (const id of job.topics.filter((t) => core.TOPICS[t])) {
    const topic = core.TOPICS[id], query = `${job.query} ${topic.keywords} ${job.extra_keywords}`.trim();
    const { urls } = await searchEngines(engines, query, 3), snippets = [];
    await pool(urls.slice(0, 3), async (url) => {
      try {
        const html = await fetchHtml(url), text = core.htmlToText(html);
        if (core.phraseRelevance(tokens, core.stripAccents(text)) < 0.5) return;
        core.snippetsFrom(text, topic.pattern, tokens).forEach((t) => snippets.push({ text: t, url }));
      } catch { /* bỏ qua trang lỗi */ }
    });
    out[id] = { label: topic.label, query, snippets: snippets.slice(0, 4) };
  }
  return out;
}
function buildOutputs(job) {
  job.suppliers = core.scoreSuppliers(job.suppliers);
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
const TABS = ["new", "history", "edits", "settings"];
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
function renderEngines() {
  $("engines").innerHTML = engineStatus().map((e) => `<label class="chip ${e.available ? "" : "off"}" title="${esc(e.available ? "" : e.reason)}">
    <input type="checkbox" name="engines" value="${e.id}" ${e.available ? (e.recommended || !net.isExt ? "checked" : "") : "disabled"}> ${esc(e.label)}${e.available ? "" : e.recommended ? " (cần cài tiện ích)" : " (chưa cấu hình)"}</label>`).join("");
}
$("topics").innerHTML = Object.entries(core.TOPICS).map(([id, t]) => `<label class="chip"><input type="checkbox" name="topics" value="${id}"> ${esc(t.label)}</label>`).join("");
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
    engines: [...document.querySelectorAll('input[name="engines"]:checked')].map((c) => c.value), seed_urls: core.parseUrls($("seed-urls").value),
    topics: [...document.querySelectorAll('input[name="topics"]:checked')].map((c) => c.value),
    crawl_images: $("crawl-images").checked,
  };
  try {
    const images = await Promise.all(files.map(fileToImage));
    const job = await createJob(form, images);
    if (files.length) await album.addUploads(job.id, files);
    currentJobId = job.id; currentJob = job; showCards(job);
  } catch (err) { showError(err.message); }
  $("submit-btn").disabled = false;
});
function showError(msg) { $("status-card").hidden = false; $("error").textContent = msg; }

/* ------------------------------------------------------------------ question card */
function showCards(job) {
  $("cards-card").hidden = false; $("cards-error").textContent = ""; $("confirm-btn").disabled = false;
  $("cards").innerHTML = job.questions.map((card) => `<div class="block q-card"><div class="q-title">${esc(card.title)}</div><div class="muted">${esc(card.question)}</div>
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
  { key: "name", label: "NCC" }, { key: "price", label: "Đơn giá" }, { key: "mah", label: "Pin (mAh)" }, { key: "volt", label: "Điện áp (V)" },
  { key: "warranty_months", label: "Bảo hành (tháng)" }, { key: "vat", label: "VAT" }, { key: "date", label: "Ngày cập nhật web" },
  { key: "note", label: "Ghi chú" }, { key: "contact", label: "Liên hệ" }, { key: "score", label: "Điểm" }, { key: "status", label: "Trạng thái" }, { key: "del", label: "" },
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
    const status = s.recommended ? "★ Khuyến nghị" : s.eligible ? "Đủ điều kiện" : esc(s.reason);
    return `<tr class="${cls}" data-id="${esc(s.id)}">
      <td data-col="name">${safeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="Mở website">↗</a> ` : ""}${editable(s, "name", s.name)}</td>
      <td data-col="price">${editable(s, "price", s.price ? String(s.price) : "")}${s.vat_included ? '<div class="muted">(đã gồm VAT)</div>' : ""}</td>
      <td data-col="mah">${editable(s, "mah", s.mah ? String(s.mah) : "")}</td><td data-col="volt">${editable(s, "volt", s.volt ? String(s.volt) : "")}</td>
      <td data-col="warranty_months">${editable(s, "warranty_months", s.warranty_months != null ? String(s.warranty_months) : "")}</td>
      <td data-col="vat">${vatSel}</td><td data-col="date">${editable(s, "date", shortDate(s.date))}</td><td data-col="note">${editable(s, "note", s.note || "")}</td>
      <td data-col="contact"><button type="button" class="secondary small" data-contact="${esc(s.id)}">Liên hệ NCC</button></td>
      <td data-col="score">${s.score ?? "-"}</td><td data-col="status">${status}</td>
      <td data-col="del"><button type="button" class="secondary small danger" data-del="${esc(s.id)}" title="Xóa NCC này">✕</button></td></tr>`;
  }).join("");
  $("result-table").innerHTML = `<table><thead><tr>${COLUMNS.map((c) => `<th data-col="${c.key}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
  document.querySelectorAll("[data-contact]").forEach((b) => b.addEventListener("click", () => openContact(b.dataset.contact)));
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
function renderResearch(job) {
  const keys = Object.keys(job.research || {}); $("research-wrap").hidden = !keys.length;
  $("research").innerHTML = keys.map((k) => { const r = job.research[k];
    const items = r.snippets.length ? r.snippets.map((s) => `<li>${esc(s.text)} <a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">[nguồn]</a></li>`).join("") : "<li class='muted'>Không trích được câu phù hợp.</li>";
    return `<div class="block"><h4>${esc(r.label)}</h4><div class="muted">Từ khóa: ${esc(r.query)}</div><ul class="points">${items}</ul></div>`; }).join("");
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
const jobLabel = { done: "Hoàn tất", error: "Lỗi", awaiting_confirmation: "Chờ xác nhận", running: "Đang chạy", queued: "Đang chờ" };
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
  save(KEY_SET, settings); $("settings-status").textContent = "Đã lưu"; toast("Đã lưu cài đặt"); loadSettingsForm(); renderEngines();
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
    if (service === "google") { if (!(settings.google_key && settings.google_cx)) throw new Error("Cần lưu cả Google API key và Search engine ID trước"); await SEARCHERS.google("quạt", 1); }
    else if (service === "coccoc") { const urls = await net.coccocWeb("quạt mini", 5); if (!urls.length) throw new Error("Mở được Cốc Cốc nhưng không đọc được link nào"); }
    else if (service === "duckduckgo") { const urls = await net.duckduckgoWeb("quạt mini", 5); if (!urls.length) throw new Error("DuckDuckGo không trả link nào"); }
    else if (service === "brave") { if (!settings.brave_key) throw new Error("Chưa lưu Brave API key"); if (!net.isExt && !proxyReady()) throw new Error("Brave chặn gọi trực tiếp từ trình duyệt, cần cấu hình proxy trước"); await SEARCHERS.brave("quạt", 1); }
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

buildColMenu(); renderEngines();
// Yêu cầu bị dở dang khi tải lại trang (đang chạy) được đánh dấu lỗi để người dùng tạo lại.
jobs.forEach((j) => { if (["running", "queued"].includes(j.status)) { j.status = "error"; j.error = "Bị gián đoạn khi tải lại trang"; } });
persist();
