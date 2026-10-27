// Tab "Tư vấn chọn": hướng dẫn chọn sản phẩm phù hợp (khi chưa rõ mã model / chỉ có khoảng giá),
// rồi chọn nhà cung cấp phù hợp nhu cầu, mục đích, ngân sách. Chỉ dùng dữ liệu đã đọc và lưu.
import { esc, money, clip } from "./lib/text.js";
import { adviseProducts, adviseSuppliers, adviseCards, PRIORITY_OPTIONS } from "./lib/advisor.js";
import { needSummary } from "./lib/need.js";
import { analyzeInput, preCards } from "./lib/intent.js";
import { contactHtml } from "./render.js";

const httpUrl = (u) => (/^https?:\/\//i.test(u) ? u : "#");
const priceRange = (a, b) => (a == null ? "chưa có giá" : b != null && b !== a ? `${money(a)} – ${money(b)}` : money(a));

function productCard(c, i, chosen, explore = false) {
  return `<div class="pick${i === 0 && c.score > 0 ? " best" : ""}${chosen === c.key ? " chosen" : ""}">
    <h3>${i === 0 && c.score > 0 ? `<span class="badge good">Phù hợp nhất</span> ` : ""}${esc(clip(c.name || c.model, 90))}</h3>
    <div class="muted small">${[c.brand, c.model && c.model !== c.name ? "Model " + c.model : ""].filter(Boolean).map(esc).join(" · ")}</div>
    <div class="price">${priceRange(c.priceMin, c.priceMax)}</div>
    <div class="muted small">${c.sellers} nhà cung cấp bán</div>
    ${c.reasons.length ? `<p class="why-line">✓ ${esc(c.reasons.join("; "))}</p>` : ""}
    ${c.warns.length ? `<p class="warn-line">! ${esc(c.warns.join("; "))}</p>` : ""}
    ${c.specs.length ? `<div class="specs-mini">${c.specs.slice(0, 4).map((s) => `${esc(s.k)}: ${esc(clip(s.v, 30))}`).join(" · ")}</div>` : ""}
    <button type="button" class="btn ${chosen === c.key ? "primary" : "ghost"} sm" data-pick="${esc(c.key)}">${chosen === c.key ? "Đang chọn" : explore ? "Chọn và so sánh NCC" : "Chọn sản phẩm này"}</button>
  </div>`;
}

function supplierCard(s, i) {
  return `<div class="pick${i === 0 ? " best" : ""}">
    <h3><span class="score-pill" title="Điểm phù hợp theo quy tắc: giá, ngân sách, dữ liệu đọc từ đúng trang, VAT, liên hệ">${s.score} điểm</span>${i === 0 ? `<span class="badge good">Nên chọn</span> ` : ""}${esc(s.seller)}</h3>
    <div class="price">${s.price != null ? money(s.price) : "Liên hệ báo giá"} <span class="muted small">${esc(s.vatLabel)}</span></div>
    ${s.reasons.length ? `<p class="why-line">✓ ${esc(s.reasons.join("; "))}</p>` : ""}
    ${s.warns.length ? `<p class="warn-line">! ${esc(s.warns.join("; "))}</p>` : ""}
    <div class="contact">${contactHtml(s.contact)}</div>
    <a class="btn ghost sm" href="${esc(httpUrl(s.url))}" target="_blank" rel="noopener noreferrer">Mở trang sản phẩm của NCC</a>
  </div>`;
}

// Thiếu thông tin: KHÔNG tư vấn chọn sản phẩm/NCC. Chỉ nêu những gì cần bổ sung để tìm cụ thể.
function renderNeedMore(entry) {
  const a = analyzeInput(entry.plan.query);
  const cards = preCards(a);
  const todo = cards.filter((c) => c.kind !== "need").map((c) => c.title.replace(/\?$/, ""));
  if (a.scenario === "need" || !a.type) todo.unshift("Loại sản phẩm bạn cần");
  if (!a.signals.brand && !a.signals.model) todo.push("Hãng hoặc mã model (nếu đã biết)");
  return `<div class="card verdict"><h2>Cần bổ sung thông tin để tư vấn</h2>
    <p style="margin:0">Ứng dụng <b>chưa thể tư vấn chọn sản phẩm, nhà cung cấp hay so sánh báo giá</b> vì thông tin bạn nhập chưa đủ để biết chính xác bạn cần gì. Các tab hiện đang cho cái nhìn chung về loại sản phẩm này.</p>
    ${todo.length ? `<p style="margin:10px 0 4px"><b>Bạn có thể bổ sung:</b></p><ul class="ask-list">${[...new Set(todo)].map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
    <p style="margin:12px 0 0"><button type="button" class="btn primary" data-need-more="1" style="margin-left:0">Bổ sung thông tin (trả lời vài câu)</button></p></div>`;
}

// Thẻ câu hỏi: 3–5 câu theo dữ liệu đã đọc, chọn để lọc đúng loại/đối tượng
function renderCards(entry, need, answers) {
  const cards = adviseCards(entry, need, answers);
  if (!cards.length) return "";
  const chosen = Object.values(answers).filter(Boolean).length;
  const body = cards.map((c, i) => `<div class="qcard">
      <div class="q-title"><span class="q-num">${i + 1}</span>${esc(c.title)}</div>
      <div class="chips">${c.options.map((o) => `<button type="button" class="chip${c.selected === o.value ? " on" : ""}" data-card="${esc(c.id)}" data-v="${esc(o.value)}" aria-pressed="${c.selected === o.value}">${esc(o.label)}${o.count ? ` <span class="muted">(${o.count})</span>` : ""}</button>`).join("")}</div>
    </div>`).join("");
  return `<div class="card"><h2>Trả lời vài câu để chọn đúng <span class="count">${cards.length} câu hỏi${chosen ? " · đã lọc " + chosen + " đặc điểm" : ""}</span></h2>
    <div class="qcards">${body}</div>
    </div>`;
}

/** Bước 2: chọn nhà cung cấp cho sản phẩm đã chọn (dùng ở tab Tư vấn và trong cửa sổ giữa màn hình). */
export function supplierStep(entry, need, picked, answers, prod) {
  let step2 = "";
  if (picked) {
    const adv = adviseSuppliers(entry, need, picked, answers);
    if (!adv.product) {
      step2 = `<div class="card"><h2>Bước 2: Chọn nhà cung cấp</h2><p class="muted">${esc(adv.note)}</p>${prod.mode === "product" ? `<button type="button" class="btn ghost sm" data-pick="">← Chọn sản phẩm khác</button>` : ""}</div>`;
    } else {
      const nm = [adv.product.brand, adv.product.model || adv.product.name].filter(Boolean).join(" ");
      const top = adv.best;
      step2 = `<div class="card"><h2>Bước 2: Chọn nhà cung cấp cho <b>${esc(clip(nm, 70))}</b> <span class="count">${adv.list.length} NCC · ${priceRange(adv.product.priceMin, adv.product.priceMax)}</span></h2>
        ${top ? `<div class="why"><b>Đề xuất: ${esc(top.seller)}</b>${top.price != null ? ` — ${money(top.price)}` : ""}. ${esc(top.reasons.join("; ") || "Dữ liệu còn ít, nên hỏi báo giá")}.${adv.cheapest && adv.cheapest !== top ? ` Rẻ nhất: ${esc(adv.cheapest.seller)} (${money(adv.cheapest.price)}).` : ""}</div>` : ""}
        <div class="pick-grid" style="margin-top:12px">${adv.list.slice(0, 12).map(supplierCard).join("")}</div>
        ${prod.mode === "product" || prod.candidates.length > 1 ? `<p><button type="button" class="btn ghost sm" data-pick="">← Chọn sản phẩm khác</button></p>` : ""}
        </div>`;
    }
  }
  return step2;
}

/** need: { budgetMin, budgetMax, purpose, priority }; choice: khóa sản phẩm người dùng đã chọn ("" = chưa chọn). */
export function renderAdvice(entry, need = {}, choice = "", answers = {}) {
  if (entry.scenario === "explore") return renderNeedMore(entry);
  const prod = adviseProducts(entry, need, answers);
  const picked = choice || (prod.mode === "supplier" ? prod.candidates.find((c) => c.isMain)?.key ?? "" : "");
  const summary = needSummary(need);
  const pri = need.priority && need.priority !== "balanced" ? ` · ưu tiên: ${PRIORITY_OPTIONS[need.priority].toLowerCase()}` : "";
  const waiting = entry.status === "running" ? `<p class="muted small" style="margin:0">Đang thu thập thêm dữ liệu, gợi ý sẽ cập nhật.</p>` : "";

  const head = `<div class="card adv-head">
    <ol class="adv-steps"><li class="${picked ? "" : "on"}">1. Chọn sản phẩm</li><li class="${picked ? "on" : ""}">2. Chọn nhà cung cấp</li></ol>
    <p style="margin:0">${summary ? `Nhu cầu của bạn: <b>${esc(summary)}</b>${esc(pri)}.` : "Chưa có thông tin về ngân sách và mục đích."}</p>
    ${waiting}</div>`;

  let step1 = "";
  if (!picked) {
    const intro = prod.questions.length ? `<ul class="ask-list">${prod.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : "";
    step1 = `<div class="card"><h2>Bước 1: Chọn sản phẩm phù hợp <span class="count">${prod.candidates.length} sản phẩm</span></h2>
      ${intro}
      ${prod.candidates.length ? `<div class="pick-grid" style="margin-top:12px">${prod.candidates.slice(0, 9).map((c, i) => productCard(c, i, picked, entry.scenario === "explore")).join("")}</div>` : `<p class="muted">Chưa có đủ sản phẩm từ các trang đã đọc. Bấm “Tìm thêm dữ liệu mới” hoặc gõ rõ hơn mã model.</p>`}
      </div>`;
  }

  const step2 = picked ? supplierStep(entry, need, picked, answers, prod) : "";
  return head + renderCards(entry, need, answers) + step1 + step2;
}
