import { createApi, ApiError } from "./lib/api.js";
import { createStore } from "./lib/store.js";
import { createBridge } from "./lib/bridge.js";
import { createLimiter } from "./lib/limiter.js";
import { createHybridApi } from "./lib/hybrid.js";
import { extUpdateNotice } from "./lib/version.js";
import { mountOfferTable } from "./table-ui.js";
import { mountLinkInput } from "./link-ui.js";
import { mountViewer } from "./viewer.js";
import { newQuoteEntry, importLinks } from "./lib/quote.js";
import { genKeys, competitorBrands, withInfo } from "./lib/keygen.js";
import { expandResearch } from "./lib/expand.js";
import { catalogNames } from "./lib/techkb.js";
import { saveWizard, recallWizard, savedFor } from "./lib/wizcache.js";
import { TYPES } from "./lib/kb.js";
import { research, ask, STEPS } from "./lib/pipeline.js";
import { INTENTS } from "./lib/answer.js";
import { esc, clip, parseVnd } from "./lib/text.js";
import { parseNeed } from "./lib/need.js";
import { renderAdvice } from "./advice-ui.js";
import { analyzeInput, preCards, composeQuery, learnFromCache, detectType } from "./lib/intent.js";
import { makePlan, cacheKey } from "./lib/plan.js";
import { adviseProducts } from "./lib/advisor.js";
import { featuresFromRGBA } from "./lib/imagesim.js";
import { ocrLocal } from "./lib/localocr.js";
import { cfgFromSettings, normalizeCfg, PRESETS, matchPreset, keyHint } from "./lib/config.js";
import { renderBanner, renderHeadline, renderVerdict, renderSummary, renderCompare, renderImages, renderTech, renderLog, renderSources, renderHistoryItem, renderSuppliers, chip } from "./render.js";

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = "po-settings";

function loadSettings() {
  try { return { apiBase: "", provider: "auto", aiKey: "", appCode: "", keepDays: 30, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { return { apiBase: "", provider: "auto", aiKey: "", appCode: "", keepDays: 30 }; }
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* chế độ riêng tư */ } }

let settings = loadSettings();
const store = createStore();
const bridge = createBridge();
const limiter = createLimiter();
const serverApi = createApi(() => settings);
// ưu tiên Google trong Chrome (tiện ích) -> AI có khóa -> tìm miễn phí; mọi lần đọc trang đều giãn cách và cache
const api = createHybridApi({ server: serverApi, bridge, store, limiter, getSettings: () => settings });
let current = null;          // entry đang hiển thị
let runCtl = null;           // AbortController của lần chạy
let renderQueued = false;
const chats = new Map();     // key -> [{q, a}]
const choices = new Map();   // key -> khóa sản phẩm người dùng đã chọn ở tab Tư vấn chọn
const answersByKey = new Map(); // key -> { đặc điểm: giá trị } đã chọn ở các thẻ câu hỏi
const answersOf = (e) => answersByKey.get(e.key) ?? e.need?.answers ?? {};

// ---------- tiện ích giao diện ----------
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

function friendly(e) {
  if (e instanceof ApiError) {
    if (e.status === 401 && e.extra?.needsCode) return "Máy chủ yêu cầu mã truy cập. Vào Cài đặt để nhập.";
    if (e.status === 401) return e.message + " (Cài đặt → Khóa dịch vụ)";
    if (e.status === 429) return e.message + " Chờ một lúc rồi bấm Tìm hiểu lại.";
    return e.message;
  }
  return e?.message || "Có lỗi xảy ra";
}

// ---------- hiển thị kết quả ----------
function showResult(entry) {
  current = entry;
  $("empty").hidden = true;
  $("result").hidden = false;
  $("tabs").hidden = false;
  syncBusy();
  scheduleRender();
  renderAskChips();
}

// Đang tìm thì dữ liệu về liên tục: vẽ lại tối đa ~1 lần/giây và KHÔNG vẽ lại khi đang bấm/chạm,
// nếu không các link trong bảng bị thay mới ngay giữa lúc nhấn nên bấm không mở được và trang bị đơ.
let lastRender = 0, pressing = false, pressTimer;
const release = () => { clearTimeout(pressTimer); pressTimer = setTimeout(() => { pressing = false; }, 450); };
document.addEventListener("pointerdown", () => { pressing = true; clearTimeout(pressTimer); pressTimer = setTimeout(() => { pressing = false; }, 4000); }, true);
document.addEventListener("pointerup", release, true);
document.addEventListener("pointercancel", release, true);
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  // rAF bị trình duyệt tạm dừng khi tab ở nền: dùng thêm setTimeout để dữ liệu vẫn được vẽ
  const wait = runCtl ? Math.max(0, lastRender + 1000 - Date.now()) : 0;
  const go = () => {
    if (!renderQueued) return;
    if (pressing) { clearTimeout(retry); retry = setTimeout(go, 250); return; }
    renderQueued = false; lastRender = Date.now();
    if (current) render(current);
  };
  let retry;
  if (!wait) requestAnimationFrame(go);
  setTimeout(go, Math.max(wait, 120));
}

// bảng NCC dựng một lần (giữ nguyên ô lọc, thứ tự sắp xếp, cột ẩn khi dữ liệu cập nhật)
const offerTable = mountOfferTable($("tab-table"), {
  toast,
  onAdvice: () => selectTab("advice"),
  onAddLinks: (items) => (current ? addLinks(current, items) : toast("Chưa có bảng nào: hãy tìm sản phẩm hoặc lập bảng báo giá trước")),
  onMore: () => { if (current && !runCtl) { $("q").value = current.plan.query; run(current.plan.query, { mode: "enrich" }); } },
});

function render(entry) {
  $("banner").innerHTML = renderBanner(entry);
  $("headline").innerHTML = renderHeadline(entry);
  $("verdict").hidden = true; // tổng hợp chỉ có sản phẩm mục tiêu: phần "lựa chọn tối ưu" (gồm cả đối thủ) nằm ở tab So sánh
  $("verdict").innerHTML = "";
  $("tab-summary").innerHTML = renderSummary(entry);
  $("tab-advice").innerHTML = renderAdvice(entry, readNeed(), choices.get(entry.key) ?? entry.need?.choice ?? "", answersOf(entry));
  $("tab-suppliers").innerHTML = renderSuppliers(entry);
  offerTable.update(entry);
  $("tab-compare").innerHTML = renderCompare(entry);
  $("tab-tech").innerHTML = renderTech(entry, readNeed());
  // hàng tiêu dùng không phân tích công nghệ: ẩn tab
  $("tabTechBtn").hidden = entry.category !== "tech";
  if (entry.category !== "tech" && !$("tab-tech").hidden) selectTab("summary");
  $("tabTechBtn").textContent = entry.category === "tech" ? "Công nghệ" : "";
  $("tab-images").innerHTML = renderImages(entry);
  $("tab-log").innerHTML = renderLog(entry);
  $("sources").innerHTML = renderSources(entry);
  $("sources").hidden = !entry.sources.length;
}

function selectTab(name) {
  for (const b of document.querySelectorAll("#tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const p of document.querySelectorAll(".panel")) p.hidden = p.id !== "tab-" + name;
  const panel = $("tab-" + name);
  if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: "start", behavior: "smooth" }); // đang kéo xuống sâu: đưa về đầu phần vừa chọn
}
// nút "Tìm thêm dữ liệu mới" trong kết quả: tìm thêm trang mới rồi gộp vào dữ liệu đang xem
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-act=more]") || !current || runCtl) return;
  $("q").value = current.plan.query;
  run(current.plan.query, { mode: "enrich" });
});
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) selectTab(b.dataset.tab); });

// ảnh lỗi (chặn hotlink, hết hạn) thì bỏ khỏi lưới thay vì hiện khung vỡ
document.addEventListener("error", (e) => {
  const el = e.target;
  if (el.tagName === "IMG" && el.dataset.hide) (el.closest("figure") || el.closest("a") || el).remove();
}, true);

// ---------- tiến trình ----------
function initSteps() {
  $("steps").innerHTML = STEPS.map((s) => `<li id="st-${s.id}"><b>${esc(s.label)}</b><small></small></li>`).join("");
}
function onEvent(ev) {
  if (ev.type === "step") {
    const li = $("st-" + ev.id);
    if (li) { li.className = ev.status; li.querySelector("small").textContent = ev.text || ""; li.title = ev.text || ""; }
    if (ev.status === "running" || ev.text) { $("liveText").textContent = `${STEPS.find((s) => s.id === ev.id)?.label ?? ""}: ${ev.text || "đang chạy…"}`; setBusyText(ev.text); }
  } else if (ev.type === "progress") {
    $("liveText").textContent = `Đọc link ${ev.done}/${ev.total} · ${ev.domain}`;
    setBusyText(`link ${ev.done}/${ev.total} · ${ev.domain}`);
  } else if (ev.type === "entry") {
    if (!current || current.key !== ev.entry.key || current !== ev.entry) showResult(ev.entry); else scheduleRender();
  }
}

// Đang chạy: làm mờ dữ liệu phía sau, hiện vòng quay "Đang tìm kiếm, vui lòng chờ…" (có nút Dừng)
function syncBusy() {
  const on = !!runCtl && !$("result").hidden;
  $("busy").hidden = !on;
  $("result").classList.toggle("is-busy", on);
}
function setBusyText(t) { $("busyText").textContent = t || ""; }
$("busyStop").addEventListener("click", () => { pending = null; runCtl?.abort(); });

function setMode(m) {
  const quote = m === "quote";
  $("paneSearch").hidden = quote;
  $("paneQuote").hidden = !quote;
  $("modeSearch").setAttribute("aria-selected", String(!quote));
  $("modeQuote").setAttribute("aria-selected", String(quote));
}
$("modeSearch").addEventListener("click", () => setMode("search"));
$("modeQuote").addEventListener("click", () => setMode("quote"));

function setRunning(on) {
  syncBusy();
  if (on) $("progress").hidden = false;
  $("btnGo").disabled = on;
  $("btnStop").hidden = !on;
  $("progress").querySelector(".live").classList.toggle("idle", !on);
  if (!on) $("liveText").textContent = "Hoàn tất";
}

async function run(text, { mode = "enrich", force = false, ocrText = "", scenario = "full" } = {}) {
  if (runCtl) return;
  const input = { text: text.trim(), category: $("cat").value, ocrText, scenario };
  if (!input.text) { toast("Nhập tên hoặc mã sản phẩm trước"); $("q").focus(); return; }
  runCtl = new AbortController();
  $("errorBox").hidden = true;
  if (!current || current.plan.query !== input.text) selectTab("summary"); // tìm sản phẩm mới: về tab đầu (tìm thêm cho cùng sản phẩm thì giữ tab đang xem)
  current = null;
  initSteps();
  setRunning(true);
  try {
    const entry = await research(input, { api, store, emit: onEvent, signal: runCtl.signal, mode: force ? "fresh" : mode, ...runOptions() });
    entry.need = { ...readNeed(), choice: choices.get(entry.key) ?? entry.need?.choice ?? "", answers: answersOf(entry) };
    store.save(entry).catch(() => {});
    showResult(entry);
    $("progress").hidden = true; // chi tiết từng bước đã nằm trong tab Nhật ký
    toast(entry.fromCache ? "Lấy từ cache — không tốn lượt tìm mới" : "Hoàn tất — đã lưu vào cache");
    await refreshRecent();
  } catch (e) {
    if (e.name === "AbortError") toast("Đã dừng");
    else {
      $("progress").hidden = false;
      $("errorBox").hidden = false;
      $("errorBox").textContent = friendly(e);
      if (e instanceof ApiError && e.status === 401) openSettings();
    }
  } finally {
    runCtl = null;
    setRunning(false);
    scheduleRender();
    maybeExpand(); // người dùng đã trả lời xong trong lúc tìm: chạy tiếp các từ khóa bổ sung
  }
}

$("form").addEventListener("submit", (e) => { e.preventDefault(); startSearch($("q").value); });
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); $("form").requestSubmit(); } });
$("btnStop").addEventListener("click", () => { pending = null; runCtl?.abort(); });

// ---------- nhu cầu (ngân sách, mục đích) ----------
// Tự cắt từ chữ người dùng gõ để điền sẵn; chỉ dùng để gợi ý sản phẩm/NCC, KHÔNG dùng để tìm kiếm.
const needTouched = new Set();
const NEED_FIELDS = { purpose: "nPurpose", min: "nMin", max: "nMax", priority: "nPriority" };
const moneyInput = (v) => (v == null ? "" : v % 1e6 === 0 ? (v / 1e6) + "tr" : String(v));
function readNeed() {
  const num = (id) => { const t = $(id).value.trim(); return t ? parseVnd(/^[0-9]+$/.test(t) && Number(t) < 1000 ? t + "tr" : t) : null; };
  const lo = num("nMin"), hi = num("nMax");
  return { budgetMin: lo, budgetMax: hi, purpose: $("nPurpose").value.trim(), priority: $("nPriority").value };
}
function fillNeed(n, { force = false } = {}) {
  const set = (key, value) => {
    const el = $(NEED_FIELDS[key]);
    if (!force && needTouched.has(key)) return;
    el.value = value ?? "";
    el.closest("label")?.classList.toggle("filled", !!value);
  };
  set("purpose", n.purpose || "");
  set("min", moneyInput(n.budgetMin ?? null));
  set("max", moneyInput(n.budgetMax ?? null));
  if (force) set("priority", n.priority || "balanced");
  if (n.purpose || n.budgetMin != null || n.budgetMax != null) $("needBox").open = true;
}
let needTimer;
$("q").addEventListener("input", () => {
  clearTimeout(needTimer);
  needTimer = setTimeout(() => { const t = $("q").value; if (t.trim()) fillNeed(parseNeed(t)); }, 350);
});
for (const [key, id] of Object.entries(NEED_FIELDS)) {
  $(id).addEventListener("input", () => {
    needTouched.add(key);
    $(id).closest("label")?.classList.remove("filled");
    clearTimeout(needTimer);
    needTimer = setTimeout(() => { persistNeed(); scheduleRender(); }, 250);
  });
}
function persistNeed() {
  if (!current) return;
  current.need = { ...readNeed(), choice: choices.get(current.key) ?? "", answers: answersOf(current) };
  store.save(current).catch(() => {});
}
$("tab-advice").addEventListener("click", (e) => {
  if (!current) return;
  const card = e.target.closest("[data-card]");
  if (card || e.target.closest("[data-card-reset]")) {
    const ans = { ...answersOf(current) };
    if (!card) { for (const k of Object.keys(ans)) delete ans[k]; }
    else {
      const id = card.dataset.card, v = card.dataset.v;
      if (id === "audience") { $("nPurpose").value = $("nPurpose").value === v ? "" : v; needTouched.add("purpose"); }
      else if (id === "budget") { const [lo, hi] = v.split(":").map(Number); $("nMin").value = lo ? moneyInput(lo) : ""; $("nMax").value = hi ? moneyInput(hi) : ""; needTouched.add("min"); needTouched.add("max"); }
      else if (id === "priority") { $("nPriority").value = v; needTouched.add("priority"); }
      else if (ans[id] === v) delete ans[id]; else ans[id] = v;
    }
    answersByKey.set(current.key, ans);
    persistNeed();
    $("tab-advice").innerHTML = renderAdvice(current, readNeed(), choices.get(current.key) ?? "", answersOf(current));
    return;
  }
  const b = e.target.closest("[data-pick]");
  if (!b) return;
  if (current.scenario === "explore" && b.dataset.pick && !runCtl) {
    // đang ở kịch bản "khám phá": chọn một sản phẩm cụ thể thì tìm đầy đủ (bảng NCC) cho đúng sản phẩm đó
    const c = adviseProducts(current, readNeed(), answersOf(current)).candidates.find((x) => x.key === b.dataset.pick);
    if (c) {
      const text = [c.brand, c.model && !String(c.name).includes(c.model) ? c.model : "", c.name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      $("q").value = text;
      intentHint();
      run(text, { mode: "enrich", scenario: "full" });
      return;
    }
  }
  choices.set(current.key, b.dataset.pick);
  persistNeed();
  $("tab-advice").innerHTML = renderAdvice(current, readNeed(), b.dataset.pick, answersOf(current));
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---------- kịch bản theo kiểu dữ liệu nhập + thẻ câu hỏi TRƯỚC khi tìm ----------
// Nhận diện chạy ngay trên máy (không gọi mạng). Đủ thông tin: tìm thẳng. Thiếu: hiện thẻ câu hỏi (trả lời hoặc bỏ qua).
let pre = null; // { text, forcedType, analysis, hints, cards, answers }
function intentHint() {
  const text = $("q").value;
  const el = $("intentHint");
  if (!text.trim()) { el.hidden = true; return; }
  const a = analyzeInput(text, { forcedType: pre?.forcedType });
  const msg = {
    url: "Có link: ứng dụng đọc thẳng trang đó rồi tìm các nhà cung cấp khác của đúng sản phẩm.",
    model: `Có mã model ${a.signals.model}: tìm thẳng và dựng bảng NCC theo đúng tên/mã.`,
    spec: "Đủ hãng và thông số: tìm thẳng và dựng bảng NCC theo đúng tên.",
    branded: "Thiếu chi tiết: sẽ hỏi vài câu (bỏ qua được).",
    generic: "Mới biết loại hàng: sẽ hỏi vài câu (bỏ qua được); bỏ qua thì chỉ xem giá và sản phẩm tương đương.",
    need: "Mới có ngân sách/nhu cầu: sẽ hỏi loại sản phẩm bạn cần.",
    vague: "Hơi ngắn: nhập thêm tên, hãng hoặc mã để tìm đúng hơn.",
    pair: "Có hai sản phẩm: ứng dụng tìm từng sản phẩm một (sẽ hỏi tìm cái nào trước).",
  }[a.scenario];
  el.className = "intent-hint " + (a.mode === "full" ? "ok" : "ask");
  el.textContent = msg || "";
  el.hidden = !msg;
}
$("q").addEventListener("input", () => { pre = null; $("preCards").hidden = true; intentHint(); });

async function startSearch(text, { skipCards = false } = {}) {
  text = String(text ?? "").trim();
  if (!text) { toast("Nhập tên hoặc mã sản phẩm trước"); $("q").focus(); return; }
  pending = null; // tìm mới: bỏ yêu cầu tìm bổ sung của lần trước
  const a = analyzeInput(text);
  // đã có kết quả trong cache thì mở luôn, không hỏi lại
  let cached = null;
  try { cached = a.scenario === "url" ? null : await store.get(cacheKey(makePlan({ text, category: $("cat").value }))); } catch { /* bỏ qua */ }
  const bk = cacheKey(makePlan({ text, ocrText: ocrCtx, category: $("cat").value }));
  const saved = $("mode").value !== "cache" && a.scenario !== "url" ? savedFor(bk) : null;
  if (a.needCards && !skipCards && !cached && !saved && $("mode").value !== "cache") {
    await showPreCards(text, a);
    // hai sản phẩm: phải chọn cái nào trước. Còn lại: tìm NGAY theo thông tin ban đầu, vừa tìm vừa hỏi; trả lời xong sẽ tự tìm bổ sung
    if (a.scenario !== "pair") run(text, { mode: $("mode").value, ocrText: ocrCtx, scenario: a.mode });
    return;
  }
  $("preCards").hidden = true; pre = null;
  // đã từng trả lời cho từ khóa này: dùng lại thông tin đó để tìm bổ sung, không hỏi lại
  if (saved) {
    pending = { text, adds: saved.adds, baseKey: bk, typeId: saved.typeId, analysis: analyzeInput(withInfo(text, saved.adds)) };
    toast("Dùng lại thông tin bạn đã trả lời: " + saved.adds.join(" · "));
  }
  run(text, { mode: $("mode").value, ocrText: ocrCtx, scenario: a.mode });
}

async function showPreCards(text, a, forcedType = "") {
  const hints = a.type ? learnFromCache(await store.list().catch(() => []), a.type.id) : null;
  const baseKey = cacheKey(makePlan({ text, ocrText: ocrCtx, category: $("cat").value }));
  const cards = preCards(a, { hints });
  const again = pre?.text === text && !forcedType;
  // chưa trả lời lần nào trong phiên này: điền lại từ câu trả lời đã lưu (cùng từ khóa, hoặc cùng loại hàng)
  const recalled = again ? { answers: pre.answers, exact: false } : recallWizard({ baseKey, typeId: a.type?.id ?? "", cards });
  pre = { text, forcedType, analysis: a, hints, cards, answers: recalled.answers, recalled: !again && Object.keys(recalled.answers).length > 0, exact: recalled.exact, step: 0, baseKey };
  renderPreCards();
  $("preCards").hidden = false;
  $("preCards").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function needSelected(c, need) {
  if (c.id === "audience") return c.options.find((o) => o.value === need.purpose)?.value ?? "";
  const lo = need.budgetMin ?? 0, hi = need.budgetMax ?? 0;
  return c.options.find((o) => o.value === `${lo}:${hi}`)?.value ?? "";
}

const answered = (c) => (c.kind === "need" ? !!needSelected(c, readNeed()) : !!(pre.answers[c.id]?.value || pre.answers[c.id]?.custom));
const NO_INFO = "chưa có (từ khóa giữ đúng chữ bạn gõ)";

// Hỏi từng câu một: Quay lại / Bỏ qua / Tiếp. Câu trả lời điền vào từ khóa bổ sung (xem finishWizard).
function renderPreCards() {
  if (!pre) return;
  const total = pre.cards.length;
  if (!total) { finishWizard(); return; }
  const i = Math.min(pre.step, total - 1);
  const c = pre.cards[i];
  const need = readNeed();
  const sel = c.kind === "need" ? needSelected(c, need) : c.kind === "type" ? pre.forcedType : pre.answers[c.id]?.value;
  const chips = c.options.map((o) => `<button type="button" class="chip${sel === o.value ? " on" : ""}" data-pc="${esc(c.id)}" data-v="${esc(o.value)}" aria-pressed="${sel === o.value}">${esc(o.label)}${o.cached ? ' <span class="muted">(đã gặp)</span>' : ""}</button>`).join("");
  const other = c.kind === "query" ? `<input type="text" class="pc-other" data-pcx="${esc(c.id)}" maxlength="40" placeholder="${c.options.length ? "Khác: tự nhập" : "Tự nhập"}" value="${esc(pre.answers[c.id]?.custom ?? "")}">` : "";
  const dots = pre.cards.map((x, k) => `<span class="wz-dot${k === i ? " cur" : answered(x) ? " done" : ""}" aria-hidden="true"></span>`).join("");
  const isPair = pre.analysis.scenario === "pair";
  const busy = !isPair && runCtl ? "Đang tìm theo thông tin ban đầu… " : "";
  const last = i === total - 1;
  const reuse = pre.recalled && i === 0 && !isPair ? `<div class="alert info" style="margin:0 0 10px">Đã điền lại câu trả lời ${pre.exact ? "lần trước của sản phẩm này" : "gần nhất cho loại hàng này"}: <b>${esc(wizardPreview())}</b>. <button type="button" class="chip" data-pc-all="1">Dùng lại và tìm bổ sung</button></div>` : "";
  $("preCards").innerHTML = `<h2>Hỏi nhanh để tìm đúng sản phẩm <span class="count">câu ${i + 1}/${total} · ${esc(pre.analysis.label)}</span></h2>
    <p class="muted small" style="margin:0 0 10px">${busy}${isPair ? "" : "Trả lời xong, ứng dụng tự tìm bổ sung theo từ khóa sinh từ chữ bạn gõ + thông tin trả lời + hãng đối thủ + công nghệ. "}Bỏ qua câu nào cũng được.</p>
    ${reuse}
    <div class="wz-dots" role="presentation">${dots}</div>
    <div class="qcard"><div class="q-title"><span class="q-num">${i + 1}</span>${esc(c.title)}</div><div class="chips">${chips}</div>${other}</div>
    <p class="pc-preview">${isPair ? "Sẽ tìm: " : "Thông tin thêm vào từ khóa: "}<b>${esc(wizardPreview())}</b></p>
    <div class="row" style="margin-top:8px">
      <button type="button" class="btn ghost" data-pc-back="1" style="margin-left:0"${i === 0 ? " disabled" : ""}>Quay lại</button>
      <button type="button" class="btn ghost" data-pc-skip="1">Bỏ qua</button>
      <button type="button" class="btn primary" data-pc-next="1"${answered(c) ? "" : " disabled"}>${last ? (isPair ? "Tìm sản phẩm này" : "Xong, tìm bổ sung") : "Tiếp"}</button>
      <button type="button" class="btn ghost" data-pc-cancel="1">${isPair ? "Hủy" : "Đóng, không tìm bổ sung"}</button>
    </div>`;
}

// chữ thêm vào từ khóa từ các câu đã trả lời (thẻ "need" chỉ là nhu cầu, không thêm vào từ khóa)
function wizardAdds(p = pre) {
  return p.cards.filter((c) => c.kind === "query" && !c.options.some((o) => o.replace)).map((c) => p.answers[c.id]).filter(Boolean).map((a) => String(a.custom || a.add || "").trim()).filter(Boolean);
}
const wizardPreview = () => (pre.analysis.scenario === "pair" ? composeQuery(pre.text, pre.cards, pre.answers) : wizardAdds().join(" · ") || NO_INFO);

function stepWizard(delta) {
  saveWizard({ baseKey: pre.baseKey, typeId: pre.analysis.type?.id ?? "", answers: pre.answers, adds: wizardAdds() }); // nhớ ngay từng câu, kể cả khi đóng giữa chừng
  pre.step += delta;
  if (pre.step >= pre.cards.length) return finishWizard();
  renderPreCards();
}

function finishWizard() {
  const p = pre;
  $("preCards").hidden = true;
  pre = null;
  if (!p) return;
  if (p.analysis.scenario === "pair") {
    // hai sản phẩm: tìm cái đã chọn (mặc định cái đầu), đủ thông tin nên dựng bảng NCC
    const t = composeQuery(p.text, p.cards, p.answers);
    const chosen = t === p.text ? p.analysis.signals.parts[0] : t;
    $("q").value = chosen;
    run(chosen, { mode: $("mode").value, ocrText: ocrCtx, scenario: "full" });
    return;
  }
  const adds = wizardAdds(p);
  saveWizard({ baseKey: p.baseKey, typeId: p.analysis.type?.id ?? "", answers: p.answers, adds });
  // đã trả lời xong: mọi tab chuyển sang chế độ đủ thông tin NGAY (không còn "Chưa đủ thông tin / Bổ sung thông tin" ở tab nào), rồi cập nhật dần khi tìm bổ sung
  if (current?.key === p.baseKey) markAsked(current, adds);
  pending = { text: p.text, adds, baseKey: p.baseKey, typeId: p.analysis.type?.id ?? "", analysis: analyzeInput(withInfo(p.text, adds)) };
  maybeExpand();
}

// nút "Bổ sung thông tin" (kịch bản thiếu thông tin): mở lại thẻ câu hỏi cho từ khóa đang xem
document.addEventListener("click", async (e) => {
  if (!e.target.closest("[data-need-more]") || !current || runCtl) return;
  const text = current.plan.query;
  const a = analyzeInput(text);
  $("q").value = text;
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (a.needCards) await showPreCards(text, a);
  else { toast("Hãy ghi thêm hãng, mã hoặc thông số vào ô tìm kiếm rồi bấm Tìm hiểu"); $("q").focus(); }
});

$("preCards").addEventListener("click", async (e) => {
  if (!pre) return;
  const chip = e.target.closest("[data-pc]");
  if (chip) {
    const id = chip.dataset.pc, v = chip.dataset.v;
    const card = pre.cards.find((c) => c.id === id);
    if (card.kind === "type") { await showPreCards(pre.text, analyzeInput(pre.text, { forcedType: v }), v); return; }
    if (card.kind === "need") {
      if (id === "audience") { $("nPurpose").value = $("nPurpose").value === v ? "" : v; needTouched.add("purpose"); }
      else { const [lo, hi] = v.split(":").map(Number); $("nMin").value = lo ? moneyInput(lo) : ""; $("nMax").value = hi ? moneyInput(hi) : ""; needTouched.add("min"); needTouched.add("max"); }
    } else {
      const opt = card.options.find((o) => o.value === v);
      if (pre.answers[id]?.value === v) delete pre.answers[id]; else pre.answers[id] = { value: v, add: opt.add, replace: opt.replace };
    }
    renderPreCards();
    return;
  }
  if (e.target.closest("[data-pc-all]")) finishWizard();
  else if (e.target.closest("[data-pc-next]")) stepWizard(1);
  else if (e.target.closest("[data-pc-skip]")) {
    const c = pre.cards[Math.min(pre.step, pre.cards.length - 1)];
    if (c.kind === "query") delete pre.answers[c.id];
    stepWizard(1);
  } else if (e.target.closest("[data-pc-back]")) { if (pre.step > 0) { pre.step--; renderPreCards(); } }
  else if (e.target.closest("[data-pc-cancel]")) { $("preCards").hidden = true; pre = null; }
});
$("preCards").addEventListener("input", (e) => {
  const inp = e.target.closest("[data-pcx]");
  if (!inp || !pre) return;
  const id = inp.dataset.pcx;
  const cur = pre.answers[id] ?? {};
  if (inp.value.trim()) pre.answers[id] = { ...cur, custom: inp.value.trim() };
  else { delete cur.custom; if (cur.value) pre.answers[id] = cur; else delete pre.answers[id]; }
  const next = $("preCards").querySelector("[data-pc-next]");
  if (next) next.disabled = !answered(pre.cards[Math.min(pre.step, pre.cards.length - 1)]);
  const el = $("preCards").querySelector(".pc-preview b");
  if (el) el.textContent = wizardPreview();
});

// Đã hỏi xong thì không hỏi lại ở bất kỳ tab nào: bỏ chế độ "thiếu thông tin" cho bản ghi này
function markAsked(entry, adds) {
  entry.scenario = "full";
  entry.asked = { adds, ts: Date.now() };
  entry.need = { ...readNeed(), choice: choices.get(entry.key) ?? entry.need?.choice ?? "", answers: answersOf(entry) };
  store.save(entry).catch(() => {});
  scheduleRender();
}

// ---------- tìm bổ sung theo từ khóa tự sinh ----------
// Chạy SAU lần tìm ban đầu (đang chạy theo chữ bạn gõ), cộng dồn vào cùng bản ghi cache.
let pending = null; // { text, adds, baseKey, typeId, analysis }
async function maybeExpand() {
  if (!pending || runCtl) return;
  const p = pending;
  pending = null;
  let entry = current?.key === p.baseKey ? current : null;
  if (!entry) entry = await store.get(p.baseKey).catch(() => null);
  if (!entry) { toast("Lần tìm đầu chưa có dữ liệu nên bỏ qua tìm bổ sung"); return; }
  runCtl = new AbortController();
  const signal = runCtl.signal;
  setRunning(true);
  $("errorBox").hidden = true;
  $("steps").innerHTML = `<li id="st-pages" class="running"><b>Tìm bổ sung theo từ khóa mới</b><small></small></li>`;
  try {
    const type = TYPES.find((t) => t.id === p.typeId) ?? detectType(`${entry.plan.query} ${entry.product.name}`)?.type ?? null;
    const learned = type ? learnFromCache(await store.list().catch(() => []), type.id).brands : [];
    const mainBrand = entry.product.brand || entry.plan.brand || "";
    const generic = entry.plan.generic || type?.label.toLowerCase() || p.text;
    const keys = genKeys({
      typed: p.text, adds: p.adds, generic, category: entry.category, mainBrand,
      brands: competitorBrands({ entry, type, mainBrand, learned, max: 3 }),
      techNames: type ? catalogNames(type.id) : [], max: 14,
    });
    showResult(entry);
    const o = runOptions();
    const stats = await expandResearch(entry, keys, { api, store, emit: onEvent, signal, kind: generic, concurrency: o.concurrency, perHostCap: o.perHostCap, maxPages: o.enrichPageLimit });
    markAsked(entry, p.adds); // đã trả lời xong: dựng đủ mọi tab, không hỏi lại
    entry.need = { ...readNeed(), choice: choices.get(entry.key) ?? entry.need?.choice ?? "", answers: answersOf(entry) };
    await store.save(entry).catch(() => {});
    showResult(entry);
    $("progress").hidden = true;
    toast(stats.keys ? `Tìm bổ sung xong: ${stats.keys} từ khóa, ${stats.links} link mới, ${stats.pages} trang đã đọc` : "Chưa tìm bổ sung được: công cụ tìm kiếm miễn phí đang chặn hoặc không có kết quả (xem tab Nhật ký). Thử lại sau ít phút.");
    await refreshRecent();
  } catch (e) {
    if (e.name === "AbortError") toast("Đã dừng tìm bổ sung");
    else { $("progress").hidden = false; $("errorBox").hidden = false; $("errorBox").textContent = friendly(e); }
  } finally {
    runCtl = null;
    setRunning(false);
    scheduleRender();
  }
}

// ---------- báo giá NCC theo link có sẵn ----------
async function addLinks(entry, items) {
  if (runCtl) { toast("Đang chạy một việc khác: chờ xong hoặc bấm Dừng"); return; }
  runCtl = new AbortController();
  setRunning(true);
  $("errorBox").hidden = true;
  $("steps").innerHTML = `<li id="st-links" class="running"><b>Đọc link nhà cung cấp</b><small></small></li>`;
  entry.scenario = "full"; // người dùng đã chọn link: dựng bảng NCC ngay
  showResult(entry);
  selectTab("table");
  try {
    const o = runOptions();
    const st = await importLinks(entry, items, { api, store, emit: onEvent, signal: runCtl.signal, concurrency: o.concurrency });
    showResult(entry);
    $("progress").hidden = true;
    toast(st.added ? `Đã đọc ${st.ok}/${st.added} link${st.failed ? `, ${st.failed} link lỗi (vẫn có dòng trong bảng)` : ""}${st.skipped ? `, bỏ ${st.skipped} link trùng` : ""}` : "Các link này đã có trong bảng");
    quoteInput.clear();
    offerTable.linkInput.clear();
    await refreshRecent();
  } catch (e) {
    if (e.name === "AbortError") toast("Đã dừng, giữ các dòng đã đọc");
    else { $("progress").hidden = false; $("errorBox").hidden = false; $("errorBox").textContent = friendly(e); }
  } finally {
    runCtl = null;
    setRunning(false);
    scheduleRender();
  }
}

mountViewer();

const quoteInput = mountLinkInput($("quoteHost"), {
  withName: true, submitLabel: "Lập bảng báo giá", toast,
  onSubmit: ({ items, name }) => addLinks(newQuoteEntry(name), items),
});

// ---------- hỏi đáp ----------
function renderAskChips() {
  if (!current) return;
  const explore = current.scenario === "explore"; // thiếu thông tin: không gợi ý "nên chọn", không so sánh
  const ids = ["price", "pros", "cons", ...(current.category === "tech" ? (explore ? ["tech"] : ["tech", "techcmp"]) : []), ...(explore ? [] : ["choose"])];
  $("askChips").innerHTML = ids.map((id) => { const it = INTENTS.find((i) => i.id === id); return `<button type="button" class="chip" data-q="${esc(it.label)}">${esc(it.label)}</button>`; }).join("");
  const hist = chats.get(current.key) ?? [];
  $("chat").innerHTML = hist.map(msgHtml).join("");
}
function msgHtml(m) {
  if (m.q) return `<div class="msg q">${esc(m.q)}</div>`;
  // [n] trong câu trả lời thành liên kết nguồn ngay bên cạnh ý đó
  const body = esc(m.text).replace(/\[(\d+)\]/g, (all, n) => chip(current, Number(n)) || all);
  return `<div class="msg a">${body}<span class="via">${m.via === "cache" ? "Từ dữ liệu đã lưu" : m.mock ? "Mẫu, chỉ dùng dữ liệu đã lưu" : "Chỉ dùng dữ liệu đã lưu"}</span></div>`;
}
async function doAsk(question) {
  if (!current || !question.trim()) return;
  const key = current.key;
  const hist = chats.get(key) ?? [];
  chats.set(key, hist);
  hist.push({ q: question });
  $("chat").insertAdjacentHTML("beforeend", `<div class="msg q">${esc(question)}</div><div class="msg a" id="pending">Đang tra dữ liệu…</div>`);
  $("askInput").value = "";
  try {
    const r = await ask(current, question, { api });
    hist.push({ text: r.text, srcIds: r.srcIds, via: r.via, mock: r.mock });
  } catch (e) {
    hist.push({ text: "Không trả lời được: " + friendly(e), srcIds: [], via: "cache" });
  }
  if (current?.key === key) renderAskChips();
}
$("askForm").addEventListener("submit", (e) => { e.preventDefault(); doAsk($("askInput").value); });
$("askChips").addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) doAsk(b.dataset.q); });

// ---------- ảnh -> chữ (đọc chữ/mã trên ảnh) ----------
// Chọn file, dán (Ctrl+V / nút "Dán ảnh") hoặc kéo thả ảnh vào ô tìm kiếm.
let ocrCtx = "";
let previewUrl = "";
// Ảnh tham chiếu của người dùng: lưu dấu vân tay (dHash + màu) để ưu tiên các ảnh tìm được giống hoặc gần giống nhất
let refFeatures = null;
async function featuresOfBlob(blob) {
  const bmp = await createImageBitmap(blob);
  const draw = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(bmp, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
  const f = featuresFromRGBA(draw(16, 16), draw(9, 8));
  bmp.close?.();
  return f;
}
// ảnh web tải qua máy chủ (tránh lỗi CORS khi đọc điểm ảnh)
async function webImageFeatures(url) {
  const blob = await serverApi.image(url);
  return blob ? featuresOfBlob(blob) : null;
}
$("btnPhoto").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", () => { const f = $("file").files?.[0]; $("file").value = ""; if (f) readImage(f); });

async function readImage(f) {
  if (!f || !String(f.type || "image/").startsWith("image/")) { toast("Đây không phải ảnh"); return; }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(f);
  $("pastePreview").src = previewUrl;
  $("pasteInfo").hidden = false;
  $("ocrNote").textContent = "Đang đọc ảnh…";
  featuresOfBlob(f).then((x) => { refFeatures = x; }).catch(() => { refFeatures = null; });
  try {
    let r, local = "";
    try {
      const image = await shrink(f);
      r = await api.ocr(image);
    } catch (e) {
      // Dịch vụ AI không đọc được ảnh (hết hạn mức, bị chặn vùng, chưa có khóa): đọc ngay trên máy bằng Tesseract
      $("ocrNote").textContent = "AI không đọc được ảnh, đang đọc trên máy bạn (lần đầu cần tải dữ liệu tiếng Việt)…";
      try {
        const o = await ocrLocal(f, (st, p) => { $("ocrNote").textContent = `Đọc ảnh trên máy: ${st} ${Math.round(p * 100)}%`; });
        r = { ocr: o };
        local = ` (đọc trên máy vì AI lỗi: ${friendly(e)})`;
      } catch { throw e; }
    }
    const o = r.ocr ?? {};
    if (o.unreadable) { $("ocrNote").textContent = "Ảnh khó đọc: " + clip(o.text || "chụp rõ hơn, gần nhãn/mã model", 80); return; }
    const text = [o.brand, o.name].filter(Boolean).join(" ").trim() || (o.keywords ?? [])[0] || "";
    const withModel = o.model && !text.toUpperCase().includes(String(o.model).toUpperCase()) ? `${text} ${o.model}` : text;
    $("q").value = withModel.trim();
    $("q").dispatchEvent(new Event("input"));
    ocrCtx = (o.specs ?? []).slice(0, 4).join(" ");
    $("ocrNote").textContent = "Đã đọc từ ảnh — kiểm tra rồi bấm Tìm hiểu" + (r.mock ? " (mẫu)" : "") + local;
  } catch (e) {
    $("ocrNote").textContent = "Không đọc được ảnh: " + friendly(e);
  }
}
function clearImage() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = "";
  $("pasteInfo").hidden = true;
  $("pastePreview").removeAttribute("src");
  $("ocrNote").textContent = "";
  ocrCtx = "";
  refFeatures = null;
}
$("pasteClear").addEventListener("click", clearImage);

// ---------- chụp ảnh trực tiếp ----------
// Điện thoại: mở thẳng camera sau (capture). Máy tính: hộp thoại xem trước camera rồi chụp.
let camStream = null;
function stopCam() { camStream?.getTracks().forEach((t) => t.stop()); camStream = null; $("camVideo").srcObject = null; }
$("fileCam").addEventListener("change", () => { const f = $("fileCam").files?.[0]; $("fileCam").value = ""; if (f) readImage(f); });
$("btnCamera").addEventListener("click", async () => {
  if (window.matchMedia("(pointer: coarse)").matches) { $("fileCam").click(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { toast("Trình duyệt không cho dùng camera: hãy chọn ảnh từ máy (nút Ảnh)"); return; }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } }, audio: false });
    $("camVideo").srcObject = camStream;
    $("camNote").textContent = "Hướng camera vào nhãn hoặc mã model rồi bấm Chụp.";
    $("camDlg").showModal();
  } catch { toast("Không mở được camera (chưa cho phép hoặc không có camera). Dùng nút Ảnh hoặc Dán ảnh."); }
});
$("camShot").addEventListener("click", () => {
  const v = $("camVideo");
  if (!v.videoWidth) { $("camNote").textContent = "Camera chưa sẵn sàng, thử lại sau một giây."; return; }
  const c = document.createElement("canvas");
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  c.toBlob((b) => { if (b) readImage(new File([b], "chup.jpg", { type: "image/jpeg" })); $("camDlg").close(); }, "image/jpeg", 0.9);
});
$("camClose").addEventListener("click", () => $("camDlg").close());
$("camDlg").addEventListener("close", stopCam);
const imageOf = (items) => [...(items ?? [])].find((it) => it.kind === "file" && String(it.type).startsWith("image/"));
// Ctrl+V ở bất kỳ đâu trong trang: có ảnh trong clipboard thì đọc ảnh (chữ thì dán bình thường)
document.addEventListener("paste", (e) => {
  const it = imageOf(e.clipboardData?.items);
  if (!it) return;
  const f = it.getAsFile();
  if (f) { e.preventDefault(); readImage(f); }
});
$("btnPaste").addEventListener("click", async () => {
  try {
    if (!navigator.clipboard?.read) throw new Error("no api");
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) { readImage(new File([await item.getType(type)], "dan.png", { type })); return; }
    }
    toast("Trong clipboard chưa có ảnh. Sao chép ảnh rồi bấm lại.");
  } catch { toast("Trình duyệt chưa cho đọc clipboard: bấm vào ô tìm kiếm rồi nhấn Ctrl+V (hoặc giữ lên ô nhập → Dán)."); $("q").focus(); }
});
const dz = $("dropZone");
dz.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) { e.preventDefault(); dz.classList.add("drag"); } });
dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
dz.addEventListener("drop", (e) => { dz.classList.remove("drag"); const f = [...(e.dataTransfer?.files ?? [])].find((x) => String(x.type).startsWith("image/")); if (f) { e.preventDefault(); readImage(f); } });
$("q").addEventListener("input", () => { if (!$("q").value) ocrCtx = ""; });

function shrink(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ mime: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Không mở được ảnh này")); };
    img.src = url;
  });
}

// ---------- lịch sử / cache ----------
async function refreshRecent() {
  const list = (await store.list()).slice(0, 6);
  $("recent").innerHTML = list.length ? `<span class="muted small" style="width:100%">Đã tìm gần đây:</span>` + list.map((e) => `<button class="chip" data-key="${esc(e.key)}">${esc(clip(e.product.name || e.plan.query, 36))}</button>`).join("") : "";
}
async function openKey(key) {
  const e = await store.get(key);
  if (!e) return;
  e.fromCache = true;
  chats.delete(key);
  $("progress").hidden = true;
  needTouched.clear();
  fillNeed(e.need ?? parseNeed(e.plan.query), { force: true });
  if (e.need?.choice) choices.set(e.key, e.need.choice);
  if (e.need?.answers) answersByKey.set(e.key, e.need.answers);
  showResult(e);
  selectTab("summary");
  $("drawer").hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("recent").addEventListener("click", (e) => { const b = e.target.closest("[data-key]"); if (b) openKey(b.dataset.key); });
$("btnHistory").addEventListener("click", async () => {
  const list = await store.list();
  $("histList").innerHTML = list.length ? list.map(renderHistoryItem).join("") : `<p class="muted">Chưa lưu gì. Mỗi lần tìm xong sẽ được lưu trên thiết bị này.</p>`;
  $("drawer").hidden = false;
});
$("drawerClose").addEventListener("click", () => ($("drawer").hidden = true));
$("drawer").addEventListener("click", (e) => { if (e.target === $("drawer")) $("drawer").hidden = true; });
$("histList").addEventListener("click", (e) => { const b = e.target.closest("[data-key]"); if (b) openKey(b.dataset.key); });
$("btnExport").addEventListener("click", async () => {
  const data = await store.exportAll();
  if (!data.entries.length) return toast("Chưa có gì để xuất");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  a.download = `cache-mua-hang-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
$("btnImport").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async () => {
  const f = $("importFile").files?.[0];
  $("importFile").value = "";
  if (!f) return;
  try { const n = await store.importAll(JSON.parse(await f.text())); toast(`Đã nạp ${n} mục từ file cache`); await refreshRecent(); $("btnHistory").click(); }
  catch (e) { toast(e.message || "File không hợp lệ"); }
});
$("btnClear").addEventListener("click", async () => {
  if (!confirm("Xóa toàn bộ dữ liệu đã lưu trên thiết bị này?")) return;
  await store.clear();
  chats.clear();
  await refreshRecent();
  $("histList").innerHTML = `<p class="muted">Đã xóa.</p>`;
});

// ---------- cài đặt ----------
// Cấu hình tìm kiếm (số trang, ảnh, luồng...) lấy từ settings.cfg
function runOptions() {
  const c = cfgFromSettings(settings);
  return { pageLimit: c.pagesFull, explorePageLimit: c.pagesExplore, enrichPageLimit: c.pagesEnrich, imageLimit: c.images, imageLimitAlt: c.imagesAlt, concurrency: c.concurrency, perHostCap: c.perHost, contactPages: c.contactPages, stopEarly: c.stopEarly, refImage: refFeatures, imageFeatures: refFeatures ? webImageFeatures : null };
}
function fillCfg(c) {
  for (const el of $("dlg").querySelectorAll("[data-cfg]")) {
    const v = c[el.dataset.cfg];
    if (el.type === "checkbox") el.checked = !!v; else el.value = v;
  }
  for (const b of $("dlg").querySelectorAll("[data-val]")) b.textContent = c[b.dataset.val];
  const id = matchPreset(c);
  for (const b of $("dlg").querySelectorAll("[data-preset]")) b.classList.toggle("on", b.dataset.preset === id);
  $("presetNote").textContent = id === "custom" ? "Đang dùng cấu hình tự chỉnh." : PRESETS[id].note;
}
function readCfg() {
  const c = {};
  for (const el of $("dlg").querySelectorAll("[data-cfg]")) c[el.dataset.cfg] = el.type === "checkbox" ? el.checked : Number(el.value);
  return normalizeCfg(c);
}
function selectSettingsTab(name) {
  for (const b of $("dlg").querySelectorAll("[data-stab]")) b.setAttribute("aria-selected", String(b.dataset.stab === name));
  for (const p of $("dlg").querySelectorAll("[data-spanel]")) p.hidden = p.dataset.spanel !== name;
}
$("dlg").addEventListener("click", (e) => {
  const t = e.target.closest("[data-stab]");
  if (t) { selectSettingsTab(t.dataset.stab); return; }
  const p = e.target.closest("[data-preset]");
  if (p) { fillCfg(PRESETS[p.dataset.preset].cfg); return; }
  if (e.target.closest("#btnCancel")) $("dlg").close();
});
$("dlg").addEventListener("input", (e) => { if (e.target.closest("[data-cfg]")) fillCfg(readCfg()); });
// hướng dẫn lấy khóa: mở đúng mục theo nguồn đang chọn; báo ngay khi dán khóa sai dạng
function updateKeyGuide() {
  const p = $("sProvider").value;
  const want = p === "auto" ? "" : p;
  for (const d of $("keyGuides").querySelectorAll("[data-guide]")) d.open = !!want && d.dataset.guide === want;
  const h = keyHint(p, $("sKey").value);
  $("keyHint").className = "small " + h.level;
  $("keyHint").textContent = h.text;
}
$("sProvider").addEventListener("change", updateKeyGuide);
$("sKey").addEventListener("input", updateKeyGuide);

function readKeys() {
  const v = (id) => $(id).value.trim();
  return { gemini: v("sKeyGemini"), claude: v("sKeyClaude"), openai: v("sKeyOpenai"), customUrl: v("sCustomUrl"), customModel: v("sCustomModel"), customKey: v("sCustomKey") };
}

function openSettings() {
  $("sApi").value = settings.apiBase;
  $("sProvider").value = settings.provider;
  $("sKey").value = settings.aiKey;
  const ek = settings.keys ?? {};
  $("sKeyGemini").value = ek.gemini ?? ""; $("sKeyClaude").value = ek.claude ?? ""; $("sKeyOpenai").value = ek.openai ?? "";
  $("sCustomUrl").value = ek.customUrl ?? ""; $("sCustomModel").value = ek.customModel ?? ""; $("sCustomKey").value = ek.customKey ?? "";
  $("sKeep").value = String(settings.keepDays);
  $("sCode").value = settings.appCode;
  fillCfg(cfgFromSettings(settings));
  updateKeyGuide();
  selectSettingsTab("search");
  $("healthOut").textContent = "";
  if (!$("dlg").open) $("dlg").showModal();
}
$("btnSettings").addEventListener("click", openSettings);
$("settingsForm").addEventListener("submit", () => {
  settings = { apiBase: $("sApi").value.trim(), provider: $("sProvider").value, aiKey: $("sKey").value.trim(), keys: readKeys(), appCode: $("sCode").value.trim(), cfg: readCfg(), keepDays: Number($("sKeep").value) };
  saveSettings();
  store.prune({ days: settings.keepDays }).catch(() => {});
  toast("Đã lưu cài đặt");
  checkHealth();
});
$("btnUnblock").addEventListener("click", () => { limiter.clear(); toast("Đã xóa trạng thái tạm ngừng tên miền"); $("healthOut").textContent = ""; });
$("btnHealth").addEventListener("click", async () => {
  const keep = settings;
  settings = { ...settings, apiBase: $("sApi").value.trim(), appCode: $("sCode").value.trim(), aiKey: $("sKey").value.trim(), keys: readKeys() };
  $("healthOut").textContent = "Đang kiểm tra…";
  try {
    const h = await api.health();
    const ext = await bridge.status(true);
    const extTxt = ext.installed ? (ext.allowed ? "tiện ích Chrome: đã kết nối" : "tiện ích Chrome: CHƯA được phép (bấm biểu tượng tiện ích → Cho phép trang này)") : "tiện ích Chrome: chưa cài";
    const blockedHosts = Object.keys(limiter.blocked());
    const nExtra = ["gemini", "claude", "openai"].filter((p) => settings.keys?.[p]).length + (settings.keys?.customKey && settings.keys?.customUrl ? 1 : 0);
    const ai = settings.provider === "free" ? "chế độ MIỄN PHÍ" : (settings.aiKey || nExtra) ? `dùng khóa bạn nhập${settings.aiKey && nExtra ? ` + ${nExtra} khóa dự phòng` : nExtra > 1 ? ` (${nExtra} khóa, tự chuyển khi hết hạn mức)` : ""}` : settings.aiKey ? "dùng khóa bạn nhập" : h.mock ? "chế độ MẪU (chưa có khóa dịch vụ)" : h.serverKey.claude ? "máy chủ có khóa Claude" : h.serverKey.gemini ? "máy chủ có khóa Gemini" : "chế độ MIỄN PHÍ (không cần khóa)";
    $("healthOut").textContent = `Máy chủ: kết nối được · ${ai}${h.needsCode ? " · cần mã truy cập" : ""} · ${extTxt}${blockedHosts.length ? " · đang tạm ngừng: " + blockedHosts.join(", ") : ""}`;
  } catch { $("healthOut").textContent = "Không kết nối được máy chủ. Kiểm tra địa chỉ."; }
  settings = keep;
});

async function checkHealth() {
  try {
    const h = await api.health();
    const ext = await bridge.status();
    if (ext.installed && ext.allowed && ["auto", "chrome"].includes(settings.provider)) { $("modeTag").textContent = "Google Chrome"; return; }
    if (ext.installed && !ext.allowed && ["auto", "chrome"].includes(settings.provider)) { $("modeTag").textContent = "Tiện ích Chrome: bấm biểu tượng → Cho phép trang này"; return; }
    const free = settings.provider === "free" || (!settings.aiKey && !Object.values(settings.keys ?? {}).some(Boolean) && !h.serverKey.claude && !h.serverKey.gemini && !h.serverKey.openai && !h.serverKey.custom && !h.mock);
    $("modeTag").textContent = settings.provider !== "free" && h.mock && !settings.aiKey ? "Chế độ mẫu · dữ liệu hư cấu" : free ? "Tìm miễn phí · không cần khóa" : "Tìm · lưu · so sánh";
  } catch { $("modeTag").textContent = "Không kết nối được máy chủ"; }
}

// ---------- PWA ----------
let deferred = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("btnInstall").hidden = false; });
$("btnInstall").addEventListener("click", async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $("btnInstall").hidden = true; });
window.addEventListener("appinstalled", () => ($("btnInstall").hidden = true));
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ---------- cập nhật tiện ích ----------
async function checkExtUpdate() {
  let latest = null;
  try { const r = await fetch("ext/version.json", { cache: "no-store" }); if (r.ok) latest = await r.json(); } catch { /* chưa có bản phát hành */ }
  const st = await bridge.status();
  let dismissed = "";
  try { dismissed = localStorage.getItem("po-ext-dismissed") || ""; } catch { /* chế độ riêng tư */ }
  const n = extUpdateNotice(st, latest, dismissed);
  const desktop = window.matchMedia("(pointer: fine)").matches;
  $("extHint").hidden = !(n && n.kind === "install" && desktop);
  $("extVer").textContent = latest ? `(mới nhất ${latest.version}${st.installed ? ", đang dùng " + st.version : ""})` : "";
  const b = $("extBanner");
  if (!n || n.kind === "install") { b.hidden = true; return; }
  b.innerHTML = n.kind === "store"
    ? `<b>Tiện ích Chrome có bản mới ${esc(n.latest)}</b> (đang dùng ${esc(n.current)}). Chrome sẽ tự cập nhật qua Web Store, không cần làm gì.`
    : `<b>Tiện ích Chrome có bản mới ${esc(n.latest)}</b> (đang dùng ${esc(n.current)}). Nếu bạn nạp từ thư mục dự án: chạy <code>git pull</code> hoặc giải nén <a href="ext/mua-hang-extension.zip" download>bản mới</a> đè lên thư mục cũ — tiện ích <b>tự tải lại</b> trong khoảng 1 phút. <button type="button" class="chip" id="extDismiss">Ẩn</button>`;
  b.hidden = false;
  $("extDismiss")?.addEventListener("click", () => { try { localStorage.setItem("po-ext-dismissed", n.latest); } catch { /* bỏ qua */ } b.hidden = true; });
}

// ---------- khởi động ----------
const qs = new URLSearchParams(location.search);
if (qs.get("q")) { $("q").value = qs.get("q"); fillNeed(parseNeed($("q").value)); }
store.prune({ days: settings.keepDays }).catch(() => {}).finally(refreshRecent); // tự xóa dữ liệu cũ
checkHealth();
checkExtUpdate();
intentHint();

// cho kiểm thử giao diện từ bên ngoài
window.__po = { run, openKey, checkExtUpdate, bridge, get current() { return current; }, store };
