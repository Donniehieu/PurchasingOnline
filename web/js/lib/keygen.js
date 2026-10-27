// Sinh từ khóa tìm kiếm bổ sung, theo thứ tự ưu tiên. Nguyên tắc:
//   1) GIỮ NGUYÊN chuỗi người dùng gõ; chỉ ghép thêm (a) thông tin họ trả lời, (b) cụm hỏi mặc định (giá, ưu/nhược điểm, công nghệ…)
//   2) tìm hãng đối thủ cạnh tranh, rồi mỗi hãng một bộ từ khóa: loại sản phẩm + hãng + giá / chất lượng / ưu nhược điểm / công nghệ
//   3) (hàng kỹ thuật) từ khóa về các công nghệ của cả nhóm sản phẩm, để so sánh công nghệ chứ không chỉ sản phẩm đang tìm
import { norm } from "./text.js";
import { TYPES } from "./kb.js";
import { canonBrand } from "./plan.js";

export const GROUP_LABEL = { core: "Từ khóa theo thông tin bạn cung cấp", competitor: "Hãng đối thủ", tech: "Công nghệ của nhóm sản phẩm" };

// cụm hỏi mặc định ghép sau tên sản phẩm
const CORE_SUFFIX = ["giá bán", "ưu điểm nhược điểm", "chất lượng đánh giá thực tế", "thông số công nghệ tính năng"];
const CORE_SUFFIX_CONSUMER = ["giá bán", "ưu điểm nhược điểm", "chất lượng đánh giá thực tế"];

const squash = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
const has = (hay, needle) => ` ${norm(hay)} `.includes(` ${norm(needle)} `);

/** Ghép các câu trả lời vào sau chuỗi người dùng gõ, bỏ ý đã có sẵn trong chuỗi. */
export function withInfo(typed, adds = []) {
  let q = squash(typed);
  for (const a of adds) { const t = squash(a); if (t && !has(q, t)) q = `${q} ${t}`; }
  return q;
}

/** Hãng trong ngân hàng câu hỏi của một loại hàng. */
export function brandsOfType(type) {
  const q = type?.questions?.find((x) => x.id === "brand");
  return (q?.options ?? []).map((o) => o.label);
}

/**
 * Hãng đối thủ để tìm tiếp. Ưu tiên hãng đã gặp trong kết quả (đang bán thật), rồi hãng đã học từ cache, rồi danh sách có sẵn của loại hàng.
 * Loại hãng của sản phẩm đang tìm và hãng trùng.
 */
export function competitorBrands({ entry = null, type = null, mainBrand = "", learned = [], max = 4 } = {}) {
  const main = norm(mainBrand || entry?.product?.brand || "");
  const list = [];
  const push = (b) => {
    const label = canonBrand(b);
    const k = norm(label);
    if (!k || k.length < 2 || (main && (k === main || main.includes(k) || k.includes(main)))) return;
    if (!list.some((x) => norm(x) === k)) list.push(label);
  };
  for (const a of entry?.alternatives ?? []) push(a.brand);
  for (const o of entry?.offers ?? []) if (o.kind === "other") push(o.brand);
  for (const b of learned) push(b);
  for (const b of brandsOfType(type)) push(b);
  return list.slice(0, max);
}

/** Bộ từ khóa của một hãng đối thủ: loại sản phẩm + hãng + giá / chất lượng, ưu nhược điểm / công nghệ. */
export function brandKeys(kind, brand, category = "tech") {
  const k = [`${kind} ${brand} giá bán`, `${kind} ${brand} chất lượng ưu điểm nhược điểm`];
  if (category !== "consumer") k.push(`${kind} ${brand} công nghệ tính năng`);
  return k;
}

/**
 * Sinh toàn bộ từ khóa bổ sung.
 *  typed: chuỗi người dùng gõ (giữ nguyên); adds: chữ từ câu trả lời; generic: tên loại sản phẩm ("máy lọc nước");
 *  category: "tech" | "consumer"; brands: hãng đối thủ; techNames: công nghệ của nhóm sản phẩm (từ ngân hàng công nghệ)
 * Trả về [{ key, group, brand? }] đã bỏ trùng, tối đa max.
 */
export function genKeys({ typed, adds = [], generic = "", category = "tech", mainBrand = "", brands = [], techNames = [], max = 14 } = {}) {
  const base = withInfo(typed, adds);
  const kind = squash(generic) || squash(typed);
  const out = [];
  const seen = new Set();
  const push = (key, group, extra = {}) => {
    const k = norm(key);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ key: squash(key), group, ...extra });
  };

  // (1) giữ nguyên chuỗi gõ + thông tin trả lời + cụm hỏi mặc định
  const suffixes = category === "consumer" ? CORE_SUFFIX_CONSUMER : CORE_SUFFIX;
  if (adds.some((a) => squash(a))) push(base, "core");
  for (const s of suffixes) push(`${base} ${s}`, "core");

  // (2) đối thủ cạnh tranh
  push(`${kind} ${mainBrand ? `đối thủ cạnh tranh của ${mainBrand}` : "các thương hiệu tốt nhất hiện nay"}`, "competitor");
  push(`so sánh các hãng ${kind} cùng tầm giá`, "competitor");
  for (const b of brands) for (const k of brandKeys(kind, b, category)) push(k, "competitor", { brand: b });

  // (3) công nghệ của cả nhóm sản phẩm
  if (category !== "consumer") {
    push(`công nghệ ${kind} nào tốt nhất, so sánh các công nghệ`, "tech");
    for (const t of techNames) push(`${kind} công nghệ ${t} ưu điểm nhược điểm`, "tech", { tech: t });
  }
  return out.slice(0, max);
}

/** Xếp từ khóa theo vòng: lần lượt mỗi nhóm một khóa để nhóm nào cũng được tìm dù bị cắt bớt. */
export function interleave(keys) {
  const groups = ["core", "competitor", "tech"].map((g) => keys.filter((k) => k.group === g));
  const out = [];
  for (let i = 0; groups.some((g) => i < g.length); i++) for (const g of groups) if (g[i]) out.push(g[i]);
  return out;
}

export const typeById = (id) => TYPES.find((t) => t.id === id) ?? null;
