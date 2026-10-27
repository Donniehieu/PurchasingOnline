// Thẻ câu hỏi (question cards): 3–5 câu hỏi ngắn, tạo từ chính dữ liệu đã đọc cho từ khóa vừa tìm,
// để người dùng chọn đúng loại sản phẩm / đối tượng. Câu trả lời CHỈ lọc và xếp hạng kết quả đã có, không dùng để tìm kiếm.
import { norm } from "./text.js";

// Các đặc điểm thường gặp trong tên/thông số sản phẩm. re có một nhóm bắt giá trị; lookbehind loại "ren 13mm" khỏi kích thước.
export const FACETS = [
  { id: "size", title: "Kích thước (đường kính, bề ngang) bạn cần?", short: "kích thước", re: /(?<!ren ?)(\d{2,4}) ?mm\b/g, label: (m) => `${m[1]} mm`, key: (m) => `${m[1]}mm` },
  { id: "pressure", title: "Dải áp suất tối đa bạn cần?", short: "áp suất", re: /(\d+(?:[.,]\d+)?) ?(bar|psi|mpa|kpa)\b/g, label: (m) => `${m[1]} ${m[2]}`, key: (m) => `${m[1].replace(",", ".")}${m[2]}` },
  { id: "material", title: "Chất liệu bạn muốn?", short: "chất liệu", re: /\b(inox ?(?:304|316l?|201)|inox|thep|dong thau|nhom|nhua|gang)\b/g, label: (m) => MATERIAL_LABEL[m[1]] ?? cap(m[1]), key: (m) => m[1].replace(/ /g, "") },
  { id: "thread", title: "Kích thước ren / kiểu kết nối?", short: "ren", re: /\bren ?(\d{1,2}(?:\/\d+)?)(?: ?mm)?/g, label: (m) => `Ren ${m[1]}`, key: (m) => `ren${m[1]}` },
  { id: "power", title: "Công suất bạn cần?", short: "công suất", re: /(\d+(?:[.,]\d+)?) ?(kw|hp|w)\b/g, label: (m) => `${m[1]} ${m[2].toUpperCase() === "W" ? "W" : m[2].toUpperCase()}`, key: (m) => `${m[1].replace(",", ".")}${m[2]}` },
  { id: "capacity", title: "Dung tích bạn cần?", short: "dung tích", re: /(\d+(?:[.,]\d+)?) ?(lit|l|ml)\b/g, label: (m) => `${m[1]} ${m[2] === "ml" ? "ml" : "lít"}`, key: (m) => `${m[1].replace(",", ".")}${m[2] === "lit" ? "l" : m[2]}` },
];
const MATERIAL_LABEL = { thep: "Thép", "dong thau": "Đồng thau", nhom: "Nhôm", nhua: "Nhựa", gang: "Gang" };
const cap = (s) => String(s).replace(/^./, (c) => c.toUpperCase());

export const AUDIENCES = ["Gia đình, cá nhân", "Cửa hàng, kinh doanh", "Nhà xưởng, công trình", "Văn phòng, doanh nghiệp"];
export const PRIORITIES = [["cheap", "Giá rẻ nhất"], ["balanced", "Cân bằng giá và chất lượng"], ["quality", "Chất lượng, công nghệ"], ["durable", "Bền, bảo hành tốt"]];

/** Giá trị của một đặc điểm trong một dòng NCC: Map khóa -> nhãn hiển thị. */
export function facetValues(row, facet) {
  const hay = norm(`${row.nameText ?? ""} ${row.specText ?? ""}`);
  const out = new Map();
  for (const m of hay.matchAll(facet.re)) { const k = facet.key(m); if (!out.has(k)) out.set(k, facet.label(m)); }
  return out;
}

/** Dòng có hợp các câu trả lời không. Dòng không nói gì về đặc điểm đó thì giữ lại nhưng ghi "chưa rõ". */
export function rowPasses(row, answers = {}) {
  const unknown = [];
  for (const [id, value] of Object.entries(answers)) {
    const f = FACETS.find((x) => x.id === id);
    if (!f || !value) continue;
    const vals = facetValues(row, f);
    if (!vals.size) { unknown.push(f.short); continue; }
    if (!vals.has(value)) return { ok: false, unknown };
  }
  return { ok: true, unknown };
}

// Làm tròn "đẹp" cho mốc ngân sách: 1.234.000 -> 1.200.000
function nice(v) {
  if (!v) return 0;
  const p = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
}
const vnd = (v) => (v >= 1e6 ? `${+(v / 1e6).toFixed(2)} triệu` : `${Math.round(v / 1000)}k`);

/**
 * Tạo 3–5 thẻ câu hỏi. rows: các dòng của bảng NCC (đã đọc hoặc có giá). need: nhu cầu hiện tại; answers: đã chọn.
 * Thẻ gồm: đối tượng sử dụng, (tối đa 2–3) đặc điểm khác nhau giữa các sản phẩm đã tìm thấy, ngân sách (nếu chưa nhập), ưu tiên.
 */
export function buildCards(rows, need = {}, answers = {}) {
  const cards = [];
  cards.push({ id: "audience", kind: "need", title: "Bạn mua cho đối tượng nào?", options: AUDIENCES.map((a) => ({ value: a, label: a })), selected: AUDIENCES.includes(need.purpose) ? need.purpose : "" });

  const facets = FACETS.map((f) => {
    const counts = new Map(), labels = new Map();
    let covered = 0;
    for (const r of rows) {
      const vals = facetValues(r, f);
      if (!vals.size) continue;
      covered++;
      for (const [k, l] of vals) { counts.set(k, (counts.get(k) ?? 0) + 1); labels.set(k, l); }
    }
    return { f, counts, labels, covered };
  }).filter((x) => x.counts.size >= 2 && x.counts.size <= 8 && x.covered >= 2).sort((a, b) => b.covered - a.covered || FACETS.indexOf(a.f) - FACETS.indexOf(b.f));
  const maxFacets = 5 - 1 /* đối tượng */ - 1 /* ưu tiên */ - (need.budgetMin == null && need.budgetMax == null ? 1 : 0);
  for (const x of facets.slice(0, Math.min(3, Math.max(maxFacets, 0)))) {
    const options = [...x.counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => ({ value: k, label: x.labels.get(k), count: n }));
    cards.push({ id: x.f.id, kind: "facet", title: x.f.title, options, selected: answers[x.f.id] || "" });
  }

  if (need.budgetMin == null && need.budgetMax == null) {
    const prices = rows.map((r) => r.price).filter((p) => p != null).sort((a, b) => a - b);
    if (prices.length >= 3) {
      const q1 = nice(prices[Math.floor((prices.length - 1) * 0.33)]), q3 = nice(prices[Math.floor((prices.length - 1) * 0.67)]);
      if (q3 > q1) cards.push({ id: "budget", kind: "need", title: "Ngân sách của bạn khoảng bao nhiêu?", options: [{ value: `0:${q1}`, label: `Dưới ${vnd(q1)}` }, { value: `${q1}:${q3}`, label: `${vnd(q1)} – ${vnd(q3)}` }, { value: `${q3}:0`, label: `Trên ${vnd(q3)}` }], selected: "" });
    }
  }
  cards.push({ id: "priority", kind: "need", title: "Bạn ưu tiên điều gì nhất?", options: PRIORITIES.map(([value, label]) => ({ value, label })), selected: need.priority && need.priority !== "balanced" ? need.priority : "" });
  return cards.slice(0, 5);
}
