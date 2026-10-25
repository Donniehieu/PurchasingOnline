// Kho đáp án tích lũy theo từng câu hỏi. Mỗi bài viết được mở ra MỘT lần và được chấm cho TẤT CẢ câu hỏi cùng lúc: đáp án
// tìm được được bổ sung đúng vào block của từng câu hỏi. Đáp án đã lưu từ các bài cũ không bao giờ bị xóa hay thay thế;
// bài mới chỉ thêm đáp án (không trùng) cho tới giới hạn mỗi câu hỏi.
import { normKey, phraseRelevance, priceSummary } from "./core.js";
import { asDoc } from "./corpus.js";
import * as knowledge from "./knowledge.js";

export const CAP_PER_QUESTION = 12; // số đáp án tối đa mỗi câu hỏi
export const MIN_ANSWERS = 3;       // đủ đáp án = ít nhất 3 câu từ 2 bài khác nhau (hoặc từ 5 câu), khi đó không cần tìm thêm
const PER_DOC = 2;                  // mỗi bài đóng góp tối đa 2 câu cho một câu hỏi

/** Từ khóa Google tìm bài cho từng câu hỏi: "<từ khóa câu hỏi> <tên sản phẩm>", VD "ưu nhược điểm máy hút bụi cầm tay". */
export const searchKey = (entry, product) => `${entry.kind === "topic" ? entry.key : entry.question} ${product}`.trim();

export class AnswerStore {
  /** product: tên sản phẩm (+ model); queryTokens: từ khóa kiểm tra bài đúng sản phẩm; topicIds: các chủ đề; questions: câu hỏi gõ thêm. */
  constructor({ product = "", queryTokens = [], topicIds = [], questions = [] } = {}) {
    this.product = product; this.tokens = queryTokens; this.entries = new Map(); this.scanned = new Set(); this.seq = 0;
    for (const id of topicIds) this.addTopic(id);
    for (const q of questions) this.addCustom(q);
  }
  addTopic(id) {
    const bank = knowledge.topicBanks([id])[0]; if (!bank || this.entries.has(id)) return null;
    const def = knowledge.TOPIC_DEFS.find((t) => t.id === id) || {};
    const e = { kind: "topic", id, bank, label: def.label || bank.label, key: def.key || bank.label, items: [] }; this.entries.set(id, e); return e;
  }
  /** Thêm câu hỏi gõ thêm. docs (tài liệu đã đọc) được chấm ngay cho câu hỏi mới để trả lời từ những gì đã có. */
  addCustom(question, docs = []) {
    const id = `c:${question}`; if (this.entries.has(id)) return this.entries.get(id);
    const [spec] = knowledge.makeCustomSpecs([question], this.tokens);
    const e = { kind: "custom", id, question, label: question, qTokens: spec.qTokens, need: spec.need, items: [] }; this.entries.set(id, e);
    for (const raw of docs) { const d = asDoc(raw); if (d) this.#scan(d, [e]); }
    return e;
  }
  /** Chấm một tài liệu cho các câu hỏi `list`, bổ sung đáp án mới. Trả về số đáp án thêm mới. */
  #scan(d, list) {
    const rel = phraseRelevance(this.tokens, d.norm); if (rel < 0.5) return 0;
    const tspecs = list.filter((e) => e.kind === "topic").map((e) => ({ q: e.bank, cands: [], e }));
    const cspecs = list.filter((e) => e.kind === "custom").map((e) => ({ question: e.question, qTokens: e.qTokens, need: e.need, cands: [], e }));
    knowledge.scoreDoc(d, rel, tspecs, cspecs, this.tokens, []);
    let added = 0;
    for (const sp of [...tspecs, ...cspecs]) {
      const have = new Set(sp.e.items.map((it) => normKey(it.text).slice(0, 60)));
      for (const c of knowledge.pickSnippets(sp.cands, PER_DOC, PER_DOC)) {
        if (sp.e.items.length >= CAP_PER_QUESTION) break;
        const key = normKey(c.text).slice(0, 60); if (have.has(key)) continue;
        have.add(key); sp.e.items.push({ text: c.text, url: c.url, score: c.score, seq: this.seq++ }); added++;
      }
    }
    return added;
  }
  /** Chấm một bài mới cho TẤT CẢ câu hỏi. Mỗi URL chỉ chấm một lần. Trả về số đáp án thêm mới (cộng mọi câu hỏi). */
  ingest(raw) {
    const d = asDoc(raw); if (!d || this.scanned.has(d.url)) return 0;
    this.scanned.add(d.url);
    return this.#scan(d, [...this.entries.values()]);
  }
  list() { return [...this.entries.values()]; }
  get(id) { return this.entries.get(id) || null; }
  pages(e) { return new Set(e.items.map((i) => i.url)).size; }
  /** Đủ đáp án để không cần tìm thêm bài. */
  enough(e) { const n = e.items.length; return n >= 5 || (n >= MIN_ANSWERS && this.pages(e) >= 2); }
  /** Các đáp án của một câu hỏi, điểm cao trước; bài cũ vẫn giữ nguyên. */
  snippets(e) { return [...e.items].sort((a, b) => b.score - a.score || a.seq - b.seq).map(({ text, url }) => ({ text, url })); }

  /** Dạng kết quả cho giao diện: chủ đề (có khoảng giá từ giá từng trang) và câu hỏi gõ thêm. */
  topicsOut(docs = []) {
    const out = {};
    for (const e of this.list().filter((x) => x.kind === "topic")) {
      const snippets = this.snippets(e);
      const entry = { label: e.label, group: e.bank.group, group_label: knowledge.GROUPS[e.bank.group], query: e.bank.ask(this.product), snippets, pages: this.pages(e) };
      if (e.bank.kind === "price") {
        const ps = priceSummary(docs.map(asDoc).filter(Boolean)), v = [...ps.values].sort((a, b) => a - b);
        if (v.length) entry.price = { min: v[0], max: v.at(-1), median: v[Math.floor((v.length - 1) / 2)], count: v.length, confident: ps.sure };
      }
      out[e.id] = entry;
    }
    return out;
  }
  customOut() { return this.list().filter((x) => x.kind === "custom").map((e) => ({ question: e.question, snippets: this.snippets(e), pages: this.pages(e) })); }

  toJSON() { return { v: 1, seq: this.seq, scanned: [...this.scanned], entries: this.list().map((e) => ({ kind: e.kind, id: e.id, question: e.question, items: e.items })) }; }
  static fromJSON(o, opts) {
    const s = new AnswerStore(opts); s.seq = o.seq || 0; s.scanned = new Set(o.scanned || []);
    for (const r of o.entries || []) { const e = r.kind === "topic" ? s.addTopic(r.id) || s.get(r.id) : s.addCustom(r.question); if (e) e.items = r.items || []; }
    return s;
  }
}
