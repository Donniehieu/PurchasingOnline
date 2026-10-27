// Dựng HTML từ entry (thuần chuỗi, không đụng DOM). Mọi dữ liệu từ web đều được thoát ký tự.
import { esc, money, clip } from "./lib/text.js";
import { summarize, comparisonRows, recommend, logBySection, technologyComparison } from "./lib/aggregate.js";
import { CATEGORY_LABELS } from "./lib/plan.js";
import { MAX_IMAGES } from "./lib/entry.js";
import { suppliersOf } from "./lib/offers.js";
import { contactText } from "./lib/contact.js";
import { techLandscape, PRIORITY_LABEL } from "./lib/techkb.js";

const RUN_LABEL = { pages: "trang", prices: "giá", pros: "ưu điểm", cons: "nhược điểm", tech: "công nghệ", images: "ảnh", alts: "hãng" };
const SECTION_LABEL = { price: "Giá", pros: "Ưu điểm", cons: "Nhược điểm", tech: "Công nghệ", images: "Hình ảnh" };
const time = (ts) => new Date(ts).toLocaleTimeString("vi-VN", { hour12: false });
const dateTime = (ts) => new Date(ts).toLocaleString("vi-VN", { hour12: false, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const httpUrl = (u) => (/^https?:\/\//i.test(u) ? u : "#");

export const catLabel = (c) => CATEGORY_LABELS[c] ?? c;

export function chip(entry, id) {
  const s = entry.sources.find((x) => x.id === id);
  if (!s) return "";
  const unv = s.verified === false;
  return `<a class="src${unv ? " unv" : ""}" href="${esc(httpUrl(s.url))}" target="_blank" rel="noopener noreferrer" title="${esc(s.title || s.url)}${unv ? " — chưa kiểm chứng được trong kết quả tìm kiếm" : ""}">[${s.id}] ${esc(s.domain)}${unv ? " ?" : ""}</a>`;
}
export const chips = (entry, ids, max = 3) => [...new Set(ids ?? [])].slice(0, max).map((i) => chip(entry, i)).join(" ");

export function renderBanner(entry) {
  const out = [];
  if (entry.ai?.mock) out.push(`<div class="alert warn"><b>Dữ liệu mẫu:</b> sản phẩm và hãng là hư cấu, không dùng để mua hàng.</div>`);
  if (entry.scenario === "explore") out.push(`<div class="alert info">Chưa đủ thông tin để tư vấn chi tiết. <button type="button" class="chip" data-need-more="1">Bổ sung thông tin</button></div>`);
  if (entry.status === "partial") out.push(`<div class="alert info">Đã dừng giữa chừng — đang hiện phần dữ liệu thu được.</div>`);
  if (entry.status === "error") out.push(`<div class="alert err">Lần tìm này chưa hoàn tất. Dữ liệu bên dưới (nếu có) là phần thu được trước khi lỗi.</div>`);
  return out.join("");
}

export function renderHeadline(entry) {
  const s = summarize(entry);
  const p = entry.product;
  const sub = [p.brand, p.model, ...(entry.asked?.adds ?? [])].filter(Boolean).join(" · ");
  const range = s.price.count > 1 && s.price.min !== s.price.max ? `khoảng ${money(s.price.min)} – ${money(s.price.max)} · ` : "";
  const imgs = s.images.filter((i) => i.for === "main").slice(0, entry.imageLimit ?? MAX_IMAGES);
  return `
    <div class="top-line">
      <span class="badge">${esc(catLabel(entry.category))}</span>
      ${entry.fromCache ? `<span class="badge good">Từ cache · ${esc(dateTime(entry.updatedAt))}</span>` : entry.status === "running" ? `<span class="badge warn">${entry.runs?.length ? "Từ cache · đang bổ sung dữ liệu mới…" : "Đang thu thập…"}</span>` : `<span class="badge good">Vừa cập nhật</span>`}
      ${entry.runs?.length > 1 ? `<span class="badge">${entry.runs.length} lần tìm</span>` : ""}
      ${entry.ai ? `<span class="badge">${entry.ai.mock ? "Dữ liệu mẫu" : entry.ai.chrome ? "Google (Chrome)" : entry.ai.free ? "Tìm miễn phí" : esc(entry.ai.provider)}</span>` : ""}
    </div>
    <div><h1>${esc(p.name || entry.plan.query)}</h1>${sub ? `<div class="muted">${esc(sub)}</div>` : ""}</div>
    <div>
      ${entry.scenario === "explore" ? (s.price.count ? `<div class="price-big">${s.price.min !== s.price.max ? `${money(s.price.min)} – ${money(s.price.max)}` : money(s.price.median)}</div><div class="price-sub">Khoảng giá tham khảo của nhiều loại khác nhau. Bổ sung thông tin để có giá cụ thể.</div>` : `<div class="price-big muted">Chưa có giá cụ thể</div><div class="price-sub">Bổ sung hãng, mã hoặc thông số để tìm giá.</div>`) : s.price.count ? `<div class="price-big">${money(s.price.median)}</div><div class="price-sub">Giá trung bình · ${range}${s.price.count} nguồn ${chips(entry, s.price.items.map((i) => i.srcId), 3)}</div>` : `<div class="price-big muted">Chưa có giá xác thực</div><div class="price-sub">Nên hỏi báo giá nhà cung cấp.</div>`}
    </div>
    ${imgs.length ? `<div class="gallery">${imgs.map((i) => imgTag(i)).join("")}</div>` : ""}
    ${p.summary ? `<p style="margin:0">${esc(p.summary)}</p>` : ""}
    <div><button type="button" class="btn ghost sm" data-act="more" ${entry.status === "running" ? "disabled" : ""}>Tìm thêm dữ liệu mới</button></div>`;
}

function imgTag(i, link = true) {
  const img = `<img src="${esc(httpUrl(i.url))}" alt="${esc(i.alt || "")}" loading="lazy" referrerpolicy="no-referrer" data-hide="1">`;
  return link ? `<a href="${esc(httpUrl(i.url))}" target="_blank" rel="noopener noreferrer">${img}</a>` : img;
}

export function renderVerdict(entry) {
  if (entry.scenario === "explore") return ""; // thiếu thông tin: không nêu "lựa chọn tối ưu"
  const rec = recommend(entry);
  if (!rec.comparable || !rec.best) return "";
  const b = rec.best;
  const nm = (r) => esc([r.brand !== "—" ? r.brand : "", r.model || r.name].filter(Boolean).join(" "));
  const pending = entry.status === "running" ? ` <span class="badge warn">tạm thời, đang cập nhật</span>` : "";
  return `
    <h2>Lựa chọn tối ưu${pending}</h2>
    <p><b>${nm(b)}</b>${b.price ? ` — ${money(b.price)}` : ""}${b.isMain ? " (sản phẩm bạn đang xem)" : ""}. Lý do: ${esc(rec.reasons.join("; "))}. ${chips(entry, b.priceSrcIds)}</p>
    <p class="muted small">${rec.cheapest && rec.cheapest !== b ? `Rẻ nhất: ${nm(rec.cheapest)} (${money(rec.cheapest.price)}). ` : ""}${rec.bestMerit && rec.bestMerit !== b ? `Ưu/nhược cân bằng nhất: ${nm(rec.bestMerit)}. ` : ""}Chọn từ dữ liệu đã lấy, không tìm thêm.</p>`;
}

function itemList(entry, list, cls, empty) {
  if (!list.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<ul class="items ${cls}">${list.map((x) => `<li>${chips(entry, x.srcIds)} <span class="t">${esc(x.text)}</span></li>`).join("")}</ul>`;
}

export function renderSummary(entry) {
  const s = summarize(entry);
  const running = entry.status === "running";
  const wait = running ? "Đang thu thập…" : "Chưa có dữ liệu.";
  const priceRows = s.price.items.map((i) => `<li><span class="t"><b>${money(i.value)}</b> ${chip(entry, i.srcId)}</span></li>`).join("");
  return `
    ${entry.scenario === "explore" ? `<div class="card"><h2>Khoảng giá tham khảo</h2><p style="margin:0">${s.price.count ? (s.price.min !== s.price.max ? `${money(s.price.min)} – ${money(s.price.max)}` : money(s.price.median)) : "Chưa có"}</p><p class="muted small" style="margin:6px 0 0">Các giá thu được thuộc nhiều loại sản phẩm khác nhau nên không dùng để so sánh báo giá. Bổ sung thông tin để có giá và nhà cung cấp cụ thể. <button type="button" class="chip" data-need-more="1">Bổ sung thông tin</button></p></div>` : `<div class="card"><h2>Giá <span class="count">${s.price.count ? `trung bình ${money(s.price.median)}` : ""}</span></h2>
      ${priceRows ? `<ul class="items">${priceRows}</ul>` : `<p class="muted">${wait}</p>`}
    </div>`}
    <div class="card"><h2>Ưu điểm <span class="count">${s.pros.length}</span></h2>${itemList(entry, s.pros, "pros", wait)}</div>
    <div class="card"><h2>Nhược điểm <span class="count">${s.cons.length}</span></h2>${itemList(entry, s.cons, "cons", wait)}</div>
    ${s.usage.length ? `<div class="card"><h2>Cách dùng <span class="count">${s.usage.length}</span></h2><ol class="items">${s.usage.map((x) => `<li><span class="t">${esc(x.text)}</span> ${chips(entry, x.srcIds)}</li>`).join("")}</ol></div>` : ""}
    ${entry.category === "tech"
      ? `<div class="card"><h2>Công nghệ &amp; tính năng chung nhóm sản phẩm này <span class="count">${s.tech.length}</span></h2>${s.tech.length ? `<ul class="items">${s.tech.map((t) => `<li>${chips(entry, t.srcIds)} <span class="t"><span class="tech-name">${esc(t.name)}</span>${t.benefit ? `<br><span style="color:var(--good)">Ưu:</span> ${esc(t.benefit)}` : ""}${t.drawback ? `<br><span style="color:var(--bad)">Nhược:</span> ${esc(t.drawback)}` : ""}</span></li>`).join("")}</ul>` : `<p class="muted">${wait}</p>`}</div>
         ${entry.specs.length ? `<div class="card"><h2>Thông số</h2><dl class="kv">${entry.specs.map((x) => `<dt>${esc(x.name)}</dt><dd>${esc(x.value)}</dd>`).join("")}</dl></div>` : ""}`
      : `<div class="card"><p class="muted" style="margin:0">Hàng tiêu dùng: chỉ so sánh giá, ưu điểm, nhược điểm với sản phẩm tương tự — không phân tích công nghệ.</p></div>`}`;
}

export function renderCompare(entry) {
  if (entry.scenario === "explore") {
    const names = entry.alternatives.map((a) => esc([a.brand, a.model || a.name].filter(Boolean).join(" "))).filter(Boolean);
    return `<div class="card"><h2>Chưa đủ thông tin để so sánh</h2><p style="margin:0 0 8px">Ứng dụng chưa so sánh giá hay xếp hạng vì chưa biết chính xác sản phẩm bạn cần.${names.length ? " Một số hãng/sản phẩm cùng loại thường gặp:" : ""}</p>${names.length ? `<div class="chips">${names.map((n) => `<span class="badge">${n}</span>`).join("")}</div>` : ""}<p class="muted small" style="margin:10px 0 0">Bổ sung hãng, mã hoặc thông số để so sánh cụ thể. <button type="button" class="chip" data-need-more="1">Bổ sung thông tin</button></p></div>`;
  }
  const rec = recommend(entry);
  const tech = entry.category === "tech";
  if (rec.rows.length < 2) return `<div class="card"><p class="muted" style="margin:0">${entry.status === "running" ? "Đang tìm các hãng khác để so sánh…" : "Chưa có hãng khác để so sánh."}</p></div>`;
  const li = (entry, list, max = 3) => (list.length ? `<ul>${list.slice(0, max).map((x) => `<li>${esc(x.text)} ${chips(entry, x.srcIds, 2)}</li>`).join("")}</ul>` : `<span class="muted">—</span>`);
  const rows = rec.rows.map((r) => `
    <tr class="${r === rec.best ? "best" : ""}">
      <td data-label="Sản phẩm" class="nm"><b>${esc(r.brand !== "—" ? r.brand : "")} ${esc(r.model || r.name)}</b>
        ${r === rec.best ? `<span class="badge good">Tối ưu</span> ` : ""}${r.isMain ? `<span class="badge">Đang xem</span>` : ""}
        ${r.vsMain ? `<div class="muted small">${esc(r.vsMain)}</div>` : ""}</td>
      <td data-label="Giá">${r.price ? `<b>${money(r.price)}</b><div>${chips(entry, r.priceSrcIds, 2)}</div>` : `<span class="muted">Chưa có giá</span>`}</td>
      <td data-label="Ưu điểm">${li(entry, r.prosFull)}</td>
      <td data-label="Nhược điểm">${li(entry, r.consFull)}</td>
      ${tech ? `<td data-label="Công nghệ">${r.techFull?.length ? `<ul>${r.techFull.slice(0, 3).map((t) => `<li><b>${esc(t.name)}</b>${t.benefit ? ` — ${esc(clip(t.benefit, 70))}` : ""}${t.drawback ? ` <span class="muted">(nhược: ${esc(clip(t.drawback, 60))})</span>` : ""}</li>`).join("")}</ul>` : `<span class="muted">—</span>`}</td>` : ""}
      <td data-label="Điểm"><span class="score">${r.score}</span></td>
    </tr>`).join("");
  const w = rec.weights;
  return `<div class="card">
    <h2>So sánh ${rec.rows.length} sản phẩm ${tech ? "(giá · ưu/nhược · công nghệ)" : "(giá · ưu/nhược điểm)"}</h2>
    <div class="table-wrap"><table class="cmp"><thead><tr><th>Sản phẩm</th><th>Giá</th><th>Ưu điểm</th><th>Nhược điểm</th>${tech ? "<th>Công nghệ</th>" : ""}<th>Điểm</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${renderVerdict(entry) ? `<div class="why">${renderVerdict(entry)}</div>` : ""}
  </div>`;
}

export function renderImages(entry) {
  const groups = [];
  const main = entry.images.slice(0, entry.imageLimit ?? MAX_IMAGES);
  if (main.length) groups.push({ title: entry.product.name || "Sản phẩm", list: main });
  for (const a of entry.alternatives) if (a.images.length) groups.push({ title: `${a.brand} ${a.model || a.name}`, list: a.images.slice(0, entry.imageLimitAlt ?? MAX_IMAGES) });
  if (!groups.length) return `<div class="card"><p class="muted" style="margin:0">${entry.status === "running" ? "Đang lấy ảnh từ các trang nguồn…" : "Chưa lấy được ảnh nào từ các trang đã mở."}</p></div>`;
  return groups.map((g) => `<div class="card"><h2>${esc(g.title)} <span class="count">${g.list.length} ảnh</span></h2><div class="images-grid">${g.list.map((i) => `<figure><a href="${esc(httpUrl(i.url))}" target="_blank" rel="noopener noreferrer">${imgTag(i, false)}</a><figcaption>${i.sim != null ? `<span class="badge good" title="Độ giống ảnh bạn cung cấp (gần đúng)">giống ${Math.round(i.sim * 100)}%</span> ` : ""}${chip(entry, i.srcId)}</figcaption></figure>`).join("")}</div></div>`).join("");
}

export function renderLog(entry) {
  const sec = logBySection(entry);
  const s = summarize(entry);
  const groups = Object.entries(sec).filter(([k, v]) => v.length && (k !== "tech" || entry.category === "tech")).map(([k, v]) =>
    `<details open><summary>${SECTION_LABEL[k]} — ${v.length} trang đóng góp</summary><div class="sec-pages">${v.map((p) => `<div class="logrow"><span>+${p.n}</span><span>${chip(entry, p.srcId)} ${esc(clip(p.title, 70))}</span></div>`).join("")}</div></details>`).join("");
  const failed = entry.pages.filter((p) => !p.ok);
  const kw = [...(entry.plan.queries ?? []).map((q) => ({ q, by: "app" })), ...(entry.queries ?? []).map((q) => ({ q, by: "ai" }))];
  const runs = (entry.runs ?? []).map((r) => {
    const parts = Object.entries(r.added ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `+${v} ${RUN_LABEL[k]}`);
    return `<div class="logrow"><time>${esc(dateTime(r.ts))}</time><span><b>Lần ${r.n}</b>: ${esc(parts.join(", ") || "không có dữ liệu mới")}</span></div>`;
  }).join("");
  return `
    ${runs ? `<div class="card"><h2>Các lần tìm <span class="count">${entry.runs.length}</span></h2>${runs}</div>` : ""}
    <div class="card"><h2>Tổng hợp theo mục <span class="count">${s.sourcesOpened} trang đọc được · ${s.sourcesFailed} bỏ qua</span></h2>
      ${groups || `<p class="muted">${entry.status === "running" ? "Đang mở trang nguồn…" : "Chưa có trang nào đóng góp dữ liệu."}</p>`}</div>
    <div class="card"><h2>Từ khóa</h2><div class="chips">${kw.map((k) => `<span class="chip" style="cursor:default" title="${k.by === "ai" ? "Đã dùng khi tìm" : "Từ khóa của ứng dụng"}">${k.by === "ai" ? "🔎" : "✎"} ${esc(clip(k.q, 70))}</span>`).join("") || '<span class="muted">—</span>'}</div></div>
    ${failed.length ? `<div class="card"><h2>Trang bỏ qua <span class="count">${failed.length}</span></h2>${failed.map((p) => `<div class="logrow fail"><span>${esc(p.error || "lỗi")}</span><a href="${esc(httpUrl(p.url))}" target="_blank" rel="noopener noreferrer">${esc(clip(p.url, 60))}</a></div>`).join("")}</div>` : ""}
    <div class="card"><h2>Nhật ký theo thời gian</h2>${entry.log.map((l) => `<div class="logrow ${l.kind === "error" ? "err" : l.ok === false ? "fail" : ""}"><time>${time(l.ts)}</time><span>${esc(l.msg)}</span></div>`).join("")}</div>`;
}

export function renderSources(entry) {
  if (!entry.sources.length) return "";
  return `<h2>Nguồn <span class="count muted">${entry.sources.length}</span></h2><ol>${entry.sources.map((s) => `<li><span class="n">[${s.id}]</span><span><a href="${esc(httpUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.domain)}</a> <span class="muted">${esc(s.domain)}${s.via === "page" ? " · đã mở" : ""}${s.verified === false ? " · chưa kiểm chứng" : ""}</span></span></li>`).join("")}</ol>`;
}

export function renderHistoryItem(e) {
  const s = summarize(e);
  const status = e.status === "done" ? "" : e.status === "partial" ? " · dừng giữa chừng" : e.status === "error" ? " · lỗi" : "";
  return `<button class="item" data-key="${esc(e.key)}"><b>${esc(clip(e.product.name || e.plan.query, 60))}</b><span class="badge ${e.category === "tech" ? "" : "warn"}">${e.category === "tech" ? "Thiết bị" : "Tiêu dùng"}</span>
    <span class="sub">${s.price.median ? money(s.price.median) + " · " : ""}${e.alternatives.length} hãng so sánh · ${esc(dateTime(e.updatedAt))}${status}${e.ai?.mock ? " · mẫu" : ""}</span></button>`;
}

// Bản đồ công nghệ của cả NHÓM sản phẩm (không chỉ sản phẩm đang tìm): phân loại, sản phẩm đang tìm có gì, gợi ý tối ưu
export function renderLandscape(entry, need = {}) {
  if (entry.category !== "tech") return "";
  const land = techLandscape(entry, need);
  if (!land) return "";
  const pill = (i, best) => [
    best.some((b) => b.id === i.id) ? `<span class="badge good">tối ưu nhất</span>` : "",
    i.has ? `<span class="badge good">sản phẩm bạn tìm có</span>` : "",
    `<span class="badge">${i.role === "core" ? "chọn một trong nhóm" : "có thể bổ sung"}</span>`,
    i.products || i.notes ? `<span class="badge">thấy ở ${i.products} sản phẩm${i.notes ? `, ${i.notes} bài viết` : ""}</span>` : "",
  ].join(" ");
  const list = (a, cls) => `<ul class="items ${cls}">${a.map((x) => `<li><span class="t">${esc(x)}</span></li>`).join("")}</ul>`;
  const groups = land.groups.concat([...new Set(land.items.filter((i) => i.role === "addon").map((i) => i.group))]).map((g) => {
    const rows = land.items.filter((i) => i.group === g).sort((a, b) => b.score - a.score);
    return `<h3 style="margin:14px 0 6px">${esc(g)}</h3><div class="sup-grid">${rows.map((i) => `
      <div class="pick"><h3>${esc(i.name)} <span class="muted small">điểm ${i.score.toFixed(1)}/10</span></h3>
        <div class="chips" style="margin-bottom:6px">${pill(i, land.best)}</div>
        <p class="small" style="margin:0 0 6px">${esc(i.what)}</p>
        <h3 style="color:var(--good);font-size:.85rem">Ưu điểm</h3>${list(i.pros, "pros")}
        <h3 style="color:var(--bad);font-size:.85rem;margin-top:6px">Nhược điểm</h3>${list(i.cons, "cons")}
        <p class="muted small" style="margin:6px 0 0">Hợp với: ${esc(i.bestFor)}</p></div>`).join("")}</div>`;
  }).join("");
  return `<div class="card verdict"><h2>Công nghệ của cả nhóm “${esc(land.label)}” <span class="count">ưu tiên: ${esc(PRIORITY_LABEL[land.priority])}</span></h2>
    <ul class="items">${land.summary.map((l) => `<li><span class="t">${esc(l)}</span></li>`).join("")}</ul>
  </div>
    <div class="card"><h2>Phân loại và so sánh công nghệ <span class="count">${land.items.length}</span></h2>${groups}
  </div>`;
}

export function renderTech(entry, need = {}) {
  return renderLandscape(entry, need) + renderTechClusters(entry);
}

// Tab "Công nghệ": hãng nào dùng công nghệ nào, ưu/nhược điểm của từng công nghệ (chỉ hàng kỹ thuật)
function renderTechClusters(entry) {
  const tc = technologyComparison(entry);
  if (!tc.applicable) return `<div class="card"><p class="muted" style="margin:0">Hàng tiêu dùng: chỉ so sánh giá, ưu điểm, nhược điểm — không phân tích công nghệ.</p></div>`;
  if (!tc.clusters.length) return `<div class="card"><p class="muted" style="margin:0">${entry.status === "running" ? "Đang thu thập thông tin công nghệ…" : "Chưa có thông tin công nghệ của các hãng. Bấm “Tìm thêm dữ liệu mới”, dùng Google trong Chrome hoặc nhập khóa Gemini để có đủ."}</p></div>`;
  const brandChip = (b) => `<span class="badge${b.isMain ? " good" : ""}" title="${esc(b.names?.join("; ") || "")}">${esc(b.brand)}${b.model ? " " + esc(b.model) : ""}</span>`;
  const claims = (list, cls, empty) => (list.length
    ? `<ul class="items ${cls}">${list.map((x) => `<li><span class="t">${esc(x.text)} <span class="muted small">(${esc(x.brand)})</span></span> ${chips(entry, x.srcIds, 2)}</li>`).join("")}</ul>`
    : `<p class="muted small" style="margin:0">${esc(empty)}</p>`);
  const summary = `<div class="card verdict"><h2>Tóm tắt so sánh công nghệ</h2><ul class="items">${tc.summary.map((l) => `<li><span class="t">${esc(l)}</span></li>`).join("")}</ul>
    <div class="chips" style="margin-top:8px">${tc.brands.map((b) => `<span class="badge${b.isMain ? " good" : ""}">${esc(b.brand)}: ${b.count} công nghệ</span>`).join("")}</div></div>`;
  const cards = tc.clusters.map((c) => `
    <div class="card">
      <h2>${esc(c.name)} <span class="badge ${c.shared ? "good" : ""}">${c.shared ? c.brands.length + " hãng dùng chung" : "riêng 1 hãng"}</span></h2>
      <div class="chips" style="margin-bottom:8px">${c.brands.map(brandChip).join("")}</div>
      <h3 style="color:var(--good)">Ưu điểm của công nghệ</h3>${claims(c.benefits, "pros", "Chưa có thông tin ưu điểm.")}
      <h3 style="color:var(--bad);margin-top:10px">Nhược điểm của công nghệ</h3>${claims(c.drawbacks, "cons", "Chưa có thông tin nhược điểm.")}
    </div>`).join("");
  return summary + cards;
}

const telLink = (p) => `<a href="tel:${esc(p.replace(/\s/g, ""))}">${esc(p)}</a>`;
export function contactHtml(c) {
  if (!c || !contactText(c)) return `<span class="muted">Chưa có thông tin liên hệ</span>`;
  return [
    c.phones?.length ? `<div><span class="muted">SĐT:</span> ${c.phones.map(telLink).join(", ")}</div>` : "",
    c.emails?.length ? `<div><span class="muted">Email:</span> ${c.emails.map((e) => `<a href="mailto:${esc(e)}">${esc(e)}</a>`).join(", ")}</div>` : "",
    c.zalo?.length ? `<div><span class="muted">Zalo:</span> ${c.zalo.map((z) => `<a href="https://zalo.me/${esc(z.replace(/\s/g, ""))}" target="_blank" rel="noopener noreferrer">${esc(z)}</a>`).join(", ")}</div>` : "",
    c.address ? `<div><span class="muted">Địa chỉ:</span> ${esc(c.address)}</div>` : "",
    c.contactUrl ? `<div><a href="${esc(httpUrl(c.contactUrl))}" target="_blank" rel="noopener noreferrer">Trang liên hệ</a></div>` : "",
  ].join("");
}

// Tab "Nhà cung cấp": mọi NCC đã gặp khi đọc trang (kể cả trang không khớp model), kèm liên hệ đã lưu
export function renderSuppliers(entry) {
  if (entry.scenario === "explore") return `<div class="card"><h2>Chưa đủ thông tin để nêu nhà cung cấp</h2><p class="muted" style="margin:0">Các trang đã đọc thuộc nhiều loại sản phẩm khác nhau nên ứng dụng chưa liệt kê nhà cung cấp. Bổ sung hãng, mã hoặc thông số để tìm nhà cung cấp đúng sản phẩm. <button type="button" class="chip" data-need-more="1">Bổ sung thông tin</button></p></div>`;
  const list = suppliersOf(entry);
  if (!list.length) return `<div class="card"><p class="muted" style="margin:0">${entry.status === "running" ? "Đang đọc các trang bán hàng…" : "Chưa đọc được trang bán hàng nào."}</p></div>`;
  const withContact = list.filter((s) => s.contactText).length;
  const cards = list.map((s) => `
    <div class="pick">
      <h3>${esc(s.name)} ${s.matched ? `<span class="badge good">bán đúng sản phẩm</span>` : `<span class="badge warn">chưa thấy đúng sản phẩm</span>`}</h3>
      <div class="muted small">${esc(s.domain)}${s.brands.length ? " · hãng: " + esc(s.brands.join(", ")) : ""}</div>
      ${s.minPrice != null ? `<div class="price">${money(s.minPrice)} <span class="muted small">giá thấp nhất · ${s.offers} sản phẩm</span></div>` : `<div class="muted small">Chưa có giá, cần hỏi báo giá</div>`}
      <div class="contact">${contactHtml(s.contact)}</div>
      <details><summary class="small">${s.pages.length} trang đã đọc</summary>${s.pages.map((p) => `<div class="small"><a href="${esc(httpUrl(p.url))}" target="_blank" rel="noopener noreferrer">${esc(clip(p.title || p.url, 70))}</a>${p.price ? " · " + money(p.price) : ""}${p.relevant ? "" : ' <span class="muted">(không khớp model)</span>'}</div>`).join("")}</details>
    </div>`).join("");
  return `<div class="card"><h2>Nhà cung cấp đã gặp <span class="count">${list.length} NCC · ${withContact} có liên hệ</span></h2>
    <div class="sup-grid">${cards}</div></div>`;
}
