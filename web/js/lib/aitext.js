// Phân tích câu trả lời của Google Chế độ AI (dòng chữ + nhãn nguồn) thành dữ liệu có cấu trúc, bằng quy tắc.
// Mỗi ý giữ lại chỉ số nguồn trích dẫn (cites) để sau này gắn URL thật.
import { norm, parseVnd, clip } from "./text.js";
import { techNames, cleanTechName } from "./extract.js";
import { exactQuery } from "./plan.js";

const SECTIONS = [
  ["pros", /^(các |những )?(ưu điểm|điểm mạnh|điểm cộng|ưu thế|lợi thế|mặt tốt)/i],
  ["cons", /^(các |những )?(nhược điểm|điểm yếu|điểm trừ|hạn chế|điểm hạn chế|mặt hạn chế|lưu ý|điểm cần lưu ý)/i],
  ["specs", /^(thông số|bảng thông số|cấu hình|thông tin cơ bản)/i],
  ["tech", /^(các |những )?(công nghệ|tính năng|công nghệ nổi bật|tính năng nổi bật)/i],
  ["price", /^(giá|mức giá|giá bán|bảng giá)\s*(?:tham khảo|hiện tại|tại việt nam)?\s*:?\s*$/i],
  ["verdict", /^(đánh giá chung|kết luận|tổng kết|có nên mua|nên mua)/i],
  ["end", /^(để giúp bạn|bạn (có|dự kiến|đang|muốn|định|cần)|nếu bạn (muốn|đang|cần|có|định)|bạn có thể chia sẻ|hãy cho (tôi|mình) biết|tôi có thể (giúp|hỗ trợ))/i],
];

function sectionOf(line) {
  const t = line.replace(/^[#*•\-–\d.)\s]+/, "").trim();
  if (t.length > 90 || t.includes(" | ")) return null; // dòng bảng không phải đề mục
  if (t.includes(",") && !/:s*$/.test(t)) return null;  // đề mục không có dấu phẩy: "Giá rẻ hơn X, phù hợp Y" là một ý
  // "Tiêu đề: mô tả dài" là một ý, không phải đề mục
  if (/:\s+\S/.test(t) && t.length > 45) return null;
  for (const [id, re] of SECTIONS) if (re.test(t)) return id === "price" && t.length > 30 ? null : id;
  return null;
}

const PRICE_TOKEN = /(\d{1,3}(?:[.,]\d{3})+)\s*(?:đ|₫|vnđ|vnd)(?![\p{L}\d])|(\d+(?:[.,]\d+)?)\s*(?:triệu|tr|nghìn|ngàn)(?![\p{L}\d])/giu;

export function pricesIn(line) {
  const out = [];
  for (const m of line.matchAll(PRICE_TOKEN)) {
    const v = parseVnd(m[0]);
    if (v && v >= 1000 && v < 5e9) out.push(v); // hàng tiêu dùng có thể dưới 10.000đ (1 hộp sữa, 1 gói mì)
  }
  return out;
}

/**
 * input: { lines: [{t, c:[citeIdx]}], cites: [{label, href}] }
 * Trả về dữ liệu giống JSON của AI, nhưng mỗi ý có `cites` thay cho `source`.
 */
export function parseAnswer({ lines, cites }, plan = {}) {
  const out = { category: plan.category, product: { summary: "" }, prices: [], pros: [], cons: [], technologies: [], specs: [], verdict: "" };
  let sec = "intro";
  const seenText = new Set();
  const techCategory = plan.category !== "consumer";
  let introTaken = false;
  let label = "";

  for (const ln of lines ?? []) {
    const t = ln.t;
    const s = sectionOf(t);
    if (s) { sec = s; label = ""; continue; }
    const c = ln.c ?? [];

    // giá: câu nào có tiền VND và nhắc "giá" (hoặc đang ở mục giá)
    if (/giá|price|mức giá|dao động|khoảng/i.test(t) || sec === "price") {
      const vals = pricesIn(t);
      if (vals.length && !/trả góp|\/tháng|voucher|giảm\s*\d/i.test(t)) {
        const label = vals.length > 1 ? `Google: khoảng ${Math.min(...vals).toLocaleString("vi-VN")}–${Math.max(...vals).toLocaleString("vi-VN")} ₫` : "Google AI";
        // khoảng giá hai đầu: dùng trung điểm để không kéo lệch thống kê; giữ nguyên khoảng trong nhãn
        const v = vals.length > 1 ? Math.round((Math.min(...vals) + Math.max(...vals)) / 2) : vals[0];
        out.prices.push({ value: v, label, cites: c, low: Math.min(...vals), high: Math.max(...vals) });
      }
    }

    if (sec === "intro" && !introTaken && t.length > 40 && !/^dưới đây/i.test(t)) { out.product.summary = clip(t, 300); introTaken = true; continue; }

    if (sec === "pros" || sec === "cons") {
      // nhãn đậm đứng riêng một dòng ("Giá thành cao:") thuộc về dòng mô tả ngay sau nó
      if (/:\s*$/.test(t) && t.length < 70) { label = t.replace(/^[•\-–*\s]+/, ""); continue; }
      const full = label ? `${label} ${t}` : t;
      label = "";
      if (full.length < 15 || seenText.has(norm(full))) continue;
      seenText.add(norm(full));
      out[sec].push({ text: full.replace(/^[•\-–*\s]+/, ""), cites: c });
    } else if (sec === "specs") {
      const [k, ...rest] = t.split(" | ");
      const v = rest.join(" | ").trim();
      if (!v || /^tiêu chí$/i.test(k)) continue;
      out.specs.push({ name: k.trim(), value: v });
      if (techCategory && /công nghệ/i.test(k)) out.technologies.push({ name: v.split(/\s*[(;]/)[0].trim(), benefit: v.includes("(") ? v.slice(v.indexOf("(") + 1).replace(/\)\s*$/, "") : "", drawback: "", cites: c });
    } else if (sec === "tech" && techCategory) {
      if (t.length >= 12) {
        const [name, ...d] = t.split(/:\s+/);
        out.technologies.push({ name: clip(name, 70), benefit: clip(d.join(": "), 200), drawback: "", cites: c });
      }
    } else if (sec === "verdict" && !out.verdict && t.length > 40) {
      out.verdict = clip(t, 400);
    }
  }

  // tên công nghệ nhắc trong ưu/nhược điểm ("Công nghệ Rapid Air giúp ...")
  if (techCategory) {
    const text = out.pros.map((p) => p.text).join("\n");
    for (const name of techNames(text, 4)) {
      const bare = name.replace(/^Công nghệ\s+/i, "");
      if (!out.technologies.some((x) => norm(x.name).includes(norm(bare)))) out.technologies.push({ name: bare, benefit: "", drawback: "", cites: [] });
    }
  } else out.technologies = [];
  out.technologies = out.technologies.map((t) => ({ ...t, name: cleanTechName(t.name, 70) })).filter((t) => t.name);
  return out;
}

/**
 * Chuỗi truy vấn gửi Chế độ AI: [chuỗi người dùng gõ, GIỮ NGUYÊN] + cụm hỏi (giá, ưu điểm, nhược điểm, công nghệ...).
 * Không bao giờ cắt tên/mã sản phẩm; chỉ ghép thêm cụm hỏi phía sau.
 */
// variant 0: câu hỏi gốc; các lần tìm bổ sung dùng cụm hỏi khác để Google dẫn ra nguồn khác
const TECH_VARIANTS = [
  (n) => `${n}: giá bán ở Việt Nam, thông số, công nghệ sử dụng, ưu điểm, nhược điểm`,
  (n) => `${n}: đánh giá thực tế của người dùng, lỗi hay gặp, độ bền, chế độ bảo hành`,
  (n) => `${n} so với các hãng cùng tầm giá: nên mua hay không, điểm khác biệt về công nghệ`,
  (n) => `${n} mua ở đâu giá tốt, giá thấp nhất hiện nay ở các cửa hàng uy tín`,
];
const CONSUMER_VARIANTS = [
  (n) => `${n} giá bao nhiêu, ưu điểm, nhược điểm so với sản phẩm tương tự`,
  (n) => `${n} đánh giá thực tế của người dùng, có tốt không`,
  (n) => `${n} so với sản phẩm thay thế rẻ hơn hoặc tương đương`,
  (n) => `${n} mua ở đâu giá tốt nhất`,
];
export function aiQuery(plan, variant = plan.variant ?? 0) {
  const name = exactQuery(plan.query) || plan.name;
  const list = plan.category === "consumer" ? CONSUMER_VARIANTS : TECH_VARIANTS;
  return list[Math.abs(variant) % list.length](name);
}
