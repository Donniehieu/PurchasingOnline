import { createApi, ApiError } from "./lib/api.js";
import { createStore } from "./lib/store.js";
import { createBridge } from "./lib/bridge.js";
import { createLimiter } from "./lib/limiter.js";
import { createHybridApi } from "./lib/hybrid.js";
import { extUpdateNotice } from "./lib/version.js";
import { mountOfferTable } from "./table-ui.js";
import { research, ask, STEPS } from "./lib/pipeline.js";
import { INTENTS } from "./lib/answer.js";
import { esc, clip, parseVnd } from "./lib/text.js";
import { parseNeed } from "./lib/need.js";
import { renderAdvice } from "./advice-ui.js";
import { renderBanner, renderHeadline, renderVerdict, renderSummary, renderCompare, renderImages, renderTech, renderLog, renderSources, renderHistoryItem, renderSuppliers, chip } from "./render.js";

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = "po-settings";

function loadSettings() {
  try { return { apiBase: "", provider: "auto", aiKey: "", appCode: "", pages: 8, keepDays: 30, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { return { apiBase: "", provider: "auto", aiKey: "", appCode: "", pages: 8, keepDays: 30 }; }
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
  scheduleRender();
  renderAskChips();
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  // rAF bị trình duyệt tạm dừng khi tab ở nền: dùng thêm setTimeout để dữ liệu vẫn được vẽ
  const go = () => { if (!renderQueued) return; renderQueued = false; if (current) render(current); };
  requestAnimationFrame(go);
  setTimeout(go, 120);
}

// bảng NCC dựng một lần (giữ nguyên ô lọc, thứ tự sắp xếp, cột ẩn khi dữ liệu cập nhật)
const offerTable = mountOfferTable($("tab-table"), {
  toast,
  onMore: () => { if (current && !runCtl) { $("q").value = current.plan.query; run(current.plan.query, { mode: "enrich" }); } },
});

function render(entry) {
  $("banner").innerHTML = renderBanner(entry);
  $("headline").innerHTML = renderHeadline(entry);
  const v = renderVerdict(entry);
  $("verdict").hidden = !v;
  $("verdict").innerHTML = v;
  $("tab-summary").innerHTML = renderSummary(entry);
  $("tab-advice").innerHTML = renderAdvice(entry, readNeed(), choices.get(entry.key) ?? entry.need?.choice ?? "");
  $("tab-suppliers").innerHTML = renderSuppliers(entry);
  offerTable.update(entry);
  $("tab-compare").innerHTML = renderCompare(entry);
  $("tab-tech").innerHTML = renderTech(entry);
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
    if (ev.status === "running" || ev.text) $("liveText").textContent = `${STEPS.find((s) => s.id === ev.id)?.label ?? ""}: ${ev.text || "đang chạy…"}`;
  } else if (ev.type === "entry") {
    if (!current || current.key !== ev.entry.key || current !== ev.entry) showResult(ev.entry); else scheduleRender();
  }
}

function setRunning(on) {
  if (on) $("progress").hidden = false;
  $("btnGo").disabled = on;
  $("btnStop").hidden = !on;
  $("progress").querySelector(".live").classList.toggle("idle", !on);
  if (!on) $("liveText").textContent = "Hoàn tất";
}

async function run(text, { mode = "enrich", force = false, ocrText = "" } = {}) {
  if (runCtl) return;
  const input = { text: text.trim(), category: $("cat").value, ocrText };
  if (!input.text) { toast("Nhập tên hoặc mã sản phẩm trước"); $("q").focus(); return; }
  runCtl = new AbortController();
  $("errorBox").hidden = true;
  current = null;
  initSteps();
  setRunning(true);
  try {
    const entry = await research(input, { api, store, emit: onEvent, signal: runCtl.signal, mode: force ? "fresh" : mode, pageLimit: settings.pages });
    entry.need = { ...readNeed(), choice: choices.get(entry.key) ?? entry.need?.choice ?? "" };
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
  }
}

$("form").addEventListener("submit", (e) => { e.preventDefault(); run($("q").value, { mode: $("mode").value, ocrText: ocrCtx }); });
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); $("form").requestSubmit(); } });
$("btnStop").addEventListener("click", () => runCtl?.abort());

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
  current.need = { ...readNeed(), choice: choices.get(current.key) ?? "" };
  store.save(current).catch(() => {});
}
$("tab-advice").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pick]");
  if (!b || !current) return;
  choices.set(current.key, b.dataset.pick);
  persistNeed();
  $("tab-advice").innerHTML = renderAdvice(current, readNeed(), b.dataset.pick);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---------- hỏi đáp ----------
function renderAskChips() {
  if (!current) return;
  const ids = ["price", "pros", "cons", ...(current.category === "tech" ? ["tech", "techcmp"] : []), "choose"];
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
$("btnPhoto").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", () => { const f = $("file").files?.[0]; $("file").value = ""; if (f) readImage(f); });

async function readImage(f) {
  if (!f || !String(f.type || "image/").startsWith("image/")) { toast("Đây không phải ảnh"); return; }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(f);
  $("pastePreview").src = previewUrl;
  $("pasteInfo").hidden = false;
  $("ocrNote").textContent = "Đang đọc ảnh…";
  try {
    const image = await shrink(f);
    const r = await api.ocr(image);
    const o = r.ocr ?? {};
    if (o.unreadable) { $("ocrNote").textContent = "Ảnh khó đọc: " + clip(o.text || "chụp rõ hơn, gần nhãn/mã model", 80); return; }
    const text = [o.brand, o.name].filter(Boolean).join(" ").trim() || (o.keywords ?? [])[0] || "";
    const withModel = o.model && !text.toUpperCase().includes(String(o.model).toUpperCase()) ? `${text} ${o.model}` : text;
    $("q").value = withModel.trim();
    $("q").dispatchEvent(new Event("input"));
    ocrCtx = (o.specs ?? []).slice(0, 4).join(" ");
    $("ocrNote").textContent = "Đã đọc từ ảnh — kiểm tra rồi bấm Tìm hiểu" + (r.mock ? " (mẫu)" : "");
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
}
$("pasteClear").addEventListener("click", clearImage);
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
function openSettings() {
  $("sApi").value = settings.apiBase;
  $("sProvider").value = settings.provider;
  $("sKey").value = settings.aiKey;
  $("sKeep").value = String(settings.keepDays);
  $("sCode").value = settings.appCode;
  $("sPages").value = settings.pages;
  $("sPagesVal").textContent = settings.pages;
  $("healthOut").textContent = "";
  if (!$("dlg").open) $("dlg").showModal();
}
$("btnSettings").addEventListener("click", openSettings);
$("sPages").addEventListener("input", () => ($("sPagesVal").textContent = $("sPages").value));
$("settingsForm").addEventListener("submit", () => {
  settings = { apiBase: $("sApi").value.trim(), provider: $("sProvider").value, aiKey: $("sKey").value.trim(), appCode: $("sCode").value.trim(), pages: Number($("sPages").value), keepDays: Number($("sKeep").value) };
  saveSettings();
  store.prune({ days: settings.keepDays }).catch(() => {});
  toast("Đã lưu cài đặt");
  checkHealth();
});
$("btnUnblock").addEventListener("click", () => { limiter.clear(); toast("Đã xóa trạng thái tạm ngừng tên miền"); $("healthOut").textContent = ""; });
$("btnHealth").addEventListener("click", async () => {
  const keep = settings;
  settings = { ...settings, apiBase: $("sApi").value.trim(), appCode: $("sCode").value.trim(), aiKey: $("sKey").value.trim() };
  $("healthOut").textContent = "Đang kiểm tra…";
  try {
    const h = await api.health();
    const ext = await bridge.status(true);
    const extTxt = ext.installed ? (ext.allowed ? "tiện ích Chrome: đã kết nối" : "tiện ích Chrome: CHƯA được phép (bấm biểu tượng tiện ích → Cho phép trang này)") : "tiện ích Chrome: chưa cài";
    const blockedHosts = Object.keys(limiter.blocked());
    const ai = settings.provider === "free" ? "chế độ MIỄN PHÍ" : settings.aiKey ? "dùng khóa bạn nhập" : h.mock ? "chế độ MẪU (chưa có khóa dịch vụ)" : h.serverKey.claude ? "máy chủ có khóa Claude" : h.serverKey.gemini ? "máy chủ có khóa Gemini" : "chế độ MIỄN PHÍ (không cần khóa)";
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
    const free = settings.provider === "free" || (!settings.aiKey && !h.serverKey.claude && !h.serverKey.gemini && !h.mock);
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

// cho kiểm thử giao diện từ bên ngoài
window.__po = { run, openKey, checkExtUpdate, bridge, get current() { return current; }, store };
