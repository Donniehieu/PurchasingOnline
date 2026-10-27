// Bảng so sánh NCC trên web: ẩn/hiện cột, lọc, sắp xếp, giữ chuột kéo để xem các cột trái/phải, xuất Excel.
import { OFFER_COLUMNS, tableRows, applyView, DEFAULT_VIEW, PRICE_NOTE, VAT_LABEL, diagnose } from "./lib/offers.js";
import { exportOffersXlsx } from "./lib/xlsx-export.js";
import { esc, money, clip } from "./lib/text.js";

const KEY = "po-table-view";
const FILTER_COLS = ["name", "price", "vat", "specs", "ncc", "contact", "link"];
const PLACEHOLDER = { name: "lọc tên/model", price: "<3tr · 2tr-3tr", specs: "công suất>=1500; inverter", ncc: "lọc NCC/hãng", contact: "lọc SĐT/email", link: "lọc trang" };
const GOOD = { included: "good", excluded: "warn", rate: "good", unknown: "" };

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify({ hidden: [...state.hidden], sort: state.view.sort, source: state.view.source, group: state.view.group })); } catch { /* chế độ riêng tư */ }
}

export function mountOfferTable(host, { onMore = () => {}, toast = () => {} } = {}) {
  const saved = loadSaved();
  const state = {
    view: { ...DEFAULT_VIEW, filters: { ...DEFAULT_VIEW.filters }, source: saved.source || DEFAULT_VIEW.source, group: saved.group || DEFAULT_VIEW.group, sort: saved.sort && "col" in saved.sort ? saved.sort : { ...DEFAULT_VIEW.sort } },
    hidden: new Set(saved.hidden ?? []),
    entry: null,
    shown: [],
  };

  host.innerHTML = `
    <div class="card tbl-card">
      <div class="tbl-bar">
        <input type="search" class="tbl-q" placeholder="Lọc nhanh: tên, NCC, thông số…" aria-label="Lọc nhanh">
        <select class="tbl-src btn ghost sm" aria-label="Nguồn dữ liệu">
          <option value="page">Chỉ dữ liệu đã đọc từ đúng trang</option>
          <option value="all">Gồm cả dữ liệu chưa xác nhận (Google/danh sách)</option>
        </select>
        <select class="tbl-grp btn ghost sm" aria-label="Nhóm theo">
          <option value="none">Không nhóm</option>
          <option value="seller">Nhóm theo NCC (website)</option>
          <option value="brand">Nhóm theo hãng sản xuất</option>
        </select>
        <select class="tbl-kind btn ghost sm" aria-label="Loại dòng">
          <option value="all">Tất cả dòng</option>
          <option value="same">Cùng sản phẩm (nhiều NCC)</option>
          <option value="other">Hãng / sản phẩm khác</option>
        </select>
        <span class="tbl-cols"><button type="button" class="btn ghost sm tbl-colbtn" aria-expanded="false">Cột ▾</button><div class="tbl-colmenu" hidden></div></span>
        <button type="button" class="btn ghost sm tbl-reset">Xóa lọc</button>
        <button type="button" class="btn ghost sm tbl-more">Tìm thêm NCC</button>
        <button type="button" class="btn primary sm tbl-export">Xuất Excel (.xlsx)</button>
      </div>
      <div class="tbl-diag alert warn" hidden></div>
      <div class="tbl-info muted small" aria-live="polite"></div>
      <div class="tbl-wrap" tabindex="0" role="region" aria-label="Bảng so sánh nhà cung cấp, kéo chuột hoặc cuộn để xem các cột">
        <table class="otbl"><thead><tr class="h"></tr><tr class="f"></tr></thead><tbody></tbody></table>
      </div>
      <p class="muted small">Giữ chuột kéo trái/phải (hoặc cuộn) để xem các cột. Bấm tên cột để sắp xếp, dấu × để ẩn cột, nút “Cột” để hiện lại. Lọc giá: <code>&lt;3tr</code>, <code>&gt;2000000</code>, <code>2tr-3tr</code>. Lọc thông số kỹ thuật (cách nhau bằng dấu <code>;</code>, phải đúng hết): <code>inverter</code>, <code>công suất: 1500</code>, <code>công suất&gt;=1500</code>, <code>dung tích&lt;=6 lít</code>; số phải khớp trọn (1500 không khớp 15000). Xuất Excel theo đúng bảng đang xem (cột đang hiện, dòng đã lọc và sắp xếp).</p>
    </div>`;

  const $ = (s) => host.querySelector(s);
  $(".tbl-src").value = state.view.source;
  $(".tbl-grp").value = state.view.group;
  const diag = $(".tbl-diag");
  const table = $(".otbl"), tbody = $("tbody"), hrow = $("tr.h"), frow = $("tr.f"), wrap = $(".tbl-wrap"), info = $(".tbl-info"), menu = $(".tbl-colmenu");

  // ----- đầu bảng (dựng một lần: ô lọc không bị mất khi dữ liệu cập nhật) -----
  hrow.innerHTML = OFFER_COLUMNS.map((c) => `<th data-col="${c.id}"><button type="button" class="th-sort" data-sort="${c.id}">${esc(c.label)} <span class="arr"></span></button>${c.id === "stt" ? "" : `<button type="button" class="th-hide" data-hide="${c.id}" title="Ẩn cột" aria-label="Ẩn cột ${esc(c.label)}">×</button>`}</th>`).join("");
  frow.innerHTML = OFFER_COLUMNS.map((c) => {
    if (!FILTER_COLS.includes(c.id)) return `<th data-col="${c.id}"></th>`;
    if (c.id === "vat") return `<th data-col="vat"><select data-filter="vat" aria-label="Lọc VAT"><option value="">tất cả</option>${Object.entries(VAT_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></th>`;
    return `<th data-col="${c.id}"><input type="search" data-filter="${c.id}" placeholder="${esc(PLACEHOLDER[c.id])}" aria-label="Lọc ${esc(c.label)}"${c.id === "specs" ? ' title="Nhiều điều kiện cách nhau bằng dấu ; ví dụ: công suất>=1500; inverter. Số phải khớp trọn."' : ""}></th>`;
  }).join("");
  menu.innerHTML = OFFER_COLUMNS.filter((c) => c.id !== "stt").map((c) => `<label><input type="checkbox" data-colchk="${c.id}"> ${esc(c.label)}</label>`).join("") + `<button type="button" class="btn ghost sm" data-showall>Hiện tất cả cột</button>`;

  const visibleIds = () => OFFER_COLUMNS.filter((c) => !state.hidden.has(c.id)).map((c) => c.id);
  function applyColumns() {
    for (const c of OFFER_COLUMNS) table.classList.toggle("hide-" + c.id, state.hidden.has(c.id));
    for (const chk of menu.querySelectorAll("[data-colchk]")) chk.checked = !state.hidden.has(chk.dataset.colchk);
  }
  function applySortMarks() {
    for (const b of hrow.querySelectorAll("[data-sort]")) {
      const on = state.view.sort?.col === b.dataset.sort;
      b.querySelector(".arr").textContent = on ? (state.view.sort.dir === "asc" ? "▲" : "▼") : "";
      b.closest("th").setAttribute("aria-sort", on ? (state.view.sort.dir === "asc" ? "ascending" : "descending") : "none");
    }
  }

  // ----- thân bảng -----
  const vatCell = (r) => `<span class="badge ${GOOD[r.vat?.state ?? "unknown"]}" title="${esc(r.vat?.text || "")}">${esc(r.vatLabel)}</span>`;
  const priceCell = (r) => (r.price == null
    ? `<span class="muted">Liên hệ</span>`
    : `<b>${money(r.price)}</b><div class="muted small">${esc(PRICE_NOTE[r.priceVia] || "")}</div>`);
  const specsCell = (r) => (r.specs?.length ? `<div class="specs" title="${esc(r.specText)}">${r.specs.slice(0, 12).map((s) => `<div><span class="muted">${esc(s.k)}:</span> ${esc(clip(s.v, 80))}</div>`).join("")}</div>` : `<span class="muted">—</span>`);
  const contactCell = (r) => {
    const c = r.contact;
    if (!r.contactText) return `<span class="muted">—</span>`;
    const tel = (p) => `<a href="tel:${esc(p.replace(/\s/g, ""))}">${esc(p)}</a>`;
    const zl = (z) => `<a href="https://zalo.me/${esc(z.replace(/\s/g, ""))}" target="_blank" rel="noopener noreferrer">${esc(z)}</a>`;
    return [
      c.phones?.length ? `<div><span class="muted">SĐT:</span> ${c.phones.map(tel).join(", ")}</div>` : "",
      c.emails?.length ? `<div><span class="muted">Email:</span> ${c.emails.map((e) => `<a href="mailto:${esc(e)}">${esc(e)}</a>`).join(", ")}</div>` : "",
      c.zalo?.length ? `<div><span class="muted">Zalo:</span> ${c.zalo.map(zl).join(", ")}</div>` : "",
      c.address ? `<div><span class="muted">Địa chỉ:</span> ${esc(c.address)}</div>` : "",
    ].join("");
  };
  let lastGroup = null;
  function groupRow(r, rows) {
    if (state.view.group === "none" || r.group === lastGroup) return "";
    lastGroup = r.group;
    const same = rows.filter((x) => x.group === r.group);
    const min = same.filter((x) => x.price != null).reduce((a, b) => (a == null || b.price < a ? b.price : a), null);
    return `<tr class="grp"><td colspan="${OFFER_COLUMNS.length}"><b>${state.view.group === "brand" ? "Hãng" : "NCC"}: ${esc(r.group)}</b> <span class="muted">· ${same.length} dòng${min != null ? " · giá thấp nhất " + money(min) : ""}</span></td></tr>`;
  }
  function rowHtml(r) {
    return `<tr>
      <td data-col="stt" class="num">${r.stt}</td>
      <td data-col="name"><a class="prodlink" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" title="Mở đúng trang sản phẩm đã lấy dữ liệu"><b>${esc(r.name || r.nameText)}</b></a>${r.model ? `<div class="muted small">Model: ${esc(r.model)}</div>` : ""}${r.kind === "other" ? ` <span class="badge">hãng khác</span>` : ""}</td>
      <td data-col="price" class="num">${priceCell(r)}</td>
      <td data-col="vat">${vatCell(r)}</td>
      <td data-col="specs">${specsCell(r)}</td>
      <td data-col="ncc"><div><span class="muted">NCC:</span> <b>${esc(r.seller)}</b></div>${r.brand ? `<div><span class="muted">Hãng:</span> ${esc(r.brand)}</div>` : ""}</td>
      <td data-col="contact">${contactCell(r)}</td>
      <td data-col="link"><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.domain)}</a><div class="muted small linkurl" title="${esc(r.url)}">${esc(clip(r.url, 60))}</div></td>
    </tr>`;
  }

  function filterText() {
    const f = state.view.filters, parts = [];
    if (state.view.q) parts.push(`tìm “${state.view.q}”`);
    if (state.view.kind !== "all") parts.push(state.view.kind === "same" ? "cùng sản phẩm" : "hãng khác");
    for (const [k, v] of Object.entries(f)) if (v) parts.push(`${OFFER_COLUMNS.find((c) => c.id === k)?.label}: ${k === "vat" ? VAT_LABEL[v] : v}`);
    return parts.join("; ");
  }

  function render() {
    if (!state.entry) return;
    const all = tableRows(state.entry);
    state.shown = applyView(all, state.view);
    lastGroup = null;
    const hiddenUnread = state.view.source === "page" ? all.filter((r) => !r.read).length : 0;
    tbody.innerHTML = state.shown.length
      ? state.shown.map((r) => groupRow(r, state.shown) + rowHtml(r)).join("")
      : `<tr><td colspan="${OFFER_COLUMNS.length}" class="muted empty">${all.length ? (hiddenUnread ? `Chưa có dòng nào đã đọc từ đúng trang. Có ${hiddenUnread} dòng chưa xác nhận: chọn “Gồm cả dữ liệu chưa xác nhận”.` : "Không có dòng nào khớp bộ lọc. Bấm “Xóa lọc”.") : state.entry.status === "running" ? "Đang thu thập dữ liệu từ các trang web…" : "Chưa có nhà cung cấp nào."}</td></tr>`;
    // khi ít hoặc không có dữ liệu: nói rõ vì sao và cách khắc phục
    const d = state.entry.status === "running" ? { title: "" } : diagnose(state.entry, state.shown.length, hiddenUnread);
    diag.hidden = !(d.title && state.shown.length < 3);
    if (!diag.hidden) diag.innerHTML = `<b>${esc(d.title)}</b><ul>${d.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
    const sellers = new Set(state.shown.map((r) => r.seller));
    const priced = state.shown.filter((r) => r.price != null);
    const min = priced.length ? priced.reduce((a, b) => (b.price < a.price ? b : a)) : null;
    info.textContent = `${state.shown.length}/${all.length} dòng${hiddenUnread ? ` (${hiddenUnread} dòng chưa xác nhận đang ẩn)` : ""} · ${sellers.size} NCC${min ? ` · giá thấp nhất ${money(min.price)} (${min.seller})` : ""}${filterText() ? " · đang lọc" : ""}`;
    applyColumns();
    applySortMarks();
  }

  // ----- sự kiện -----
  let timer;
  host.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches(".tbl-q")) state.view.q = t.value;
    else if (t.matches("[data-filter]")) state.view.filters[t.dataset.filter] = t.value;
    else return;
    clearTimeout(timer);
    timer = setTimeout(render, 150);
  });
  host.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches(".tbl-kind")) { state.view.kind = t.value; render(); }
    else if (t.matches(".tbl-src")) { state.view.source = t.value; save(state); render(); }
    else if (t.matches(".tbl-grp")) { state.view.group = t.value; save(state); render(); }
    else if (t.matches("[data-filter=vat]")) { state.view.filters.vat = t.value; render(); }
    else if (t.matches("[data-colchk]")) { if (t.checked) state.hidden.delete(t.dataset.colchk); else state.hidden.add(t.dataset.colchk); save(state); applyColumns(); }
  });
  host.addEventListener("click", async (e) => {
    const t = e.target;
    const sort = t.closest("[data-sort]");
    if (sort) {
      const col = sort.dataset.sort, cur = state.view.sort;
      state.view.sort = cur?.col === col ? (cur.dir === "asc" ? { col, dir: "desc" } : { col: null, dir: "asc" }) : { col, dir: "asc" };
      save(state); render(); return;
    }
    const hide = t.closest("[data-hide]");
    if (hide) { state.hidden.add(hide.dataset.hide); save(state); applyColumns(); return; }
    if (t.closest("[data-showall]")) { state.hidden.clear(); save(state); applyColumns(); return; }
    if (t.closest(".tbl-colbtn")) { const open = menu.hidden; menu.hidden = !open; $(".tbl-colbtn").setAttribute("aria-expanded", String(open)); return; }
    if (!t.closest(".tbl-cols")) menu.hidden = true;
    if (t.closest(".tbl-reset")) {
      state.view.q = ""; state.view.kind = "all"; state.view.filters = { ...DEFAULT_VIEW.filters };
      $(".tbl-q").value = ""; $(".tbl-kind").value = "all";
      for (const el of host.querySelectorAll("[data-filter]")) el.value = "";
      render(); return;
    }
    if (t.closest(".tbl-more")) { onMore(); return; }
    if (t.closest(".tbl-export")) {
      if (!state.shown.length) return toast("Chưa có dòng nào để xuất");
      const btn = $(".tbl-export");
      btn.disabled = true;
      try {
        const r = await exportOffersXlsx(state.shown, visibleIds(), { product: state.entry.product.name, query: state.entry.plan.query, filterText: filterText(), generatedAt: Date.now() });
        toast(`Đã xuất ${state.shown.length} dòng: ${r.name}`);
      } catch (err) { toast("Không xuất được Excel: " + err.message); }
      finally { btn.disabled = false; }
    }
  });

  // giữ chuột kéo để xem các cột trái/phải (và lên/xuống); ô nhập, nút, liên kết vẫn dùng bình thường
  let drag = null, suppressClick = false;
  wrap.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || e.target.closest("input,select,button,a,textarea,summary,label")) return;
    drag = { x: e.clientX, y: e.clientY, l: wrap.scrollLeft, t: wrap.scrollTop, moved: false };
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add("dragging");
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    wrap.scrollLeft = drag.l - dx;
    wrap.scrollTop = drag.t - dy;
  });
  const endDrag = () => { if (!drag) return; suppressClick = drag.moved; drag = null; wrap.classList.remove("dragging"); setTimeout(() => { suppressClick = false; }, 0); };
  wrap.addEventListener("pointerup", endDrag);
  wrap.addEventListener("pointercancel", endDrag);
  wrap.addEventListener("click", (e) => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); } }, true);
  // bấm vào ô thông số để mở rộng/thu gọn
  wrap.addEventListener("click", (e) => { const s = e.target.closest(".specs"); if (s) s.classList.toggle("open"); });

  applyColumns();
  applySortMarks();
  return {
    update(entry) { state.entry = entry; render(); },
    get view() { return state.view; },
    get shown() { return state.shown; },
    visibleIds,
  };
}
