// Kiểm tra tính năng / công nghệ bằng tìm kiếm trước khi coi là từ khóa đúng.
// Với mỗi tên công nghệ: tìm "<sản phẩm / nhóm sản phẩm đang tìm> <tên công nghệ>" rồi xem kết quả có thật sự nhắc cụm từ đó
// (hoặc cụm có ý nghĩa/chức năng tương đồng) trong NGỮ CẢNH nhóm sản phẩm hay không. Đạt thì mới dùng làm từ khóa; không đạt thì
// chỉ hiển thị "chưa kiểm chứng". Gặp lỗi tìm (bị chặn) thì giữ nguyên trạng thái chưa biết, không kết luận sai.
import { norm, domainOf, clip } from "./text.js";

const STOP = new Set(["cong", "nghe", "tinh", "nang", "che", "do", "he", "thong", "technology", "feature", "va", "cho", "cua", "voi", "the", "and", "for", "with", "co", "la", "mot"]);
const words = (t) => norm(t).split(/[^a-z0-9]+/).filter(Boolean);
const bare = (t) => String(t ?? "").replace(/\([^)]*\)/g, " ").replace(/^(công nghệ|tính năng|technology|feature)\s+/i, "").replace(/\s+/g, " ").trim();
const sigWords = (t) => words(bare(t)).filter((w) => (w.length >= 3 || /^[a-z]{2}$/.test(w) || /\d/.test(w)) && !STOP.has(w));

/**
 * Một kết quả tìm kiếm có xác nhận công nghệ này không. Trả về true khi (a) nhắc đúng cụm từ hoặc phần lớn các từ của nó,
 * hoặc (b) nhắc phần lớn ý của mô tả chức năng (benefit) kèm ít nhất một từ của tên; và luôn phải nằm trong ngữ cảnh nhóm sản phẩm.
 */
export function resultConfirms({ term, group = "", benefit = "" }, r) {
  const hay = " " + words(`${r.title ?? ""} ${r.snippet ?? ""}`).join(" ") + " ";
  const tw = sigWords(term);
  if (!tw.length) return false;
  const groupWords = words(group).filter((w) => w.length >= 3 && !STOP.has(w));
  if (groupWords.length && !groupWords.some((w) => hay.includes(" " + w + " ") || hay.includes(" " + w))) return false; // không đúng nhóm sản phẩm
  const phrase = " " + words(bare(term)).join(" ") + " ";
  const hit = tw.filter((w) => hay.includes(" " + w + " ") || (w.length >= 5 && hay.includes(" " + w)));
  const nameOk = hay.includes(phrase) || hit.length / tw.length >= (tw.length === 1 ? 1 : 0.75);
  if (nameOk) return true;
  const bw = sigWords(benefit);
  if (bw.length >= 3 && hit.length >= 1) {
    const bh = bw.filter((w) => hay.includes(" " + w));
    if (bh.length / bw.length >= 0.5) return true; // cùng chức năng dù gọi tên khác
  }
  return false;
}

/** Đánh giá một công nghệ từ danh sách kết quả tìm: { ok, hits, domains, evidence }. Đạt khi có ≥ 2 kết quả từ ≥ 2 website. */
export function judgeTech(spec, results = []) {
  const hits = (results ?? []).filter((r) => resultConfirms(spec, r));
  const domains = new Set(hits.map((r) => domainOf(r.url)));
  return { ok: hits.length >= 2 && domains.size >= 2, hits: hits.length, domains: domains.size, evidence: hits.slice(0, 3).map((r) => ({ url: r.url, title: clip(r.title ?? "", 100) })) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ghi kết quả kiểm tra vào entry: entry.techVerified[tên] và entry.techKeywords (chỉ các công nghệ đã đạt). */
export function recordTech(entry, term, verdict, query) {
  entry.techVerified ??= {};
  entry.techVerified[norm(bare(term))] = { name: term, ok: verdict.ok, hits: verdict.hits, domains: verdict.domains, evidence: verdict.evidence, q: query, ts: Date.now() };
  entry.techKeywords ??= [];
  const k = norm(bare(term));
  if (verdict.ok && !entry.techKeywords.some((x) => norm(bare(x)) === k)) entry.techKeywords.push(term);
}

/**
 * Kiểm tra các công nghệ chưa kiểm của entry bằng tìm kiếm. api.discover([query]) -> { results: [{url,title,snippet}] }.
 * typed: chuỗi người dùng gõ; group: nhóm sản phẩm. Trả về { checked, ok, failed }.
 */
export async function verifyEntryTech(entry, { api, typed = "", group = "", max = 5, gapMs = 700, signal, log = () => {} } = {}) {
  const out = { checked: 0, ok: 0, failed: 0 };
  if (!api?.discover) return out;
  const names = [...(entry.tech ?? []).map((t) => ({ name: t.name, benefit: t.benefit }))];
  const seen = new Set(Object.keys(entry.techVerified ?? {}));
  const todo = [];
  for (const t of names) {
    const k = norm(bare(t.name));
    if (!k || seen.has(k) || todo.some((x) => norm(bare(x.name)) === k)) continue;
    todo.push(t);
  }
  for (const [i, t] of todo.slice(0, max).entries()) {
    if (signal?.aborted) throw new DOMException("Đã dừng", "AbortError");
    const query = `${(typed || group).trim()} ${bare(t.name)}`.replace(/\s+/g, " ").trim();
    let res;
    try { res = await api.discover([query], signal); }
    catch (e) { if (e.name === "AbortError") throw e; out.failed++; log(`Kiểm tra công nghệ “${t.name}”: không tìm được (${e.message}), giữ trạng thái chưa kiểm chứng`); if (/chặn|xác minh/i.test(e.message)) break; continue; }
    const verdict = judgeTech({ term: t.name, group: group || typed, benefit: t.benefit }, res.results ?? []);
    recordTech(entry, t.name, verdict, query);
    out.checked++;
    if (verdict.ok) out.ok++;
    log(`Kiểm tra công nghệ “${t.name}”: ${verdict.ok ? `đạt (${verdict.hits} kết quả, ${verdict.domains} website nhắc đúng)` : `chưa kiểm chứng được (${verdict.hits} kết quả nhắc, cần ≥ 2 website)`}`);
    if (i < todo.length - 1 && gapMs) await sleep(gapMs);
  }
  return out;
}

/** Trạng thái một công nghệ: true (đã kiểm chứng), false (đã tìm nhưng không đạt), null (chưa kiểm). */
export function techStatus(entry, name) {
  const v = entry?.techVerified?.[norm(bare(name))];
  return v ? v.ok : null;
}
