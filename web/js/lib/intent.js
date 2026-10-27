// Phân tích những gì người dùng nhập để chọn KỊCH BẢN chạy phù hợp, trước khi tìm kiếm (chạy ngay trên máy, không gọi mạng):
//  - đủ thông tin (mã model, link, hãng + loại + thông số): tìm thẳng và dựng bảng NCC theo đúng tên/mã
//  - thiếu thông tin: hiện thẻ câu hỏi trước (trả lời hoặc bỏ qua); bỏ qua hết thì chỉ "khám phá" (giá, sản phẩm tương đương,
//    ưu nhược điểm), chưa dựng bảng so sánh NCC cho tới khi chọn được sản phẩm cụ thể
import { norm } from "./text.js";
import { makePlan } from "./plan.js";
import { FACETS, facetValues } from "./cards.js";
import { parseNeed } from "./need.js";
import { TYPES, TYPE_PICKER } from "./kb.js";

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const hasNonAscii = (s) => [...s].some((c) => c.charCodeAt(0) > 127);
const STOP = new Set(["cho", "gia", "ban", "mua", "tim", "can", "muon", "loai", "cua", "voi", "nhu", "duoi", "tren", "khoang", "tam", "trieu", "nghin", "re", "tot", "nhat", "hang", "chinh", "sieu", "moi", "cac", "nhung", "mot", "va", "la", "co", "khong", "nen", "nao", "gi", "the", "and", "for", "with"]);
const words = (t) => norm(t).split(/[^a-z0-9]+/).filter(Boolean);
const padded = (t) => " " + words(t).join(" ") + " ";

/** Loại hàng theo từ khóa có sẵn (khớp cụm dài nhất). null nếu không nhận ra. */
export function detectType(text) {
  const lower = String(text ?? "").toLowerCase();
  const n = padded(text);
  let best = null;
  for (const t of TYPES) {
    for (const key of t.keys) {
      const hit = hasNonAscii(key) ? (" " + lower + " ").replace(/[,.;:!?()]/g, " ").includes(" " + key + " ") || (" " + lower).includes(" " + key) : n.includes(" " + key + " ");
      if (hit && (!best || key.length > best.len)) best = { type: t, key, len: key.length };
    }
  }
  return best;
}

export const SCENARIOS = {
  empty: "Chưa nhập gì",
  url: "Có link sản phẩm",
  model: "Có mã model",
  spec: "Có hãng/thông số cụ thể",
  branded: "Có hãng và loại hàng, thiếu chi tiết",
  generic: "Mới biết loại hàng",
  need: "Mới có ngân sách hoặc nhu cầu",
  vague: "Quá ngắn, chưa rõ",
  pair: "Có hai sản phẩm cần so sánh",
};

/**
 * Trả về { scenario, label, sufficiency: "enough"|"partial"|"insufficient", mode: "full"|"explore", needCards, type, signals, score, reasons }.
 * forcedType: loại hàng do người dùng chọn ở thẻ "Bạn đang tìm loại nào?".
 */
export function analyzeInput(text, { forcedType = "" } = {}) {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  const seeds = [...new Set(raw.match(URL_RE) ?? [])];
  const typed = raw.replace(URL_RE, " ").replace(/\s+/g, " ").trim();
  const reasons = [];
  if (!raw) return { scenario: "empty", label: SCENARIOS.empty, sufficiency: "insufficient", mode: "explore", needCards: false, type: null, signals: {}, score: 0, reasons };
  if (seeds.length) return { scenario: "url", label: SCENARIOS.url, sufficiency: "enough", mode: "full", needCards: false, type: null, signals: { seeds: seeds.length, typed }, score: 9, reasons: ["đọc thẳng trang đã dán, tên/mã lấy từ trang"] };

  // "so sánh A với B", "A vs B": ứng dụng tìm từng sản phẩm một, hỏi tìm cái nào trước
  const parts = typed.replace(/^\s*so sánh\s+/i, "").split(/\s+(?:vs\.?|so với|với)\s+/i).map((p) => p.trim()).filter((p) => p.length >= 3);
  if (parts.length === 2 && (/^\s*so sánh\s/i.test(typed) || /\svs\.?\s/i.test(typed))) {
    return { scenario: "pair", label: SCENARIOS.pair, sufficiency: "partial", mode: "full", needCards: true, type: null, signals: { parts }, score: 2, reasons: ["có hai sản phẩm"], typed };
  }
  const plan = makePlan({ text: typed });
  const hit = forcedType ? { type: TYPES.find((t) => t.id === forcedType), key: "" } : detectType(typed);
  const type = hit?.type ?? null;
  const need = parseNeed(typed);
  const facets = FACETS.filter((f) => facetValues({ nameText: typed, specText: "" }, f).size).map((f) => f.id);
  const typeWords = new Set(words(hit?.key ?? ""));
  const brandWords = new Set(words(plan.brand));
  const modelWords = new Set(words(plan.model));
  const distinct = words(typed).filter((w) => w.length >= 3 && !STOP.has(w) && !typeWords.has(w) && !brandWords.has(w) && !modelWords.has(w) && !/^\d+$/.test(w) && !/^\d+[a-z]{1,3}$/.test(w));
  const budgetOnly = need.budgetMin != null || need.budgetMax != null || !!need.purpose;

  let score = 0;
  if (plan.model) { score += 3; reasons.push(`mã model ${plan.model}`); }
  if (plan.brand) { score += 1; reasons.push(`hãng ${plan.brand}`); }
  if (type) { score += 1; reasons.push(`loại hàng: ${type.label}`); }
  if (facets.length) { score += Math.min(facets.length, 3); reasons.push(`${facets.length} thông số`); }
  if (distinct.length >= 2) { score += 1; reasons.push("tên khá cụ thể"); }
  const signals = { brand: plan.brand, model: plan.model, type: type?.id ?? "", facets, budget: need.budgetMin != null || need.budgetMax != null, purpose: need.purpose, distinct: distinct.length, words: words(typed).length };

  let scenario;
  if (plan.model && score >= 3) scenario = "model";
  else if (score >= 4) scenario = "spec";
  else if (plan.brand && type) scenario = "branded";
  else if (type) scenario = "generic";
  else if (budgetOnly && words(typed).length <= 8) scenario = "need";
  else scenario = words(typed).length <= 1 ? "vague" : "generic";

  const sufficiency = score >= 4 ? "enough" : score >= 2 ? "partial" : "insufficient";
  return { scenario, label: SCENARIOS[scenario], sufficiency, mode: sufficiency === "enough" ? "full" : "explore", needCards: sufficiency !== "enough", type, signals, score, reasons, typed };
}

const NEED_CARDS = {
  audience: { id: "audience", kind: "need", title: "Bạn mua cho đối tượng nào?", options: ["Gia đình, cá nhân", "Cửa hàng, kinh doanh", "Nhà xưởng, công trình", "Văn phòng, doanh nghiệp"].map((l) => ({ label: l, add: "", value: l })) },
  budget: { id: "budget", kind: "need", title: "Ngân sách khoảng bao nhiêu?", options: [["Dưới 500k", "0:500000"], ["500k - 2 triệu", "500000:2000000"], ["2 - 5 triệu", "2000000:5000000"], ["5 - 15 triệu", "5000000:15000000"], ["Trên 15 triệu", "15000000:0"]].map(([label, value]) => ({ label, add: "", value })) },
};

// Học từ cache các lần tìm trước (trên máy): hãng và giá trị thông số đã gặp của cùng loại hàng
export function learnFromCache(entries, typeId) {
  const brands = new Map();
  const facets = {};
  for (const e of entries ?? []) {
    const name = `${e?.plan?.query ?? ""} ${e?.product?.name ?? ""}`;
    if (detectType(name)?.type.id !== typeId) continue;
    const bump = (b) => { const k = String(b ?? "").trim(); if (k && k.length <= 24) brands.set(k, (brands.get(k) ?? 0) + 1); };
    bump(e.product?.brand);
    for (const o of e.offers ?? []) bump(o.brand);
    for (const o of e.offers ?? []) {
      const row = { nameText: o.name ?? "", specText: (o.specs ?? []).map((s) => `${s.k}: ${s.v}`).join("; ") };
      for (const f of FACETS) for (const [, label] of facetValues(row, f)) (facets[f.id] ??= new Map()).set(label, (facets[f.id].get(label) ?? 0) + 1);
    }
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  return { brands: top(brands, 6), facets: Object.fromEntries(Object.entries(facets).map(([k, m]) => [k, top(m, 6)])) };
}

/** Thẻ câu hỏi trước khi tìm: 3–5 thẻ, bỏ câu mà chuỗi người dùng gõ đã trả lời. hints: kết quả learnFromCache. */
export function preCards(analysis, { hints = null, max = 5 } = {}) {
  if (!analysis?.needCards) return [];
  const typed = analysis.typed ?? "";
  if (analysis.scenario === "pair") {
    const [a, b] = analysis.signals.parts;
    return [{ id: "pick", kind: "query", title: "Ứng dụng tìm từng sản phẩm một. Tìm sản phẩm nào trước?", options: [{ label: a, add: "", value: a, replace: a }, { label: b, add: "", value: b, replace: b }] }];
  }
  const cards = [];
  const need = parseNeed(typed);
  const hasBudget = need.budgetMin != null || need.budgetMax != null;
  if (!analysis.type) {
    cards.push({ ...TYPE_PICKER, kind: "type" });
    cards.push(NEED_CARDS.audience);
    if (!hasBudget) cards.push(NEED_CARDS.budget);
    return cards.slice(0, max);
  }
  const n = padded(typed);
  const detectedFacets = new Set(analysis.signals.facets ?? []);
  const qs = analysis.type.questions.filter((q) => {
    if (q.facet && detectedFacets.has(q.facet)) return false;
    if (q.id === "brand" && analysis.signals.brand) return false;
    if ((q.skipIf ?? []).some((k) => n.includes(k.startsWith(" ") ? k : " " + k) || n.includes(k))) return false;
    return true;
  });
  const room = max - (hasBudget ? 0 : 1) - (qs.some((q) => ["use", "age"].includes(q.id)) ? 0 : 0);
  for (const q of qs.slice(0, Math.max(room, 1))) {
    let options = q.options.map((o) => ({ label: o.label, add: o.add, value: o.label }));
    const learned = q.id === "brand" ? hints?.brands : q.facet ? hints?.facets?.[q.facet] : null;
    if (learned?.length) {
      const have = new Set(options.map((o) => norm(o.label)));
      const fromCache = learned.filter((l) => !have.has(norm(l))).map((l) => ({ label: l, add: l, value: l, cached: true }));
      options = [...fromCache, ...options].slice(0, 8);
    }
    cards.push({ id: q.id, kind: "query", title: q.title, options });
  }
  if (!hasBudget) cards.push(NEED_CARDS.budget);
  return cards.slice(0, max);
}

/** Chuỗi tìm = chuỗi người dùng gõ + chữ của các lựa chọn (người dùng thấy và sửa được). answers: { idThẻ: { add } hoặc { custom } } */
export function composeQuery(typed, cards, answers = {}) {
  let q = String(typed ?? "").replace(/\s+/g, " ").trim();
  for (const c of cards ?? []) {
    if (c.kind === "need") continue;
    const a = answers[c.id];
    if (a?.replace) { q = a.replace; continue; } // chọn một trong hai sản phẩm: thay chuỗi bằng sản phẩm đó
    const add = String(a?.custom || a?.add || "").replace(/\s+/g, " ").trim();
    if (!add) continue;
    if ((" " + words(q).join(" ") + " ").includes(" " + words(add).join(" ") + " ")) continue;
    q = `${q} ${add}`;
  }
  return q;
}
