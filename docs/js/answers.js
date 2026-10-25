// Kho đáp án tích lũy theo từng câu hỏi. Mỗi bài viết được mở ra MỘT lần và được chấm cho TẤT CẢ câu hỏi cùng lúc: đáp án
// tìm được được bổ sung đúng vào block của từng câu hỏi. Đáp án đã lưu từ các bài cũ không bao giờ bị xóa hay thay thế;
// bài mới chỉ thêm đáp án (không trùng) cho tới giới hạn mỗi câu hỏi.
//
// Đúng sản phẩm: khi đã có model (VD SHD4080), chỉ bài nhắc tới model đó mới cho đáp án "đúng model"; câu nhắc một model khác bị loại;
// đáp án từ bài chỉ nói về loại sản phẩm nói chung được tách riêng ("tham khảo chung") và không tính là đủ đáp án.
// Chữ lặp lại ở từ 3 bài trở lên (menu, chân trang) không được dùng làm đáp án.
import { normKey, phraseRelevance, priceSummary } from "./core.js";
import { asDoc } from "./corpus.js";
import * as knowledge from "./knowledge.js";

export const CAP_PER_QUESTION = 12; // số đáp án tối đa mỗi câu hỏi (mỗi nhóm)
export const MIN_ANSWERS = 3;       // đủ đáp án = ít nhất 3 câu từ 2 bài khác nhau (hoặc từ 5 câu), khi đó không cần tìm thêm
const PER_DOC = 2;                  // mỗi bài đóng góp tối đa 2 câu cho một câu hỏi
const REPEAT_LIMIT = 3;             // câu xuất hiện ở từ 3 bài trở lên coi là chữ lặp của website (menu, chân trang)

/** Từ khóa Google tìm bài cho từng câu hỏi: "<từ khóa câu hỏi> <tên sản phẩm>", VD "ưu nhược điểm máy hút bụi cầm tay". */
export const searchKey = (entry, product) => `${entry.kind === "topic" ? entry.key : entry.question} ${product}`.trim();
const sentKey = (t) => normKey(t).slice(0, 80);

export class AnswerStore {
  /** product: tên sản phẩm; code: model (có thì lọc đúng model); queryTokens: từ khóa kiểm tra bài đúng sản phẩm; topicIds, questions. */
  constructor({ product = "", code = "", queryTokens = [], topicIds = [], questions = [] } = {}) {
    this.product = product; this.code = code; this.model = knowledge.modelMatcher(code); this.tokens = queryTokens;
    this.entries = new Map(); this.scanned = new Set(); this.counted = new Set(); this.repeat = new Map(); this.seq = 0;
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
  /** Đếm câu của một tài liệu để nhận ra chữ lặp lại nhiều bài (menu, chân trang). Gọi cho cả kho trước khi chấm sẽ chính xác hơn. */
  prime(docs) {
    for (const raw of docs) {
      const d = asDoc(raw); if (!d || this.counted.has(d.url)) continue; this.counted.add(d.url);
      for (const k of new Set(d.sentences.map((s) => sentKey(s.t)))) this.repeat.set(k, (this.repeat.get(k) || 0) + 1);
    }
  }
  /** Chấm một tài liệu cho các câu hỏi `list`, bổ sung đáp án mới. Trả về số đáp án thêm mới. */
  #scan(d, list) {
    const rel = phraseRelevance(this.tokens, d.norm); if (rel < 0.5) return 0;
    const tier = !this.model || this.model.re.test(d.norm) ? "model" : "type"; // bài có nhắc đúng model hay chỉ nói về loại sản phẩm
    const tspecs = list.filter((e) => e.kind === "topic").map((e) => ({ q: e.bank, cands: [], e }));
    const cspecs = list.filter((e) => e.kind === "custom").map((e) => ({ question: e.question, qTokens: e.qTokens, need: e.need, cands: [], e }));
    knowledge.scoreDoc(d, rel, tspecs, cspecs, this.tokens, [], this.model);
    let added = 0;
    for (const sp of [...tspecs, ...cspecs]) {
      const have = new Set(sp.e.items.map((it) => sentKey(it.text)));
      const cands = sp.cands.filter((c) => (this.repeat.get(sentKey(c.text)) || 0) < REPEAT_LIMIT);
      for (const c of knowledge.pickSnippets(cands, PER_DOC, PER_DOC)) {
        if (sp.e.items.filter((it) => it.tier === tier).length >= CAP_PER_QUESTION) break;
        const key = sentKey(c.text); if (have.has(key)) continue;
        have.add(key); sp.e.items.push({ text: c.text, url: c.url, score: c.score, seq: this.seq++, tier }); added++;
      }
    }
    return added;
  }
  /** Chấm một bài mới cho TẤT CẢ câu hỏi. Mỗi URL chỉ chấm một lần. Trả về số đáp án thêm mới (cộng mọi câu hỏi). */
  ingest(raw) {
    const d = asDoc(raw); if (!d || this.scanned.has(d.url)) return 0;
    this.scanned.add(d.url); this.prime([d]);
    return this.#scan(d, [...this.entries.values()]);
  }
  list() { return [...this.entries.values()]; }
  get(id) { return this.entries.get(id) || null; }
  /** Đáp án đúng sản phẩm/model của một câu hỏi (tier "model"; đáp án cũ chưa có tier coi là đúng model). */
  main(e) { return e.items.filter((i) => i.tier !== "type"); }
  /** Đáp án chỉ nói về loại sản phẩm nói chung (bài không nhắc đúng model). */
  general(e) { return e.items.filter((i) => i.tier === "type"); }
  pages(e) { return new Set(this.main(e).map((i) => i.url)).size; }
  /** Đủ đáp án ĐÚNG MODEL để không cần tìm thêm bài (đáp án chung không tính). */
  enough(e) { const n = this.main(e).length; return n >= 5 || (n >= MIN_ANSWERS && this.pages(e) >= 2); }
  /** Đáp án đúng model, điểm cao trước; bài cũ vẫn giữ nguyên. */
  snippets(e) { return [...this.main(e)].sort((a, b) => b.score - a.score || a.seq - b.seq).map(({ text, url }) => ({ text, url })); }
  generalSnippets(e) { return [...this.general(e)].sort((a, b) => b.score - a.score || a.seq - b.seq).slice(0, 6).map(({ text, url }) => ({ text, url })); }

  /** Dạng kết quả cho giao diện: chủ đề (có khoảng giá từ giá từng trang) và câu hỏi gõ thêm. */
  topicsOut(docs = []) {
    const out = {};
    for (const e of this.list().filter((x) => x.kind === "topic")) {
      const entry = { label: e.label, group: e.bank.group, group_label: knowledge.GROUPS[e.bank.group], query: e.bank.ask(this.product), snippets: this.snippets(e), general: this.generalSnippets(e), pages: this.pages(e) };
      if (e.bank.kind === "price") {
        const ps = priceSummary(docs.map(asDoc).filter(Boolean)), v = [...ps.values].sort((a, b) => a - b);
        if (v.length) entry.price = { min: v[0], max: v.at(-1), median: v[Math.floor((v.length - 1) / 2)], count: v.length, confident: ps.sure };
      }
      out[e.id] = entry;
    }
    return out;
  }
  customOut() { return this.list().filter((x) => x.kind === "custom").map((e) => ({ question: e.question, snippets: this.snippets(e), general: this.generalSnippets(e), pages: this.pages(e) })); }

  toJSON() { return { v: 2, seq: this.seq, scanned: [...this.scanned], entries: this.list().map((e) => ({ kind: e.kind, id: e.id, question: e.question, items: e.items })) }; }
  static fromJSON(o, opts) {
    const s = new AnswerStore(opts); s.seq = o.seq || 0; s.scanned = new Set(o.scanned || []);
    for (const r of o.entries || []) { const e = r.kind === "topic" ? s.addTopic(r.id) || s.get(r.id) : s.addCustom(r.question); if (e) e.items = r.items || []; }
    return s;
  }
}
