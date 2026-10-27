// Nhu cầu của người mua (ngân sách, mục đích, số người, diện tích) cắt từ câu họ gõ.
// CHỈ dùng để điền sẵn ô nhu cầu và để đề xuất sản phẩm / nhà cung cấp. KHÔNG dùng để tìm kiếm:
// từ khóa tìm vẫn là đúng chuỗi người dùng gõ.
import { norm, parseVnd } from "./text.js";

const UNIT = "(?:trieu|tr|cu|nghin|ngan|k|ty|dong|vnd|d)";
const NUM = "(\\d[\\d.,]*)";
const AMT = `${NUM}\\s*(${UNIT})?(?![a-z])`;

// "5 triệu", "5tr", "5,5tr", "5.000.000", "2 tỷ" -> đồng. Số trần nhỏ (không có đơn vị) bỏ qua vì mơ hồ.
export function amountOf(num, unit) {
  const n = String(num ?? "").trim();
  if (!n) return null;
  const u = unit || "";
  if (!u) {
    const v = parseVnd(n.replace(/[^\d]/g, ""));
    return v != null && v >= 100000 ? v : null;
  }
  if (u === "ty") return Math.round(parseFloat(n.replace(",", ".")) * 1e9);
  const v = parseVnd(`${n} ${u === "cu" ? "trieu" : u}`);
  return v != null && v > 0 ? v : null;
}

const EMPTY = { budgetMin: null, budgetMax: null, purpose: "", people: null, area: null };

/** Cắt nhu cầu từ chuỗi người dùng gõ. Không tìm thấy gì thì trả về các trường rỗng. */
export function parseNeed(text) {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  const out = { ...EMPTY };
  if (!raw) return out;
  const t = norm(raw);

  // khoảng giá: "3-5 triệu", "từ 3 đến 5tr"
  let m = t.match(new RegExp(`${NUM}\\s*(${UNIT})?\\s*(?:-|~|den|toi)\\s*${NUM}\\s*(${UNIT})(?![a-z])`));
  if (m) {
    const unit = m[2] || m[4];
    const a = amountOf(m[1], unit), b = amountOf(m[3], m[4]);
    if (a != null && b != null) { out.budgetMin = Math.min(a, b); out.budgetMax = Math.max(a, b); }
  }
  if (out.budgetMax == null) {
    m = t.match(new RegExp(`(?:duoi|toi da|khong qua|khong vuot|re hon|nho hon|<=|<)\\s*${AMT}`));
    if (m) out.budgetMax = amountOf(m[1], m[2]);
    m = t.match(new RegExp(`(?:tren|toi thieu|it nhat|lon hon|>=|>|tu)\\s*${AMT}`));
    if (m) out.budgetMin = amountOf(m[1], m[2]);
  }
  if (out.budgetMax == null && out.budgetMin == null) {
    m = t.match(new RegExp(`(?:khoang|tam|ngan sach|budget|chung|co)\\s*${AMT}`)) || t.match(new RegExp(`${NUM}\\s*(trieu|tr|cu)(?![a-z])`));
    const v = m && (m.length > 3 ? amountOf(m[1], m[2]) : amountOf(m[1], m[2]));
    if (v) { out.budgetMin = Math.round(v * 0.85); out.budgetMax = Math.round(v * 1.15); }
  }

  const people = t.match(/(\d{1,2})\s*(?:nguoi|thanh vien)/);
  if (people) out.people = Number(people[1]);
  const area = t.match(/(\d{1,3}(?:[.,]\d+)?)\s*(?:m2|m²|met vuong)/);
  if (area) out.area = parseFloat(area[1].replace(",", "."));

  // mục đích: cụm sau "để / dùng để / cho / phục vụ", bỏ phần ngân sách
  const lower = raw.toLowerCase();
  const p = lower.match(/(?:dùng để|để|dùng cho|phục vụ|cho)\s+([^,.;\n]{3,70})/);
  if (p) {
    let s = p[1].replace(/(^|\s)(dưới|trên|khoảng|tầm|từ|giá|ngân sách)(?=\s|$).*$/, "").trim();
    if (!/^(tôi|mình|em|anh|chị|xem|biết|hỏi)(?=\s|$)/.test(s) && s.length >= 3) out.purpose = s.slice(0, 60);
  }
  return out;
}

export const hasNeed = (n) => !!(n && (n.budgetMin != null || n.budgetMax != null || n.purpose || n.people || n.area || (n.priority && n.priority !== "balanced")));

export function needSummary(n) {
  if (!hasNeed(n)) return "";
  const money = (v) => (v >= 1e6 ? `${+(v / 1e6).toFixed(2)} triệu` : `${v.toLocaleString("vi-VN")}đ`);
  const parts = [];
  if (n.budgetMin != null && n.budgetMax != null) parts.push(`ngân sách ${money(n.budgetMin)} – ${money(n.budgetMax)}`);
  else if (n.budgetMax != null) parts.push(`ngân sách tối đa ${money(n.budgetMax)}`);
  else if (n.budgetMin != null) parts.push(`ngân sách từ ${money(n.budgetMin)}`);
  if (n.purpose) parts.push(`dùng để ${n.purpose}`);
  if (n.people) parts.push(`${n.people} người`);
  if (n.area) parts.push(`${n.area} m²`);
  return parts.join(" · ");
}
