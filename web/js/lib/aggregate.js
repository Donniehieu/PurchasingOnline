// Tổng hợp dữ liệu đã thu thập theo từng mục và chọn phương án tối ưu.
// Không gọi mạng: chỉ dùng dữ liệu trong entry (cache).
import { median, mean, sentenceKey, norm, clip } from "./text.js";
import { cleanTechName } from "./extract.js";

// Hai câu coi là một ý nếu khóa trùng hoặc câu này nằm trọn trong câu kia (≥ 25 ký tự)
function findSimilar(map, key) {
  if (map.has(key)) return map.get(key);
  for (const [k, v] of map) if (Math.min(k.length, key.length) >= 25 && (k.includes(key) || key.includes(k))) return v;
  return null;
}

function addIds(map, key, item, srcId) {
  const cur = findSimilar(map, key);
  if (!cur) { map.set(key, { ...item, srcIds: srcId ? [srcId] : [], count: 1 }); return; }
  cur.count++;
  if (srcId && !cur.srcIds.includes(srcId)) cur.srcIds.push(srcId);
  if (item.benefit && !cur.benefit) cur.benefit = item.benefit;
  if (item.drawback && !cur.drawback) cur.drawback = item.drawback;
}

function rank(map, limit) {
  return [...map.values()].sort((a, b) => b.srcIds.length - a.srcIds.length || b.count - a.count).slice(0, limit);
}

const cleanTechs = (list) => (list ?? []).map((t) => ({ ...t, name: cleanTechName(t.name, 80) })).filter((t) => t.name);

export function priceStats(prices) {
  const vals = prices.map((p) => p.value).filter((v) => v > 0);
  if (!vals.length) return { count: 0, avg: null, median: null, min: null, max: null, items: [], dropped: [] };
  const med = median(vals);
  const keep = [], dropped = [];
  for (const p of prices) {
    if (!(p.value > 0)) continue;
    // loại giá lệch hẳn mặt bằng (phụ kiện, voucher, nhầm đơn vị) khi đã có từ 3 giá
    if (vals.length >= 3 && (p.value < med * 0.3 || p.value > med * 3.5)) dropped.push(p); else keep.push(p);
  }
  const kv = keep.map((p) => p.value);
  return { count: keep.length, avg: Math.round(mean(kv)), median: Math.round(median(kv)), min: Math.min(...kv), max: Math.max(...kv), items: keep.sort((a, b) => a.value - b.value), dropped };
}

export function summarize(entry) {
  const pros = new Map(), cons = new Map(), tech = new Map();
  for (const c of entry.pros) addIds(pros, sentenceKey(c.text), c, c.srcId);
  for (const c of entry.cons) addIds(cons, sentenceKey(c.text), c, c.srcId);
  if (entry.category === "tech") for (const t of cleanTechs(entry.tech)) addIds(tech, sentenceKey(t.name), t, t.srcId);
  const price = priceStats(entry.prices);
  return {
    price,
    pros: rank(pros, 8),
    cons: rank(cons, 8),
    tech: rank(tech, 8),
    usage: (entry.usage ?? []).slice(0, 10).map((c) => ({ ...c, srcIds: c.srcId ? [c.srcId] : [] })),
    images: [...entry.images].sort((a, b) => (b.sim ?? -1) - (a.sim ?? -1) || b.score - a.score), // có ảnh tham chiếu: giống nhất trước
    sourcesOpened: entry.pages.filter((p) => p.ok).length,
    sourcesFailed: entry.pages.filter((p) => !p.ok).length,
  };
}

// Nhật ký trang đã mở, gom theo mục để người dùng thấy mỗi trang đóng góp gì.
export function logBySection(entry) {
  const sections = { price: [], pros: [], cons: [], tech: [], images: [] };
  for (const p of entry.pages) {
    if (!p.ok) continue;
    for (const k of Object.keys(sections)) if (p.found?.[k]) sections[k].push({ url: p.url, title: p.title, n: p.found[k], srcId: p.srcId });
  }
  return sections;
}

export function comparisonRows(entry) {
  const s = summarize(entry);
  const verifiedCount = (ids) => new Set(ids.filter(Boolean)).size;
  const main = {
    isMain: true,
    brand: entry.product.brand || "—",
    name: entry.product.name,
    model: entry.product.model,
    price: s.price.median,
    priceSrcIds: s.price.items.map((i) => i.srcId).filter(Boolean).slice(0, 3),
    pros: s.pros.map((p) => p.text),
    cons: s.cons.map((p) => p.text),
    prosFull: s.pros,
    consFull: s.cons,
    tech: s.tech.map((t) => t.name),
    techFull: s.tech,
    evidence: verifiedCount([...s.pros.flatMap((p) => p.srcIds), ...s.cons.flatMap((p) => p.srcIds), ...s.price.items.map((i) => i.srcId)]),
    image: s.images.find((i) => i.for === "main")?.url ?? s.images[0]?.url ?? null,
  };
  const rows = [main];
  for (const a of entry.alternatives) {
    rows.push({
      isMain: false,
      brand: a.brand || "—",
      name: a.name,
      model: a.model,
      price: a.price,
      priceSrcIds: a.priceSrcId ? [a.priceSrcId] : [],
      pros: a.pros.map((p) => p.text),
      cons: a.cons.map((p) => p.text),
      prosFull: a.pros.map((p) => ({ text: p.text, srcIds: p.srcId ? [p.srcId] : [] })),
      consFull: a.cons.map((p) => ({ text: p.text, srcIds: p.srcId ? [p.srcId] : [] })),
      techFull: cleanTechs(a.tech),
      tech: cleanTechs(a.tech).map((t) => t.name),
      techDetail: cleanTechs(a.tech),
      vsMain: a.vsMain,
      evidence: verifiedCount([...a.srcIds]),
      image: a.images[0]?.url ?? null,
    });
  }
  return rows;
}

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/**
 * Chấm điểm từ dữ liệu đã thu thập (không tìm thêm): giá, cân bằng ưu/nhược, số nguồn, công nghệ.
 * Trả về rows có score + khuyến nghị kèm lý do.
 */
export function recommend(entry, rows = comparisonRows(entry)) {
  const tech = entry.category === "tech";
  const prices = rows.map((r) => r.price).filter((p) => p > 0);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const avgP = prices.length ? mean(prices) : null;
  const w = tech ? { price: 0.35, merit: 0.3, evidence: 0.15, tech: 0.2 } : { price: 0.45, merit: 0.4, evidence: 0.15, tech: 0 };

  const scored = rows.map((r) => {
    const priceScore = r.price > 0 ? (maxP === minP ? 0.7 : 1 - (r.price - minP) / (maxP - minP)) : 0.35;
    // tỉ lệ ưu/(ưu+nhược) có làm mịn (+1/+2) để sản phẩm có nhiều dữ liệu hơn không tự động thắng
    const merit = (r.pros.length + 1) / (r.pros.length + r.cons.length + 2);
    const evidence = clamp(r.evidence / 4);
    const techScore = tech ? clamp(r.tech.length / 4) : 0;
    const score = w.price * priceScore + w.merit * merit + w.evidence * evidence + w.tech * techScore;
    return { ...r, score: Math.round(score * 100), parts: { priceScore, merit, evidence, techScore } };
  }).sort((a, b) => b.score - a.score);

  const known = scored.filter((r) => r.price > 0);
  const cheapest = known.length ? [...known].sort((a, b) => a.price - b.price)[0] : null;
  const bestMerit = [...scored].sort((a, b) => b.parts.merit - a.parts.merit || b.pros.length - a.pros.length)[0] ?? null;
  const best = scored[0] ?? null;

  const reasons = [];
  if (best) {
    if (best.price > 0 && avgP) {
      const diff = Math.round(((best.price - avgP) / avgP) * 100);
      reasons.push(diff <= -3 ? `giá thấp hơn mặt bằng nhóm so sánh ${Math.abs(diff)}%` : diff >= 3 ? `giá cao hơn mặt bằng nhóm so sánh ${diff}%` : "giá ngang mặt bằng nhóm so sánh");
    } else reasons.push("chưa có giá xác thực, cần hỏi báo giá");
    reasons.push(`${best.pros.length} ưu điểm / ${best.cons.length} nhược điểm đã ghi nhận`);
    if (best.evidence) reasons.push(`${best.evidence} nguồn xác nhận`);
  }
  return { rows: scored, best, cheapest, bestMerit, reasons, weights: w, comparable: scored.length >= 2 };
}

// ---------- So sánh công nghệ giữa các hãng (chỉ hàng máy móc / thiết bị / gia dụng / điện tử) ----------
const TECH_PREFIX = /^(cong nghe|tinh nang|he thong|che do|technology)\s+/;

/** "Công nghệ Rapid Air 360 độ (Đối lưu khí nóng)" -> "rapid air" (để gom các cách viết của cùng một công nghệ) */
export function techKey(name) {
  return norm(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(TECH_PREFIX, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+\d[\d a-z]*$/, "")
    .trim();
}

const bareName = (name) => clip(String(name).replace(/^công nghệ\s+/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim(), 60);

/**
 * Gom công nghệ theo từng loại: hãng nào dùng, ưu điểm, nhược điểm của công nghệ đó, kèm nguồn.
 * Nguồn dữ liệu: công nghệ đã nhận diện của từng hãng + các ưu/nhược điểm có nhắc tên công nghệ.
 */
export function technologyComparison(entry) {
  const empty = { applicable: entry.category === "tech", brands: [], clusters: [], summary: [] };
  if (entry.category !== "tech") return empty;
  const s = summarize(entry);
  const mainBrand = entry.product.brand || "Sản phẩm đang xem";
  const rows = [
    { brand: mainBrand, model: entry.product.model, isMain: true, tech: cleanTechs(entry.tech).map((t) => ({ name: t.name, benefit: t.benefit, drawback: t.drawback, srcIds: t.srcId ? [t.srcId] : [] })), pros: s.pros.map((p) => ({ text: p.text, srcIds: p.srcIds })), cons: s.cons.map((p) => ({ text: p.text, srcIds: p.srcIds })) },
    ...entry.alternatives.map((a) => ({ brand: a.brand || a.name, model: a.model, isMain: false, tech: cleanTechs(a.tech).map((t) => ({ name: t.name, benefit: t.benefit, drawback: t.drawback, srcIds: t.srcId ? [t.srcId] : a.srcIds.slice(0, 1) })), pros: a.pros.map((p) => ({ text: p.text, srcIds: p.srcId ? [p.srcId] : [] })), cons: a.cons.map((p) => ({ text: p.text, srcIds: p.srcId ? [p.srcId] : [] })) })),
  ];

  const items = [];
  for (const r of rows) for (const t of r.tech) { const key = techKey(t.name); if (key.length >= 3) items.push({ ...t, key, row: r }); }
  items.sort((a, b) => a.key.length - b.key.length);

  const clusters = [];
  for (const it of items) {
    let c = clusters.find((x) => it.key === x.key || it.key.startsWith(x.key + " "));
    if (!c) { c = { key: it.key, names: [], uses: new Map(), benefits: [], drawbacks: [] }; clusters.push(c); }
    c.names.push(bareName(it.name));
    addUse(c, it.row, it.name);
    if (it.benefit) addClaim(c.benefits, { text: it.benefit, brand: it.row.brand, srcIds: it.srcIds });
    if (it.drawback) addClaim(c.drawbacks, { text: it.drawback, brand: it.row.brand, srcIds: it.srcIds });
  }

  // ưu/nhược điểm của sản phẩm có nhắc tên công nghệ -> bằng chứng cho công nghệ đó (và hãng đó dùng công nghệ này)
  for (const c of clusters) {
    if (c.key.length < 4) continue;
    for (const r of rows) {
      for (const p of r.pros) if (norm(p.text).includes(c.key)) { addUse(c, r, ""); addClaim(c.benefits, { text: p.text, brand: r.brand, srcIds: p.srcIds }); }
      for (const p of r.cons) if (norm(p.text).includes(c.key)) { addUse(c, r, ""); addClaim(c.drawbacks, { text: p.text, brand: r.brand, srcIds: p.srcIds }); }
    }
  }

  const out = clusters.map((c) => ({
    key: c.key,
    name: [...c.names].sort((x, y) => x.length - y.length)[0], // tên ngắn gọn nhất trong các cách viết
    brands: [...c.uses.values()],
    shared: c.uses.size > 1,
    benefits: c.benefits.slice(0, 4),
    drawbacks: c.drawbacks.slice(0, 4),
    evidence: new Set([...c.benefits, ...c.drawbacks].flatMap((x) => x.srcIds)).size,
  })).sort((a, b) => b.brands.length - a.brands.length || b.evidence - a.evidence || a.name.localeCompare(b.name));

  const brands = rows.map((r) => ({ brand: r.brand, model: r.model, isMain: r.isMain, count: out.filter((c) => c.brands.some((b) => norm(b.brand) === norm(r.brand))).length }));
  return { applicable: true, brands, clusters: out, summary: techSummary(out, brands) };
}

function addUse(c, row, detailName) {
  const k = norm(row.brand);
  const cur = c.uses.get(k) ?? { brand: row.brand, model: row.model, isMain: row.isMain, names: [] };
  if (detailName && !cur.names.includes(detailName)) cur.names.push(detailName);
  c.uses.set(k, cur);
}
function addClaim(list, claim) {
  const k = sentenceKey(claim.text) + "|" + norm(claim.brand);
  if (list.some((x) => sentenceKey(x.text) + "|" + norm(x.brand) === k)) return;
  list.push({ ...claim, text: clip(claim.text, 200), srcIds: [...new Set(claim.srcIds ?? [])] });
}

function techSummary(clusters, brands) {
  if (!clusters.length) return [];
  const names = (c) => c.brands.map((b) => b.brand).join(", ");
  const lines = [`Nhận diện ${clusters.length} công nghệ trên ${brands.filter((b) => b.count).length}/${brands.length} hãng.`];
  const shared = clusters.filter((c) => c.shared);
  const solo = clusters.filter((c) => !c.shared);
  if (shared.length) lines.push("Dùng chung nhiều hãng: " + shared.slice(0, 4).map((c) => `${c.name} (${names(c)})`).join("; ") + ".");
  if (solo.length) lines.push("Riêng từng hãng: " + solo.slice(0, 5).map((c) => `${c.name} (${names(c)})`).join("; ") + ".");
  const bad = clusters.filter((c) => c.drawbacks.length).slice(0, 3);
  if (bad.length) lines.push("Hạn chế cần lưu ý: " + bad.map((c) => `${c.name} — ${clip(c.drawbacks[0].text, 80)}`).join("; ") + ".");
  const good = clusters.filter((c) => c.benefits.length).slice(0, 3);
  if (good.length) lines.push("Điểm mạnh nổi bật: " + good.map((c) => `${c.name} — ${clip(c.benefits[0].text, 80)}`).join("; ") + ".");
  const none = clusters.filter((c) => !c.benefits.length && !c.drawbacks.length).length;
  if (none) lines.push(`${none} công nghệ chưa có thông tin ưu/nhược điểm: bấm “Tìm thêm dữ liệu mới” để bổ sung.`);
  return lines;
}
