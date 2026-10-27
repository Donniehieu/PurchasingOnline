// Trả lời câu hỏi chỉ bằng dữ liệu trong cache: ngắn gọn, đúng câu hỏi, gắn nguồn [n] bên cạnh.
import { norm, money } from "./text.js";
import { summarize, recommend, technologyComparison } from "./aggregate.js";

const refs = (ids) => (ids?.length ? " " + ids.slice(0, 3).map((i) => `[${i}]`).join("") : "");

export const INTENTS = [
  { id: "techcmp", label: "So sánh công nghệ", re: /(so sanh|khac nhau|giua cac hang|hang nao).*cong nghe|cong nghe.*(so sanh|khac nhau|hang nao|cac hang|tung hang)/ },
  { id: "price", label: "Giá", re: /\b(gia|bao nhieu|chi phi|mac|re|price|cost)\b/ },
  { id: "pros", label: "Ưu điểm", re: /\b(uu diem|diem manh|diem cong|tot o dau|loi the|pros?)\b/ },
  { id: "cons", label: "Nhược điểm", re: /\b(nhuoc diem|diem yeu|han che|diem tru|van de|cons?)\b/ },
  { id: "tech", label: "Công nghệ", re: /\b(cong nghe|tinh nang|technology|tech)\b/ },
  { id: "choose", label: "Nên chọn", re: /\b(nen chon|nen mua|toi uu|tot nhat|so sanh|hang nao|cai nao|lua chon|khuyen|compare|best)\b/ },
  { id: "images", label: "Hình ảnh", re: /\b(hinh|anh|image|photo)\b/ },
];

export function detectIntent(question) {
  const q = norm(question);
  // "nhược điểm" chứa từ gây nhầm với "điểm": ưu tiên intent cụ thể trước
  for (const id of ["techcmp", "cons", "pros", "tech", "choose", "images", "price"]) {
    const it = INTENTS.find((i) => i.id === id);
    if (it.re.test(q)) return id;
  }
  return null;
}

export function answerFromCache(entry, question, intent = detectIntent(question)) {
  const s = summarize(entry);
  const name = [entry.product.brand, entry.product.model || entry.product.name].filter(Boolean).join(" ") || entry.product.name;
  if (intent === "price") {
    if (!s.price.count) return { intent, text: `Chưa có giá xác thực cho ${name}. Nên hỏi báo giá nhà cung cấp.`, srcIds: [] };
    const ids = s.price.items.map((i) => i.srcId).filter(Boolean);
    const range = s.price.min === s.price.max ? "" : `, dao động ${money(s.price.min)} – ${money(s.price.max)}`;
    return { intent, text: `Giá trung bình ${name}: ${money(s.price.median)}${range} (${s.price.count} nguồn).${refs(ids)}`, srcIds: ids.slice(0, 3) };
  }
  if (intent === "pros" || intent === "cons") {
    const list = intent === "pros" ? s.pros : s.cons;
    const label = intent === "pros" ? "Ưu điểm" : "Nhược điểm";
    if (!list.length) return { intent, text: `Chưa có ${label.toLowerCase()} được ghi nhận cho ${name}.`, srcIds: [] };
    const top = list.slice(0, 4);
    return { intent, text: `${label} ${name}:\n` + top.map((p) => `• ${p.text}${refs(p.srcIds)}`).join("\n"), srcIds: top.flatMap((p) => p.srcIds) };
  }
  if (intent === "techcmp") {
    if (entry.category !== "tech") return { intent, text: "Đây là hàng tiêu dùng nên chỉ so sánh giá, ưu điểm, nhược điểm — không phân tích công nghệ.", srcIds: [] };
    const tc = technologyComparison(entry);
    if (!tc.clusters.length) return { intent, text: "Chưa có thông tin công nghệ của các hãng. Bấm “Tìm thêm dữ liệu mới” để bổ sung.", srcIds: [] };
    const top = tc.clusters.slice(0, 4);
    const lines = top.map((c) => {
      const ub = c.brands.map((b) => b.brand).join(", ");
      const good = c.benefits[0] ? ` Ưu: ${c.benefits[0].text}.` : "";
      const bad = c.drawbacks[0] ? ` Nhược: ${c.drawbacks[0].text}.` : "";
      const ids = [...new Set([...(c.benefits[0]?.srcIds ?? []), ...(c.drawbacks[0]?.srcIds ?? [])])];
      return `• ${c.name} (${ub}):${good}${bad}${refs(ids)}`;
    });
    return { intent, text: `So sánh công nghệ giữa ${tc.brands.length} hãng:\n` + lines.join("\n"), srcIds: top.flatMap((c) => [...(c.benefits[0]?.srcIds ?? []), ...(c.drawbacks[0]?.srcIds ?? [])]) };
  }
  if (intent === "tech") {
    if (entry.category !== "tech") return { intent, text: "Đây là hàng tiêu dùng nên chỉ so sánh giá, ưu điểm, nhược điểm — không phân tích công nghệ.", srcIds: [] };
    if (!s.tech.length) return { intent, text: `Chưa có thông tin công nghệ cho ${name}.`, srcIds: [] };
    const top = s.tech.slice(0, 4);
    return {
      intent,
      text: `Công nghệ ${name}:\n` + top.map((t) => `• ${t.name}${t.benefit ? ` — ưu: ${t.benefit}` : ""}${t.drawback ? ` — nhược: ${t.drawback}` : ""}${refs(t.srcIds)}`).join("\n"),
      srcIds: top.flatMap((t) => t.srcIds),
    };
  }
  if (intent === "choose") {
    const rec = recommend(entry);
    if (!rec.best) return { intent, text: "Chưa đủ dữ liệu để so sánh.", srcIds: [] };
    if (!rec.comparable) return { intent, text: `Mới có một sản phẩm (${name}), chưa có hãng khác để so sánh.`, srcIds: [] };
    const b = rec.best;
    const bn = [b.brand, b.model || b.name].filter(Boolean).join(" ");
    const lines = [`Nên chọn: ${bn}${b.price ? ` (${money(b.price)})` : ""} — ${rec.reasons.join("; ")}.`];
    if (rec.cheapest && rec.cheapest !== b) lines.push(`Rẻ nhất: ${[rec.cheapest.brand, rec.cheapest.model || rec.cheapest.name].join(" ")} (${money(rec.cheapest.price)}).`);
    return { intent, text: lines.join("\n") + refs(b.priceSrcIds), srcIds: b.priceSrcIds };
  }
  if (intent === "images") {
    return { intent, text: s.images.length ? `Đã thu thập ${s.images.length} hình ảnh sản phẩm từ ${new Set(s.images.map((i) => i.srcId)).size} trang (xem tab Hình ảnh).` : "Chưa lấy được hình ảnh.", srcIds: [] };
  }
  return null;
}

// Thay [n] trong câu trả lời bằng nguồn thật khi hiển thị
export function sourcesOf(entry, ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const s = entry.sources.find((x) => x.id === id);
    if (s) out.push(s);
  }
  return out;
}

// Ngữ cảnh gọn gửi cho AI khi câu hỏi tự do (chỉ dùng dữ liệu đã cache, không tìm web)
export function contextForAI(entry) {
  const s = summarize(entry);
  const rec = recommend(entry);
  return {
    product: entry.product,
    category: entry.category,
    price: { median: s.price.median, avg: s.price.avg, min: s.price.min, max: s.price.max, items: s.price.items.slice(0, 6).map((i) => ({ value: i.value, label: i.label, src: i.srcId })) },
    pros: s.pros.map((p) => ({ text: p.text, src: p.srcIds })),
    cons: s.cons.map((p) => ({ text: p.text, src: p.srcIds })),
    tech: s.tech.map((t) => ({ name: t.name, benefit: t.benefit, drawback: t.drawback, src: t.srcIds })),
    specs: entry.specs.slice(0, 12),
    compare: rec.rows.map((r) => ({ brand: r.brand, model: r.model || r.name, price: r.price, pros: r.pros.slice(0, 3), cons: r.cons.slice(0, 3), score: r.score, src: r.priceSrcIds })),
    sources: entry.sources.map((x) => ({ id: x.id, url: x.url, title: x.title })),
  };
}
