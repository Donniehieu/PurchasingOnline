// Tư vấn chọn sản phẩm và nhà cung cấp (NCC) theo nhu cầu, mục đích, ngân sách.
// Chỉ dùng dữ liệu đã đọc và lưu trong entry (bảng NCC), không tìm thêm. Điểm tính theo quy tắc cố định, giải thích từng lý do.
import { norm, modelKey, money } from "./text.js";
import { tableRows } from "./offers.js";

const PRIORITY = { balanced: "Cân bằng", cheap: "Giá rẻ nhất", quality: "Chất lượng, công nghệ", durable: "Bền, bảo hành tốt" };
export const PRIORITY_OPTIONS = PRIORITY;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const words = (text) => norm(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
const STOP = new Set(["cho", "dung", "cac", "nhung", "mot", "va", "voi", "nguoi", "gia", "dinh", "nha"]);

// Khoảng ngân sách -> đánh giá giá của một mức giá: 1 = nằm trong, giảm dần khi lệch
function budgetFit(price, need) {
  const lo = need?.budgetMin ?? null, hi = need?.budgetMax ?? null;
  if (price == null || (lo == null && hi == null)) return null;
  if ((lo == null || price >= lo) && (hi == null || price <= hi)) return 1;
  const ref = price < (lo ?? 0) ? lo : hi;
  return clamp(1 - Math.abs(price - ref) / ref * 2, 0, 0.9) * 0.5; // lệch càng xa càng thấp, tối đa 0.45
}

/** Gom các dòng của bảng NCC thành từng sản phẩm (theo mã model, không có model thì theo tên). */
export function productGroups(entry) {
  const rows = tableRows(entry).filter((r) => r.read || r.price != null);
  const groups = new Map();
  for (const r of rows) {
    const key = modelKey(r.model) || modelKey(`${r.brand} ${r.name || r.nameText}`).slice(0, 28);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, name: r.name || r.nameText, model: r.model || "", brand: r.brand || "", rows: [] });
    g.rows.push(r);
    if (!g.model && r.model) g.model = r.model;
    if (!g.brand && r.brand) g.brand = r.brand;
  }
  return [...groups.values()].map((g) => {
    const prices = g.rows.map((r) => r.price).filter((p) => p != null).sort((a, b) => a - b);
    const specMap = new Map();
    for (const r of g.rows) for (const s of r.specs ?? []) if (!specMap.has(norm(s.k))) specMap.set(norm(s.k), { k: s.k, v: s.v });
    return { ...g, sellers: new Set(g.rows.map((r) => r.seller)).size, readRows: g.rows.filter((r) => r.read).length, priceMin: prices[0] ?? null, priceMax: prices.at(-1) ?? null, specs: [...specMap.values()], isMain: !!entry.product.model && modelKey(entry.product.model) === g.key };
  });
}

/** Số hãng/sản phẩm khác nhau ở thông số nào: dùng để hỏi người dùng thu hẹp lựa chọn. */
function distinguishing(groups) {
  const byKey = new Map();
  for (const g of groups) for (const s of g.specs) {
    const k = norm(s.k);
    if (!byKey.has(k)) byKey.set(k, { k: s.k, values: new Map() });
    byKey.get(k).values.set(norm(s.v), s.v);
  }
  return [...byKey.values()].filter((x) => x.values.size >= 2 && x.values.size <= 6 && x.k.length <= 32).sort((a, b) => b.values.size - a.values.size).slice(0, 4).map((x) => ({ key: x.k, values: [...x.values.values()].slice(0, 5) }));
}

/** Bước 1: chọn sản phẩm phù hợp. mode "supplier" khi đã rõ mã model (sang thẳng chọn NCC). */
export function adviseProducts(entry, need = {}) {
  const groups = productGroups(entry);
  const modelGiven = !!(entry.plan?.model || entry.product?.model);
  const purposeWords = words(need.purpose || "");
  const pri = need.priority || "balanced";
  const cands = groups.map((g) => {
    const reasons = [], warns = [];
    let score = 0;
    const mid = g.priceMin != null ? (g.priceMin + (g.priceMax ?? g.priceMin)) / 2 : null;
    const bf = budgetFit(mid, need);
    if (bf != null) { score += bf * 40; reasons.push(bf === 1 ? `giá ${money(g.priceMin)}${g.priceMax !== g.priceMin ? " – " + money(g.priceMax) : ""} nằm trong ngân sách` : `giá ${money(mid)} lệch khỏi ngân sách`); if (bf < 1) warns.push("ngoài ngân sách"); }
    else if (mid == null) warns.push("chưa có giá");
    if (purposeWords.length) {
      const hay = norm([g.name, g.brand, g.model, ...g.specs.map((s) => `${s.k} ${s.v}`)].join(" "));
      const hit = purposeWords.filter((w) => hay.includes(w));
      score += (hit.length / purposeWords.length) * 20;
      if (hit.length) reasons.push(`khớp mục đích (${hit.join(", ")})`);
    }
    score += Math.min(g.sellers, 4) * 4;                       // nhiều NCC bán = dễ mua, dễ so giá
    if (g.sellers > 1) reasons.push(`${g.sellers} NCC cùng bán`);
    score += g.readRows ? 10 : 0;                              // dữ liệu đọc từ đúng trang
    if (!g.readRows) warns.push("chưa đọc được từ trang bán");
    if (pri === "quality") score += Math.min(g.specs.length, 10) * 1.5;
    if (pri === "cheap" && mid != null) { const all = groups.map((x) => x.priceMin).filter((p) => p != null); const lo = Math.min(...all), hi = Math.max(...all); score += hi > lo ? (1 - (mid - lo) / (hi - lo)) * 15 : 15; }
    if (pri === "durable" && g.rows.some((r) => /bao hanh|warranty/.test(norm(r.specText)))) { score += 8; reasons.push("có ghi bảo hành"); }
    return { key: g.key, name: g.name, model: g.model, brand: g.brand, priceMin: g.priceMin, priceMax: g.priceMax, sellers: g.sellers, specs: g.specs.slice(0, 6), isMain: g.isMain, score: Math.round(score), reasons, warns };
  }).sort((a, b) => b.score - a.score || (a.priceMin ?? Infinity) - (b.priceMin ?? Infinity));

  const questions = [];
  if (!modelGiven) questions.push("Bạn chưa nhập mã model: hãy chọn một sản phẩm bên dưới (hoặc gõ chính xác mã model rồi tìm lại) để so sánh nhà cung cấp.");
  if (need.budgetMin == null && need.budgetMax == null) questions.push("Bạn muốn chi tối đa bao nhiêu? Nhập ngân sách để lọc sản phẩm vừa túi tiền.");
  if (!need.purpose) questions.push("Bạn dùng để làm gì (gia đình, văn phòng, chơi game, kinh doanh…)? Nhập mục đích để ưu tiên đúng loại.");
  for (const d of distinguishing(groups)) questions.push(`Các sản phẩm khác nhau ở “${d.key}” (${d.values.join(" / ")}): bạn cần mức nào?`);

  const mode = modelGiven && groups.some((g) => g.isMain && g.readRows) ? "supplier" : "product";
  return { mode, candidates: cands, questions: questions.slice(0, 6), enough: cands.length >= 1 };
}

/** Bước 2: xếp hạng NCC của một sản phẩm (đã chọn / đã rõ model). */
export function adviseSuppliers(entry, need = {}, productKey = "") {
  const groups = productGroups(entry);
  const key = productKey || groups.find((g) => g.isMain)?.key || groups.sort((a, b) => b.sellers - a.sellers)[0]?.key || "";
  const g = groups.find((x) => x.key === key);
  if (!g) return { product: null, list: [], best: null, cheapest: null, note: "Chưa có nhà cung cấp nào bán sản phẩm này trong dữ liệu đã đọc." };
  const prices = g.rows.map((r) => r.price).filter((p) => p != null);
  const lo = prices.length ? Math.min(...prices) : null, hi = prices.length ? Math.max(...prices) : null;
  const pri = need.priority || "balanced";
  const rows = new Map(); // mỗi NCC một dòng (dòng đã đọc, giá thấp nhất)
  for (const r of g.rows) {
    const cur = rows.get(r.seller);
    if (!cur || (r.read && !cur.read) || (r.read === cur.read && r.price != null && (cur.price == null || r.price < cur.price))) rows.set(r.seller, r);
  }
  const list = [...rows.values()].map((r) => {
    const reasons = [], warns = [];
    let score = 0;
    if (r.price != null && lo != null) {
      score += (hi > lo ? 1 - (r.price - lo) / (hi - lo) : 1) * (pri === "cheap" ? 45 : 30);
      if (r.price === lo) reasons.push("giá thấp nhất");
    } else warns.push("chưa có giá, cần hỏi báo giá");
    const bf = budgetFit(r.price, need);
    if (bf != null) { score += bf * 20; if (bf === 1) reasons.push("trong ngân sách"); else warns.push("ngoài ngân sách"); }
    if (r.read) { score += 20; reasons.push("giá và thông số đọc từ đúng trang"); } else warns.push("chưa đọc từ trang bán");
    if (r.vat?.state === "included" || r.vat?.state === "rate") { score += 6; reasons.push(r.vatLabel.toLowerCase()); } else if (r.vat?.state === "excluded") warns.push("giá chưa gồm VAT");
    const c = r.contact;
    if (c?.phones?.length) { score += 12; reasons.push("có SĐT"); } else if (c?.emails?.length || c?.zalo?.length) { score += 7; reasons.push("có email/Zalo"); } else warns.push("chưa có thông tin liên hệ");
    if (c?.address) score += 3;
    if (r.specs?.length >= 6) score += pri === "quality" ? 8 : 4;
    if (pri === "durable" && /bao hanh|warranty/.test(norm(r.specText))) { score += 8; reasons.push("có ghi bảo hành"); }
    return { seller: r.seller, domain: r.domain, price: r.price, vatLabel: r.vatLabel, contact: c, contactText: r.contactText, url: r.url, read: r.read, score: Math.round(score), reasons, warns };
  }).sort((a, b) => b.score - a.score || (a.price ?? Infinity) - (b.price ?? Infinity));
  const priced = list.filter((x) => x.price != null);
  return { product: { key: g.key, name: g.name, model: g.model, brand: g.brand, priceMin: lo, priceMax: hi }, list, best: list[0] ?? null, cheapest: priced.length ? priced.reduce((a, b) => (b.price < a.price ? b : a)) : null, note: "" };
}
