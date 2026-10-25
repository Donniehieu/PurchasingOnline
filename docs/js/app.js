// Giao diện: form yêu cầu -> tiến trình -> wizard xác nhận từng câu -> kết quả. Chạy hoàn toàn trong trình duyệt (tiện ích hoặc trang web).
import * as album from "./album.js";
import * as core from "./core.js";
import { CancelledError, Crawler } from "./crawl.js";
import { Corpus, clearCorpora, loadCorpus, pruneCorpora } from "./corpus.js";
import { downloadHistory, downloadJob, downloadLinks, readLinkFile } from "./excel.js";
import * as flow from "./flow.js";
import * as knowledge from "./knowledge.js";
import * as net from "./net.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = core.money;
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
let currentJob = null, cancelled = false, running = false;

/* ------------------------------------------------------------------ tab, giao diện sáng/tối */
const TABS = ["new", "history", "settings"];
function showTab(name) {
  TABS.forEach((t) => ($("tab-" + t).hidden = t !== name));
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  if (name === "history") renderHistory();
  if (name === "settings") loadSettingsForm();
}
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
if (ui.theme === "dark") document.body.classList.add("dark");
$("theme-btn").addEventListener("click", () => { document.body.classList.toggle("dark"); ui.theme = document.body.classList.contains("dark") ? "dark" : "light"; save(KEY_UI, ui); });

/* ------------------------------------------------------------------ tiến trình chạy (hiện từng bước đang làm gì) */
function makeProgress(el, steps) {
  el.hidden = false;
  el.innerHTML = `<div class="progress-bar"><i></i></div><ol class="steps">${steps.map((s) => `<li data-step="${s.id}" class="pending"><span class="dot"></span><span class="s-label">${esc(s.label)}</span><span class="s-detail muted"></span></li>`).join("")}</ol>`;
  const bar = el.querySelector(".progress-bar i"), li = (id) => el.querySelector(`[data-step="${id}"]`);
  let finished = 0, top = 0, active = null;
  const paint = (frac = 0) => { top = Math.max(top, Math.min(100, Math.round(((finished + Math.min(frac, 0.99)) / steps.length) * 100))); bar.style.width = `${top}%`; };
  const setDetail = (id, t) => { if (t !== undefined && li(id)) li(id).querySelector(".s-detail").textContent = t; };
  const close = (id, cls, t) => { const n = li(id); if (!n) return; if (n.className === "pending" || n.className === "active") finished++; n.className = cls; setDetail(id, t); paint(0); };
  paint(0);
  return {
    get active() { return active; },
    start(id, t, frac = 0) { active = id; li(id).className = "active"; setDetail(id, t); paint(frac); li(id).scrollIntoView({ block: "nearest" }); },
    detail(id, t, frac = 0) { setDetail(id, t); paint(frac); },
    done(id, t) { close(id, "done", t); },
    skip(id, t) { close(id, "skipped", t); },
    fail(id, t) { close(id, "error", t); },
    skipPending() { el.querySelectorAll("li.pending, li.active").forEach((n) => close(n.dataset.step, n.className === "active" ? "done" : "skipped")); },
    finish() { top = 100; bar.style.width = "100%"; },
  };
}
const PREPARE_STEPS = [{ id: "ocr", label: "Đọc ảnh, điền tên/model/từ khóa" }, { id: "album", label: "Lấy ảnh vào album từ Google Hình ảnh (làm trước)" }, { id: "google", label: "Tìm trên Google, mở hết link của từng trang" }, { id: "analyze", label: "Phân tích dữ liệu, dựng câu hỏi" }];
const RUN_STEPS = [{ id: "album", label: "Lấy ảnh vào album (nếu chưa có)" }, { id: "suppliers", label: "Tìm nhà cung cấp bán đúng sản phẩm" }, { id: "contacts", label: "Thu thập liên hệ NCC" }, { id: "topics", label: "Trả lời từng chủ đề: tìm bài bằng \"câu hỏi + tên sản phẩm\", bổ sung đáp án" }, { id: "extra", label: "Trả lời từ khóa/câu hỏi bạn bổ sung" }, { id: "refs", label: "Đọc và tóm tắt bài viết tham khảo" }, { id: "compose", label: "Xếp hạng NCC, đề xuất, tổng hợp" }];

/** Báo tiến trình crawl của Google: "Tìm sản phẩm: trang 2/3, đọc link 4/10". */
function crawlEvents(prog) {
  const st = { page: 0, pages: 1, label: "", done: 0, total: 0, text: "" };
  return (ev) => {
    if (ev.kind === "serp") {
      Object.assign(st, { page: ev.page, pages: ev.pages, label: ev.label || st.label });
      if (ev.state === "start") { st.done = 0; st.total = 0; st.text = "đang mở kết quả Google"; }
      else if (ev.state === "results") st.text = `${ev.n} kết quả, chuẩn bị mở các link`;
      else if (ev.state === "end") st.text = "hết kết quả";
      else if (ev.state === "error") st.text = `lỗi: ${ev.message}`;
      else st.text = "xong";
    } else if (ev.kind === "read") { st.done = ev.done; st.total = ev.total; st.text = `đọc link ${ev.done}/${ev.total}`; }
    const frac = ((st.page - 1) + (st.total ? st.done / st.total : 0)) / Math.max(1, st.pages);
    if (prog.active) prog.detail(prog.active, `${st.label ? st.label + ": " : ""}trang Google ${st.page}/${st.pages}, ${st.text}`, frac);
  };
}

/* ------------------------------------------------------------------ form yêu cầu */
function applyDefaults() {
  const c = flow.defaultConfig(settings);
  $("cfg-pages").value = String(c.pages); $("cfg-album").value = c.album_n; $("cfg-delay").value = c.delay;
}
$("topics").innerHTML = knowledge.TOPIC_DEFS.map((t) => `<label class="chip"><input type="checkbox" name="topics" value="${t.id}" checked> ${esc(t.label)}</label>`).join("");
$("images").addEventListener("change", () => {
  $("image-preview").innerHTML = [...$("images").files].slice(0, 6).map((f) => `<img src="${URL.createObjectURL(f)}" alt="${esc(f.name)}">`).join("");
});
$("link-file").addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const urls = await readLinkFile(file);
    $("ref-urls").value = [$("ref-urls").value.trim(), ...urls].filter(Boolean).join("\n");
    $("link-status").textContent = `Đã nhập ${urls.length} link từ ${file.name}`;
  } catch (err) { $("link-status").textContent = `Không đọc được file: ${err.message}`; }
  e.target.value = "";
});
function showError(msg) { $("progress-card").hidden = false; $("error").textContent = msg; }
const lines = (t) => String(t || "").split("\n").map((s) => s.trim()).filter(Boolean);

$("stop-btn").addEventListener("click", () => { cancelled = true; $("stop-btn").disabled = true; $("stop-btn").textContent = "Đang dừng..."; });
function beginRun(title) {
  cancelled = false; running = true; $("stop-btn").hidden = false; $("stop-btn").disabled = false; $("stop-btn").textContent = "Dừng";
  $("progress-card").hidden = false; $("error").textContent = ""; $("progress-title").textContent = title; $("submit-btn").disabled = true;
}
function endRun() { running = false; $("stop-btn").hidden = true; $("submit-btn").disabled = false; }
// Kho dữ liệu đã đọc của từng yêu cầu: dùng chung giữa giai đoạn tìm hiểu và giai đoạn tìm NCC để không mở lại trang.
const corpora = new Map();
async function corpusOf(job) {
  if (!corpora.has(job.id)) corpora.set(job.id, (await loadCorpus(job.id).catch(() => null)) || new Corpus());
  return corpora.get(job.id);
}
function makeCtx(job, prog, corpus) {
  const crawler = new Crawler({ getDelay: () => job.cfg.delay * 1000, isCancelled: () => cancelled, onEvent: crawlEvents(prog), corpus });
  return {
    crawler, settings, files: [], log: (m) => addLog(job, m),
    step: (id, state, detail, frac) => ({ start: () => prog.start(id, detail, frac), done: () => prog.done(id, detail), skip: () => prog.skip(id, detail), error: () => prog.fail(id, detail) }[state]()),
  };
}
function addLog(job, msg) { job.log.push(`${new Date().toLocaleTimeString("vi-VN")} ${msg}`); $("log").textContent = job.log.join("\n"); $("log").scrollTop = $("log").scrollHeight; }

$("request-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (running) return;
  const files = [...$("images").files], query = $("query").value.trim(), code = $("product-code").value.trim(), searchText = $("search-text").value.trim();
  if (!query && !code && !searchText && !files.length) { showError("Nhập tên hoặc model sản phẩm, hoặc chọn ít nhất một ảnh"); return; }
  const quantity = parseInt($("quantity").value, 10);
  if (!(quantity >= 1)) { showError("Số lượng phải là số nguyên dương"); return; }
  const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, parseInt(v, 10) || d));
  const cfg = { pages: clamp($("cfg-pages").value, 1, 5, 2), album_n: clamp($("cfg-album").value, 1, 20, 3), delay: clamp($("cfg-delay").value, 1, 15, 3),
    topics: [...document.querySelectorAll('input[name="topics"]:checked')].map((c) => c.value), extra_q: lines($("extra-q").value), ref_urls: core.parseUrls($("ref-urls").value) };
  const job = {
    id: uid(), status: "researching", created: nowIso(), query, product_code: code, quantity, purpose: $("purpose").value.trim(), search_text: searchText, cfg,
    images: files.map((f) => f.name), engines: ["google"], seed_urls: [], keywords: null, questions: [], answers: {}, spec: {}, discovery: null, log: [],
    suppliers: [], others: [], research: {}, custom_answers: [], refs: [], sites_searched: [], price_stats: null, error: null,
  };
  jobs.unshift(job); persist(); currentJob = job;
  $("result-card").hidden = true; $("wizard-card").hidden = true; $("log").textContent = "";
  beginRun("Đang tìm hiểu sản phẩm trên Google");
  if (files.length) await album.addUploads(job.id, files);
  corpora.set(job.id, new Corpus());
  const prog = makeProgress($("progress"), PREPARE_STEPS), ctx = makeCtx(job, prog, corpora.get(job.id)); ctx.files = files;
  try {
    await flow.prepare(job, ctx);
    prog.skipPending(); prog.finish();
    $("query").value = job.query || ""; $("product-code").value = job.product_code || ""; $("search-text").value = job.search_text || "";
    persist(); showWizard(job);
  } catch (err) {
    job.status = err instanceof CancelledError ? "stopped" : "error"; job.error = err.message; addLog(job, `Lỗi: ${err.message}`);
    prog.fail(prog.active || "ocr", err.message); showError(err.message); persist();
  }
  endRun();
});

/* ------------------------------------------------------------------ wizard: từng câu hỏi một, trả lời xong tự sang câu kế */
let wiz = null;
function showWizard(job) {
  wiz = { job, idx: 0, answers: Object.fromEntries(job.questions.map((c) => [c.id, { value: c.default, custom: "" }])) };
  const d = job.discovery;
  $("cards-sources").innerHTML = d && d.total ? `<div class="notice">Đã đọc ${d.read} trang Google, ${d.total} nguồn đúng sản phẩm, nhóm ngành ${esc(core.CATEGORIES[d.category].label)}.${d.price ? ` Giá thấy trên web ${esc(money(d.price.min))} đến ${esc(money(d.price.max))}.` : ""}
    Các lựa chọn bên dưới lấy từ dữ liệu đó, kèm "thấy ở n/N trang". <details><summary>Các trang đã dùng</summary><ul class="points">${d.pages.map((p) => `<li><a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(p.domain)}</a> · ${txt(p.title)}</li>`).join("")}</ul></details></div>`
    : '<div class="notice">Chưa đọc được trang web nào đúng sản phẩm nên các lựa chọn chỉ là gợi ý chung.</div>';
  $("wizard-card").hidden = false; $("wizard").hidden = false; $("wiz-summary").hidden = true;
  renderStep(); $("wizard-card").scrollIntoView({ behavior: "smooth" });
}
function answerLabel(card, a) {
  if (a.value === core.CUSTOM) return a.custom || "(chưa nhập)";
  const o = card.options.find((x) => x.value === a.value);
  return o ? o.label.replace(/ \(thấy ở .*\)$/, "") : a.value || "Không chọn";
}
function renderStep() {
  const cards = wiz.job.questions, i = wiz.idx;
  if (i >= cards.length) { renderSummary(); return; }
  const card = cards[i], a = wiz.answers[card.id];
  $("wiz-count").textContent = `Câu ${i + 1}/${cards.length}`; $("wiz-fill").style.width = `${((i + 1) / cards.length) * 100}%`;
  $("wiz-error").textContent = ""; $("wiz-back").disabled = i === 0;
  $("wiz-body").innerHTML = `<div class="q-card"><div class="q-title">${esc(card.title)}</div><div class="q-text">${esc(card.question)}</div>${card.evidence ? `<div class="muted">${esc(card.evidence)}</div>` : ""}
    ${card.options.map((o) => `<label class="opt"><input type="radio" name="wiz" value="${esc(o.value)}" ${o.value === a.value ? "checked" : ""}> ${esc(o.label)}</label>`).join("")}
    <input type="text" class="custom ${a.value === core.CUSTOM ? "show" : ""}" id="wiz-custom" value="${esc(a.custom)}" placeholder="Nhập nội dung khác"></div>`;
  $("wiz-next").hidden = false; $("wiz-next").textContent = i === cards.length - 1 ? "Xem lại và xác nhận →" : "Tiếp →";
  document.querySelectorAll('#wiz-body input[name="wiz"]').forEach((r) => r.addEventListener("change", () => {
    a.value = r.value; $("wiz-custom").classList.toggle("show", r.value === core.CUSTOM);
    if (r.value === core.CUSTOM) { $("wiz-custom").focus(); return; } // chọn "Khác" thì chờ nhập rồi bấm Tiếp
    setTimeout(() => { wiz.idx++; renderStep(); }, 250); // trả lời xong tự sang câu kế
  }));
  $("wiz-custom").addEventListener("input", () => { a.custom = $("wiz-custom").value.trim(); });
}
$("wiz-next").addEventListener("click", () => {
  const card = wiz.job.questions[wiz.idx], a = wiz.answers[card.id];
  if (a.value === core.CUSTOM && !a.custom) { $("wiz-error").textContent = "Nhập nội dung hoặc chọn một đáp án"; return; }
  wiz.idx++; renderStep();
});
$("wiz-back").addEventListener("click", () => { if (wiz.idx > 0) { wiz.idx--; renderStep(); } });
function renderSummary() {
  $("wizard").hidden = true; $("wiz-summary").hidden = false;
  const cards = wiz.job.questions;
  $("wiz-summary").innerHTML = `<h4>Đã trả lời ${cards.length}/${cards.length} câu</h4><ol class="sum">${cards.map((c, i) => `<li><b>${esc(c.title)}:</b> ${esc(answerLabel(c, wiz.answers[c.id]))} <a href="#" data-jump="${i}">sửa</a></li>`).join("")}</ol>
    <div class="actions"><button type="button" id="confirm-btn">Xác nhận và tìm nhà cung cấp</button></div><div id="cards-error" class="error"></div>`;
  document.querySelectorAll("[data-jump]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); wiz.idx = +a.dataset.jump; $("wizard").hidden = false; $("wiz-summary").hidden = true; renderStep(); }));
  $("confirm-btn").addEventListener("click", confirmAnswers);
}
async function confirmAnswers() {
  const job = wiz.job;
  try { core.applyAnswers(job, wiz.answers); } catch (err) { $("cards-error").textContent = err.message; return; }
  job.status = "queued"; $("wizard-card").hidden = true; persist();
  beginRun("Đang tìm nhà cung cấp và tìm hiểu sản phẩm");
  const prog = makeProgress($("progress"), RUN_STEPS), ctx = makeCtx(job, prog, await corpusOf(job));
  try {
    await flow.run(job, ctx);
    prog.skipPending(); prog.finish();
    currentJob = job; persist(); renderResult(job);
    pruneCorpora(jobs.slice(0, 10).map((j) => j.id)).catch(() => {});
  } catch (err) {
    job.status = "error"; job.error = err.message; addLog(job, `Lỗi: ${err.message}`); prog.fail(prog.active || "suppliers", err.message); showError(err.message); persist();
  }
  endRun();
}

/* ------------------------------------------------------------------ kết quả */
const getJob = (id) => jobs.find((j) => j.id === id);
function renderResult(job) {
  currentJob = job; $("result-card").hidden = false;
  const rec = job.suppliers.find((s) => s.recommended);
  $("recommend").innerHTML = rec ? `<b>★ Đề xuất:</b> ${esc(rec.name)} — <a href="${esc(safeUrl(rec.url))}" target="_blank" rel="noopener">${esc(rec.product_name || rec.title)}</a>, đơn giá ${esc(money(rec.price))} (chưa VAT: ${rec.vat_included && rec.price ? esc(money(Math.round(rec.price / 1.1))) : esc(money(rec.price))}), bảo hành ${rec.warranty_months ? rec.warranty_months + " tháng" : "chưa rõ"}, VAT ${rec.vat === true ? "có" : rec.vat === false ? "không" : "chưa rõ"}. Điểm ${rec.score}.${job.partial ? " <i>(Kết quả chưa đầy đủ vì bạn đã dừng sớm.)</i>" : ""}`
    : `Chưa đề xuất được: ${job.suppliers.length ? "chưa NCC nào có giá đọc chính xác từ trang sản phẩm, hãy mở link để xem giá hoặc nhập tay vào bảng." : "chưa tìm được trang bán đúng sản phẩm. Thử thêm model, tăng số trang Google hoặc thêm NCC thủ công."}`;
  const unpriced = job.suppliers.filter((s) => !s.price).length;
  $("manual-notice").hidden = !unpriced; $("manual-notice").textContent = `${unpriced} NCC chưa có giá chính xác (trang không công bố giá có cấu trúc). Hãy bấm tên sản phẩm để xem giá trên trang rồi nhập vào bảng.`;
  renderTable(job); renderOthers(job); renderPrice(job); renderResearch(job); renderCustom(job); renderRefs(job); renderAlbum(job);
  $("download").onclick = () => downloadJob(job); $("export-links").onclick = () => downloadLinks(job);
  $("result-card").scrollIntoView({ behavior: "smooth" });
}

const COLUMNS = [
  { key: "name", label: "Tên NCC" }, { key: "product", label: "Tên sản phẩm / model" }, { key: "qty", label: "Số lượng" }, { key: "price", label: "Đơn giá" },
  { key: "vat", label: "VAT" }, { key: "info", label: "Thông tin sản phẩm" }, { key: "contact", label: "Liên hệ" }, { key: "del", label: "" },
];
const editable = (s, field, text) => `<span contenteditable="true" spellcheck="false" data-edit="${field}" data-id="${esc(s.id)}" data-orig="${esc(text)}">${esc(text)}</span>`;
function renderTable(job) {
  const wrap = $("table-wrap"), left = wrap.scrollLeft, top = wrap.scrollTop;
  const rows = job.suppliers.map((s) => {
    const vatNow = s.vat === true ? "Có" : s.vat === false ? "Không" : "Chưa rõ";
    const vatSel = `<select data-edit="vat" data-id="${esc(s.id)}" data-orig="${vatNow}">${["Có", "Không", "Chưa rõ"].map((o) => `<option ${o === vatNow ? "selected" : ""}>${o}</option>`).join("")}</select>`;
    const prodName = s.product_name || s.title || job.query;
    const priceCell = s.price ? `${editable(s, "price", Number(s.price).toLocaleString("vi-VN"))}${s.vat_included ? '<div class="muted">(đã gồm VAT)</div>' : ""}${s.over_budget ? '<div class="muted warn">vượt ngân sách</div>' : ""}`
      : `<div class="muted warn">Chưa có giá chính xác</div>${editable(s, "price", "")}<div class="muted">nhập tay nếu đã xem giá trên trang</div>`;
    return `<tr class="${s.recommended ? "recommended" : ""}" data-id="${esc(s.id)}">
      <td data-col="name">${s.recommended ? "★ " : ""}${editable(s, "name", s.name)}${safeUrl(s.site_url) ? ` <a class="mini" href="${esc(s.site_url)}" target="_blank" rel="noopener" title="Website của NCC">↗</a>` : ""}</td>
      <td data-col="product">${safeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="Mở đúng trang bán sản phẩm này">${esc(prodName)}</a>` : esc(prodName)}${s.model_code || job.product_code ? `<div class="muted">Mã sản phẩm: ${esc(s.model_code || job.product_code)}</div>` : ""}</td>
      <td data-col="qty">${editable(s, "quantity", String(s.quantity ?? job.quantity))}</td>
      <td data-col="price">${priceCell}</td>
      <td data-col="vat">${vatSel}${s.vat_source && safeUrl(s.vat_source) ? `<div class="muted clip" title="${esc(s.vat_evidence || "")}">${esc(s.vat_evidence || "")} <a href="${esc(s.vat_source)}" target="_blank" rel="noopener">[nguồn]</a></div>` : ""}</td>
      <td data-col="info"><div class="info-line">${esc(core.supplierInfo(s))}</div>${s.description ? `<div class="muted clip">${esc(s.description)}</div>` : ""}${s.note ? `<div class="muted">${esc(s.note)}</div>` : ""}<button type="button" class="secondary small" data-info="${esc(s.id)}">Sửa thông tin</button></td>
      <td data-col="contact">${(s.contacts?.phones || []).slice(0, 2).map((p) => `<div><a href="tel:${esc(p)}">${esc(p)}</a></div>`).join("")}${(s.contacts?.emails || [])[0] ? `<div class="muted clip">${esc(s.contacts.emails[0])}</div>` : ""}${s.contact_source && safeUrl(s.contact_source) ? `<div><a href="${esc(s.contact_source)}" target="_blank" rel="noopener">[nguồn]</a></div>` : ""}<button type="button" class="secondary small" data-contact="${esc(s.id)}">Liên hệ NCC</button></td>
      <td data-col="del"><button type="button" class="secondary small danger" data-del="${esc(s.id)}" title="Xóa NCC này">✕</button></td></tr>`;
  }).join("");
  $("result-table").innerHTML = `<table><thead><tr>${COLUMNS.map((c) => `<th data-col="${c.key}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
  document.querySelectorAll("#result-table td[data-col]").forEach((td) => { td.dataset.label = COLUMNS.find((c) => c.key === td.dataset.col)?.label || ""; });
  document.querySelectorAll("[data-contact]").forEach((b) => b.addEventListener("click", () => openContact(b.dataset.contact)));
  document.querySelectorAll("[data-info]").forEach((b) => b.addEventListener("click", () => openInfoEditor(b.dataset.info)));
  document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    const s = job.suppliers.find((x) => x.id === b.dataset.del); if (!s || !confirm(`Xóa NCC "${s.name}" khỏi bảng?`)) return;
    job.suppliers = job.suppliers.filter((x) => x.id !== s.id); flow.buildOutputs(job); persist(); renderResult(job);
  }));
  document.querySelectorAll("#result-table [data-edit]").forEach((el) => {
    if (el.tagName === "SELECT") el.addEventListener("change", () => saveEdit(el));
    else { el.addEventListener("blur", () => saveEdit(el)); el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } if (e.key === "Escape") { el.textContent = el.dataset.orig; el.blur(); } }); }
  });
  applyFilter(); wrap.scrollLeft = left; wrap.scrollTop = top;
}
function applyFilter() {
  const text = $("filter-text").value.trim().toLowerCase();
  document.querySelectorAll("#result-table tbody tr").forEach((tr) => { tr.hidden = !!text && !tr.textContent.toLowerCase().includes(text); });
}
$("filter-text").addEventListener("input", applyFilter);
function updateSupplier(job, id, field, value) {
  const s = job.suppliers.find((x) => x.id === id); if (!s) throw new Error("Không tìm thấy NCC trong bảng");
  const nv = core.parseField(field, value), ov = s[field] ?? null;
  if (nv === ov) return false;
  s[field] = nv; if (field === "price") { s.vat_included = false; s.price_source = "manual"; s.note = s.note && s.note.startsWith("Chưa đọc được giá") ? "" : s.note; }
  flow.buildOutputs(job); persist(); return true;
}
function saveEdit(el) {
  const value = el.tagName === "SELECT" ? el.value : el.textContent.trim();
  if (value === el.dataset.orig) return;
  try { if (updateSupplier(currentJob, el.dataset.id, el.dataset.edit, value)) { renderResult(currentJob); $("save-state").textContent = "Đã tự lưu " + new Date().toLocaleTimeString("vi-VN"); } }
  catch (err) { toast(err.message); el.tagName === "SELECT" ? (el.value = el.dataset.orig) : (el.textContent = el.dataset.orig); }
}
$("add-supplier").addEventListener("click", () => {
  if (!currentJob) return;
  currentJob.suppliers.push({ id: uid(), name: "NCC mới", title: "", product_name: currentJob.query, url: "", description: "", date: null, price: null, vat: null, vat_included: false, mah: null, volt: null, warranty_months: null, relevance: 1, contacts: {}, note: "", manual: true, quantity: currentJob.quantity });
  flow.buildOutputs(currentJob); persist(); renderResult(currentJob); $("save-state").textContent = "Đã thêm NCC, sửa các ô để nhập thông tin";
});
/** Sửa "Thông tin sản phẩm" của một NCC: tên sản phẩm, pin, điện áp, bảo hành, ghi chú. */
function openInfoEditor(id) {
  const job = currentJob, s = job.suppliers.find((x) => x.id === id);
  const field = (key, label, val, hint) => `<label>${label}</label><input type="text" data-f="${key}" value="${esc(val ?? "")}" placeholder="${esc(hint)}">`;
  $("contact-body").innerHTML = `<h3 class="first">Thông tin sản phẩm: ${esc(s.name)}</h3>
    ${field("product_name", "Tên sản phẩm / model trên trang NCC", s.product_name || s.title, "")}${field("mah", "Dung lượng pin (mAh)", s.mah, "VD 20000, để trống nếu không có")}${field("volt", "Điện áp (V)", s.volt, "VD 18")}${field("warranty_months", "Bảo hành (tháng)", s.warranty_months, "VD 12")}
    <label>Ghi chú (thông số kỹ thuật khác)</label><textarea data-f="note" rows="3" placeholder="Thông số, phụ kiện kèm theo...">${esc(s.note || "")}</textarea>
    <div class="error" id="info-error"></div>
    <div class="actions"><button type="button" id="info-save">Lưu</button><button type="button" class="secondary" id="info-cancel">Đóng</button></div>`;
  $("info-cancel").onclick = () => $("contact-modal").classList.remove("show");
  $("info-save").onclick = () => {
    try { for (const input of $("contact-body").querySelectorAll("[data-f]")) { const key = input.dataset.f, cur = s[key] == null ? "" : String(s[key]); if (input.value.trim() !== cur) updateSupplier(job, id, key, input.value); } }
    catch (err) { $("info-error").textContent = err.message; return; }
    $("contact-modal").classList.remove("show"); renderResult(job);
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
  tile("Email", (c.emails || []).map((m) => `<a href="mailto:${esc(m)}">${esc(m)}</a>`));
  tile("Skype", (c.skype || []).map((k) => `<a href="skype:${esc(k)}?chat">${esc(k)}</a>`));
  tile("Website", safeUrl(c.website || s.site_url) ? [ext(c.website || s.site_url, "Mở website NCC"), ...(safeUrl(s.url) ? [ext(s.url, "Trang sản phẩm")] : [])] : []);
  $("contact-body").innerHTML = `<h3 class="first">Liên hệ ${esc(s.name)}</h3>${tiles.length ? `<div class="contact-grid">${tiles.join("")}</div>` : '<p class="muted">Không tìm thấy thông tin liên hệ trên trang sản phẩm và trang Liên hệ. Hãy mở website và tìm mục Liên hệ.</p>'}
    <p class="muted">Liên hệ lấy từ nội dung trang web, hãy kiểm tra lại trước khi dùng.</p>
    <div class="actions"><button type="button" id="close-contact">Đóng</button></div>`;
  $("close-contact").onclick = () => $("contact-modal").classList.remove("show");
  $("contact-modal").classList.add("show");
}
$("contact-modal").addEventListener("click", (e) => { if (e.target.id === "contact-modal") $("contact-modal").classList.remove("show"); });

function renderOthers(job) {
  const o = job.others || []; $("others-wrap").hidden = !o.length;
  $("others-title").textContent = `${o.length} trang đã đọc nhưng không đưa vào bảng so sánh`;
  $("others").innerHTML = `<ul class="points">${o.map((x) => `<li><a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener">${txt(x.title || x.url)}</a> <span class="muted">· ${esc(x.reason)}</span></li>`).join("")}</ul>`;
}
function renderPrice(job) {
  const st = job.price_stats;
  $("price-stats").innerHTML = st ? `<div class="stat">Giá trung bình<b>${money(st.mean)}</b></div><div class="stat">Trung vị<b>${money(st.median)}</b></div><div class="stat">Thấp nhất<b>${money(st.min)}</b></div><div class="stat">Cao nhất<b>${money(st.max)}</b></div><div class="stat">Số NCC có giá<b>${st.count}</b></div>` : "";
  const priced = job.suppliers.filter((s) => s.price).sort((a, b) => a.price - b.price);
  if (!priced.length) { $("price-bars").innerHTML = '<p class="muted">Chưa có giá chính xác để so sánh.</p>'; return; }
  const max = Math.max(...priced.map((s) => s.price)), min = priced[0].price;
  $("price-bars").innerHTML = priced.map((s) => `<div class="bar-row"><div class="bar-label" title="${esc(s.name)}">${esc(s.name)}</div><div class="bar-track"><div class="bar-fill ${s.recommended ? "best" : ""}" style="width:${(s.price / max * 100).toFixed(1)}%"></div></div><div class="bar-value">${money(s.price)} · ${(s.price / min * 100).toFixed(0)}%</div></div>`).join("") + '<p class="muted">Tỷ lệ % tính theo NCC có giá thấp nhất (100%).</p>';
}
const txt = (x) => esc(core.decodeEntities(x)); // hiển thị: giải mã ký tự HTML còn sót trong dữ liệu đã lưu từ bản cũ
const snippetItem = (s) => `<li>${txt(s.text)} <a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">[nguồn]</a></li>`;
/** Đáp án đúng model/sản phẩm (hiện 5 câu đầu, còn lại thu gọn) và đáp án chung về loại sản phẩm (thu gọn, ghi rõ không nêu đúng model). */
function snippetList(snippets, general = [], job = {}, summary = []) {
  const code = job.product_code ? ` ${job.product_code}` : "";
  const sum = summary.length ? summary : snippets.slice(0, 3);
  const main = snippets.length ? `<div class="muted">Tóm tắt (${snippets.length} đáp án từ ${new Set(snippets.map((s) => s.url)).size} bài)</div><ul class="points">${sum.map((s) => `<li>${txt(s.text)} <a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">[${esc(core.domainOf(s.url))}]</a></li>`).join("")}</ul>${snippets.length > sum.length ? `<details><summary>Xem toàn bộ ${snippets.length} đáp án kèm nguồn</summary><ul class="points">${snippets.map(snippetItem).join("")}</ul></details>` : ""}`
    : `<p class="muted">${job.product_code ? `Chưa có bài nêu đúng model${code} trả lời câu này.` : "Chưa tìm được câu trả lời rõ ràng trong các bài đã đọc."}</p>`;
  const gen = general.length ? `<details class="general"><summary>Tham khảo chung về loại sản phẩm, KHÔNG nêu đúng model${code} (${general.length})</summary><ul class="points">${general.map(snippetItem).join("")}</ul></details>` : "";
  return main + gen;
}
function renderResearch(job) {
  const defs = knowledge.TOPIC_DEFS.filter((t) => job.research && job.research[t.id]); $("research-wrap").hidden = !defs.length;
  $("research").innerHTML = defs.map((t) => {
    const r = job.research[t.id];
    const price = r.price ? `<div class="chips"><span class="chip static">Thấp nhất ${esc(money(r.price.min))}</span><span class="chip static">Trung vị ${esc(money(r.price.median))}</span><span class="chip static">Cao nhất ${esc(money(r.price.max))}</span></div>` : "";
    return `<div class="block"><h4>${esc(t.label)}</h4><div class="muted">${esc(r.query)}${r.pages_read != null ? ` · đã đọc ${r.pages_read} bài` : ""}</div>${price}${snippetList(r.snippets, r.general || [], job, r.summary)}</div>`;
  }).join("");
}
function renderCustom(job) {
  const list = job.custom_answers || []; $("custom-wrap").hidden = false; // luôn hiện để có ô hỏi thêm từ kho dữ liệu
  $("custom-answers").innerHTML = list.map((a) => `<div class="block"><h4>${esc(a.question)}</h4><div class="muted">đã tìm trong ${a.pages_read ?? 0} bài đã đọc</div>${snippetList(a.snippets, a.general || [], job, a.summary)}</div>`).join("");
}
function renderRefs(job) {
  const list = job.refs || []; $("refs-wrap").hidden = !list.length;
  $("refs").innerHTML = list.map((a) => `<div class="block"><h4><a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">${txt(a.title || a.url)}</a></h4><div class="muted">${esc(a.domain)}</div>
    ${a.description ? `<p>${txt(a.description)}</p>` : ""}
    ${a.facts.length ? `<div class="chips">${a.facts.map((f) => `<span class="chip static">${esc(f)}</span>`).join("")}</div>` : ""}
    ${a.keyPoints.length ? `<h5>Ý chính</h5><ul class="points">${a.keyPoints.map((k) => `<li>${txt(k)}</li>`).join("")}</ul>` : ""}
    ${a.headings.length ? `<details><summary>Các đề mục của bài (${a.headings.length})</summary><ul class="points">${a.headings.map((h) => `<li>${txt(h)}</li>`).join("")}</ul></details>` : ""}
    ${a.qa.length ? `<h5>Câu hỏi liên quan và câu trả lời trong bài</h5>${a.qa.map((q) => `<div class="qa"><b>${esc(q.label)}</b><ul class="points">${q.snippets.map((s) => `<li>${esc(s.text)}</li>`).join("")}</ul></div>`).join("")}<a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">[nguồn: mở bài viết]</a>` : ""}</div>`).join("");
}
$("print-btn").addEventListener("click", () => window.print());

/* ------------------------------------------------------------------ hỏi thêm từ kho dữ liệu đã đọc */
$("ask-btn").addEventListener("click", async () => {
  const q = $("ask-q").value.trim();
  if (!currentJob || !q || running) return;
  $("ask-btn").disabled = true; $("ask-state").textContent = "Đang tìm trong kho dữ liệu đã đọc...";
  try {
    const job = currentJob, corpus = await corpusOf(job);
    if (!corpus.size) { $("ask-state").textContent = "Kho dữ liệu của yêu cầu này đã bị xóa hoặc không có, không có gì để tìm."; $("ask-btn").disabled = false; return; }
    const crawler = new Crawler({ getDelay: () => job.cfg.delay * 1000, isCancelled: () => false, onEvent: () => {}, corpus });
    const r = await flow.askMore(job, q, crawler, { allowSearch: net.isExt });
    persist(); renderCustom(job);
    $("ask-state").textContent = r.searched ? `Kho chưa đủ nên đã tìm bài "${q} ${job.query}": mở ${r.opened} bài mới (${crawler.reused} bài cũ dùng lại, đáp án cũ giữ nguyên).` : `Trả lời từ ${corpus.list({ real: true }).length} bài đã mở, không mở thêm trang nào.`;
    $("ask-q").value = "";
  } catch (err) { $("ask-state").textContent = `Lỗi: ${err.message}`; }
  $("ask-btn").disabled = false;
});
$("ask-q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("ask-btn").click(); } });

/* ------------------------------------------------------------------ album ảnh */
let albumUrls = [];
const albumQuery = (job) => flow.spaced(job.query, job.product_code);
async function renderAlbum(job) {
  $("album-title").textContent = job.album_label || `Album ảnh đối chiếu: ${albumQuery(job)}`;
  const photos = (await album.listPhotos(job.id)).sort((a, b) => (a.source === "upload" ? -1000 : -(a.match ?? -1)) - (b.source === "upload" ? -1000 : -(b.match ?? -1)));
  if (!currentJob || job.id !== currentJob.id) return;
  albumUrls.forEach((u) => URL.revokeObjectURL(u)); albumUrls = [];
  $("album").innerHTML = photos.length ? photos.map((p) => {
    const src = URL.createObjectURL(p.blob); albumUrls.push(src);
    const badge = p.source === "upload" ? '<span class="badge high">Ảnh bạn up</span>' : p.match != null && p.match >= 70 ? `<span class="badge ${p.match >= 80 ? "high" : ""}">Giống ảnh up ${p.match}%</span>` : "";
    return `<div class="photo"><img src="${src}" data-zoom alt="${esc(p.title)}"><div class="cap">${badge}<span class="t" title="${esc(p.title)}">${esc(p.title || "(không tiêu đề)")}</span>
      <span class="muted">${p.width}×${p.height} · ${esc(p.engine)}</span>
      <span>${safeUrl(p.page_url) ? `<a href="${esc(p.page_url)}" target="_blank" rel="noopener">Trang nguồn</a> · ` : ""}<a href="#" data-del-photo="${esc(p.id)}">Xóa</a></span></div></div>`;
  }).join("") : `<p class="muted">Chưa có ảnh. ${job.product_code ? 'Bấm "Tìm thêm ảnh" hoặc "Up ảnh của bạn".' : "Cần đủ tên sản phẩm + model để lấy ảnh; bạn vẫn up ảnh của mình được."}</p>`;
  document.querySelectorAll("#album [data-zoom]").forEach((img) => img.addEventListener("click", () => { $("lightbox").querySelector("img").src = img.src; $("lightbox").classList.add("show"); }));
  document.querySelectorAll("[data-del-photo]").forEach((a) => a.addEventListener("click", async (e) => { e.preventDefault(); await album.deletePhoto(a.dataset.delPhoto); renderAlbum(job); }));
}
$("lightbox").addEventListener("click", () => $("lightbox").classList.remove("show"));
$("album-more").addEventListener("click", async () => {
  if (!currentJob || running) return;
  $("album-more").disabled = true; $("album-state").textContent = "Đang tìm và tải ảnh...";
  const n = Math.min(20, Math.max(1, parseInt($("album-n").value, 10) || 3));
  currentJob.album_label = currentJob.album_label || `Album: ${albumQuery(currentJob)}`;
  const res = await album.crawlAlbum(currentJob.id, albumQuery(currentJob) || currentJob.search_text, n);
  $("album-more").disabled = false;
  $("album-state").textContent = res.error || (res.added.length ? `Đã thêm ${res.added.length} ảnh` : "Không có ảnh mới");
  persist(); renderAlbum(currentJob);
});
$("album-upload").addEventListener("change", async (e) => {
  if (!currentJob || !e.target.files.length) return;
  const added = await album.addUploads(currentJob.id, [...e.target.files]); e.target.value = "";
  $("album-state").textContent = added.length ? `Đã thêm ${added.length} ảnh của bạn` : "Không có ảnh hợp lệ hoặc ảnh đã có";
  renderAlbum(currentJob);
});

/* ------------------------------------------------------------------ lịch sử tìm kiếm: bảng STT, Tiêu đề, Số lượng, Từ khóa, Các trang đã tìm */
const jobLabel = { done: "Hoàn tất", error: "Lỗi", stopped: "Đã dừng", awaiting_confirmation: "Chờ xác nhận", researching: "Đang tìm hiểu", running: "Đang chạy", queued: "Đang chờ" };
const chips = (items, fmt) => (items.length ? `<div class="chips">${items.map((i) => `<span class="chip static">${fmt(i)}</span>`).join("")}</div>` : '<span class="muted">Chưa có</span>');
function groupDetail(g) {
  const change = g.price_change_pct == null ? "Chưa đủ dữ liệu" : (g.price_change_pct > 0 ? "+" : "") + g.price_change_pct + "%";
  const tiles = [["Số lượt tìm kiếm", g.searches], ["Giá trung bình", money(g.avg_price)], ["Giá trung vị", money(g.median_price)], ["Giá thấp nhất", money(g.min_price)], ["Giá cao nhất", money(g.max_price)], ["Biến động giá (đầu → cuối)", change],
    ["Số trang web", g.sites.length], ["Số NCC", g.supplier_count], ["Tổng số lượng yêu cầu", g.total_quantity], ["Lần đầu tìm", dateTime(g.first_search)], ["Lần gần nhất", dateTime(g.last_search)]];
  return `<div class="metrics">${tiles.map(([k, v]) => `<div class="stat">${esc(k)}<b>${esc(v)}</b></div>`).join("")}</div>
    <h4>Các nhà cung cấp</h4>${chips(g.suppliers, (s) => `${esc(s.name)} · ${s.times} lần${s.min_price ? " · thấp nhất " + money(s.min_price) : ""}`)}
    <h4>NCC được đề xuất</h4>${chips(g.recommended, (r) => `${esc(r.name)} (${r.times})`)}
    <h4>Các lần tìm (bấm để mở)</h4>${g.jobs.map((j) => `<div class="jobrow" data-job="${esc(j.id)}"><span>${esc(dateTime(j.created))} · SL ${j.quantity}</span><span>${jobLabel[j.status] || esc(j.status)}</span></div>`).join("")}`;
}
function renderHistory() {
  const q = $("history-filter").value.trim().toLowerCase();
  const groups = core.groupHistory(jobs).filter((g) => !q || [g.name, ...g.keywords, ...g.sites.map((s) => s.domain)].join(" ").toLowerCase().includes(q));
  $("history").innerHTML = groups.length ? `<table class="hist"><thead><tr><th>STT</th><th>Tiêu đề</th><th>Số lượng</th><th>Từ khóa đã tìm</th><th>Các trang đã tìm</th></tr></thead><tbody>${groups.map((g, i) => `<tr class="hrow" data-i="${i}" tabindex="0">
      <td data-label="STT">${i + 1}</td><td data-label="Tiêu đề"><b>${esc(g.name)}</b><div class="muted">${g.searches} lượt tìm · ${g.supplier_count} NCC</div></td><td data-label="Số lượng">${g.total_quantity}</td>
      <td data-label="Từ khóa đã tìm"><ul class="points tight">${g.keywords.slice(0, 6).map((k) => `<li>${esc(k)}</li>`).join("")}${g.keywords.length > 6 ? `<li class="muted">+${g.keywords.length - 6} từ khóa nữa</li>` : ""}</ul></td>
      <td data-label="Các trang đã tìm"><ul class="points tight">${g.sites.slice(0, 6).map((s) => `<li>${esc(s.domain)} <span class="muted">(${s.visits})</span></li>`).join("")}${g.sites.length > 6 ? `<li class="muted">+${g.sites.length - 6} trang nữa</li>` : ""}</ul></td></tr>
      <tr class="drow" hidden><td colspan="5">${groupDetail(g)}</td></tr>`).join("")}</tbody></table>` : '<p class="muted" style="padding:14px">Chưa có yêu cầu nào.</p>';
  document.querySelectorAll(".hrow").forEach((r) => {
    const toggle = () => { r.nextElementSibling.hidden = !r.nextElementSibling.hidden; };
    r.addEventListener("click", toggle); r.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  });
  document.querySelectorAll("[data-job]").forEach((r) => r.addEventListener("click", (e) => { e.stopPropagation(); openJob(getJob(r.dataset.job)); }));
}
function openJob(job) {
  if (!job) return;
  showTab("new"); currentJob = job; $("result-card").hidden = true; $("wizard-card").hidden = true; $("progress-card").hidden = true;
  if (job.status === "awaiting_confirmation") showWizard(job);
  else if (job.status === "done") renderResult(job);
  else { $("progress-card").hidden = false; $("progress").hidden = true; $("log").textContent = (job.log || []).join("\n"); $("error").textContent = job.error || `Yêu cầu này ở trạng thái: ${jobLabel[job.status] || job.status}`; }
}
$("history-filter").addEventListener("input", renderHistory);
$("export-history").addEventListener("click", () => downloadHistory(core.groupHistory(jobs)));

/* ------------------------------------------------------------------ cài đặt */
const mask = (v) => (v.length <= 8 ? "*".repeat(v.length) : v.slice(0, 3) + "******" + v.slice(-3));
function loadSettingsForm() {
  const c = flow.defaultConfig(settings);
  $("set-pages").value = c.pages; $("set-album").value = c.album_n; $("set-delay").value = c.delay;
  const k = settings.anthropic_key || "";
  $("set-anthropic-key").value = ""; $("set-anthropic-key").placeholder = k ? `Đã có: ${mask(k)} (để trống = giữ nguyên, nhập - để xóa)` : "";
}
$("save-settings").addEventListener("click", () => {
  const num = (id, lo, hi) => Math.min(hi, Math.max(lo, parseInt($(id).value, 10) || lo));
  settings.pages = num("set-pages", 1, 5); settings.album_n = num("set-album", 1, 20); settings.delay = num("set-delay", 1, 15);
  const k = $("set-anthropic-key").value.trim(); if (k === "-") delete settings.anthropic_key; else if (k) settings.anthropic_key = k;
  save(KEY_SET, settings); $("settings-status").textContent = "Đã lưu"; toast("Đã lưu cài đặt"); loadSettingsForm(); applyDefaults();
});
document.querySelectorAll("[data-test]").forEach((btn) => btn.addEventListener("click", async () => {
  const service = btn.dataset.test, out = document.querySelector(`[data-result="${service}"]`);
  out.textContent = "Đang thử..."; btn.disabled = true;
  try {
    if (service === "google") { const urls = await net.googleWeb("quạt mini"); if (!urls.length) throw new Error("Mở được Google nhưng không đọc được link nào"); out.textContent = `OK: Google trả ${urls.length} link ở trang 1`; }
    else {
      if (!settings.anthropic_key) throw new Error("Chưa lưu Anthropic API key");
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": settings.anthropic_key, "anthropic-version": "2023-06-01", "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 5, messages: [{ role: "user", content: "ping" }] }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 401 ? ": khóa không đúng" : ""}`);
      out.textContent = "OK: kết nối thành công";
    }
  } catch (e) { out.textContent = `Lỗi: ${e.message}`; }
  btn.disabled = false;
}));
$("backup").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ version: 2, jobs }, null, 1)], { type: "application/json" });
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
$("wipe").addEventListener("click", () => { if (confirm("Xóa toàn bộ lịch sử trong trình duyệt này? Không thể hoàn tác.")) { jobs = []; persist(); album.clearAll().catch(() => {}); clearCorpora().catch(() => {}); corpora.clear(); currentJob = null; $("result-card").hidden = true; toast("Đã xóa lịch sử"); } });

/* ------------------------------------------------------------------ khởi động */
applyDefaults();
net.checkWorker().then((r) => { if (!r.ok) { $("ext-warning").hidden = false; $("ext-warning").textContent = r.message; } });
// Yêu cầu bị dở dang khi tải lại trang được đánh dấu lỗi để người dùng tạo lại.
jobs.forEach((j) => { if (["running", "queued", "researching"].includes(j.status)) { j.status = "error"; j.error = "Bị gián đoạn khi tải lại trang"; } });
persist();
// Chỉ phục vụ kiểm thử: mở trang với ?debug.
if (new URLSearchParams(location.search).has("debug")) window.__po = { jobs: () => jobs, settings, flow, core, knowledge, Crawler };
