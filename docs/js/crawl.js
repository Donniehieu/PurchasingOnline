// Crawl Google có nhịp: mỗi lệnh gửi xong và có phản hồi rồi mới chờ một khoảng (cấu hình được) rồi gửi lệnh tiếp theo,
// không dồn dập để tránh trang báo lỗi, bị chặn hoặc tải lỗi. Mỗi URL chỉ được mở MỘT lần cho cả yêu cầu: trang được xử lý
// ngay thành tài liệu trong kho (corpus.js); mọi câu hỏi sau đó khai thác kho, không mở lại trang.
import * as core from "./core.js";
import { Corpus, makeDoc } from "./corpus.js";
import * as net from "./net.js";

export const SKIP_DOMAINS = ["youtube.com", "facebook.com", "tiktok.com", "wikipedia.org", "pinterest.", "google.", "reddit.com", "instagram.com", "twitter.com", "x.com", "porn", "xxx", "xhamster", "sex", "baidu.com", "zhihu.com", "linkedin.com"];
// Các sàn vẽ giá bằng JavaScript: fetch chỉ ra khung rỗng nên phải để trình duyệt thật mở trang.
const RENDER_DOMAINS = ["shopee.vn", "tiki.vn", "lazada.vn", "tiktok.com", "sendo.vn"];
const SKIP_EXT = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|jpe?g|png|gif|webp|mp4|mp3)(\?|$)/i;

export class CancelledError extends Error { constructor() { super("Đã dừng theo yêu cầu"); this.name = "CancelledError"; } }

export class Crawler {
  /**
   * opts: getDelay() -> mili giây chờ giữa hai lệnh, isCancelled() -> bool, onEvent(ev) -> báo tiến trình,
   * corpus (kho dùng chung, mặc định tạo mới), serp(query, page) và loadHtml(url) (thay thế khi kiểm thử).
   */
  constructor({ getDelay, isCancelled, onEvent, corpus, serp, loadHtml }) {
    this.getDelay = getDelay; this.isCancelled = isCancelled || (() => false); this.onEvent = onEvent || (() => {});
    this.corpus = corpus || new Corpus(); this.injected = !!(serp || loadHtml); // bản thay thế khi kiểm thử không cần tiện ích
    this.serp = serp || net.serpPage; this.loadHtml = loadHtml || ((url) => this.defaultLoad(url));
    this.fetched = 0; this.reused = 0; this.searches = 0; this.failed = new Set(); this.queries = []; this.errors = [];
  }
  check() { if (this.isCancelled()) throw new CancelledError(); }
  /** Chờ giữa hai lệnh (±25% ngẫu nhiên), kiểm tra yêu cầu dừng mỗi 250ms. */
  async wait(factor = 1) {
    const total = Math.max(0, this.getDelay() * factor * (0.75 + Math.random() * 0.5));
    for (let t = 0; t < total; t += 250) { this.check(); await net.sleep(Math.min(250, total - t)); }
  }

  /** Tải HTML một trang. Tiện ích: fetch trực tiếp, trang cần JavaScript hoặc fetch lỗi thì mở tab nền. */
  async defaultLoad(url) {
    if (!net.isExt) throw new Error(net.EXT_ONLY);
    if (!RENDER_DOMAINS.some((d) => core.domainOf(url).endsWith(d))) {
      try {
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
        const r = await fetch(url, { signal: ctl.signal }); clearTimeout(timer);
        if (r.ok && /html|xml/i.test(r.headers.get("content-type") || "html")) { const t = await r.text(); if (t.length > 2000) return t; }
      } catch { /* mở tab nền */ }
    }
    return (await net.renderPage(url, "html")).html;
  }

  /** Mở một URL nếu chưa có trong kho. Trả về { doc, fresh }: fresh = true khi vừa phải mở trang (cần chờ trước lệnh kế). */
  async visitInfo(url) {
    this.check();
    const have = this.corpus.get(url);
    if (have && !have.pseudo) { this.reused++; return { doc: have, fresh: false }; }
    if (this.failed.has(url)) return { doc: null, fresh: false };
    let doc = null;
    try { doc = makeDoc({ url, html: await this.loadHtml(url) }); } catch (e) { if (e instanceof CancelledError) throw e; doc = null; }
    if (!doc) { this.failed.add(url); return { doc: null, fresh: false }; } // trang hỏng: bỏ qua ngay, không chờ, không thử lại
    this.fetched++; this.corpus.add(doc); return { doc, fresh: true };
  }
  async visit(url) { return (await this.visitInfo(url)).doc; }

  /** Mở lần lượt các link (2 luồng): xong một trang có phản hồi rồi mới chờ `delay` và mở trang kế. Trang đã có trong kho không cần chờ. */
  async readLinks(items, label = "") {
    const out = new Array(items.length); let next = 0, done = 0;
    const worker = async () => {
      while (next < items.length) {
        this.check();
        const i = next++, it = items[i];
        const { doc, fresh } = await this.visitInfo(it.url);
        out[i] = doc; done++;
        this.onEvent({ kind: "read", label, done, total: items.length, url: it.url, ok: !!doc, reused: !fresh });
        if (fresh && next < items.length) await this.wait();
      }
    };
    const todo = items.filter((it) => { const d = this.corpus.get(it.url); return !d || d.pseudo; }).length; // trang đã có trong kho không cần luồng thứ hai
    await Promise.all([worker(), todo > 1 ? (async () => { await net.sleep(Math.min(800, this.getDelay() / 2)); await worker(); })() : Promise.resolve()]);
    return out.filter(Boolean);
  }

  /**
   * Danh sách bài viết ứng viên cho một từ khóa (VD "ưu nhược điểm máy hút bụi cầm tay"), lấy lười từng trang kết quả Google:
   * trang 2 chỉ được tải khi người gọi đã dùng hết các bài của trang 1 mà vẫn cần thêm. Bỏ qua bài đã mở (đã có trong kho),
   * bài đã lỗi, website không phải bài viết/NCC, và quá `perDomain` bài cùng một website. Dùng: for await (const r of crawler.candidates(q, 3)) {...}
   */
  async *candidates(query, pages, { perDomain = 2, label = "" } = {}) {
    if (!this.queries.includes(query)) this.queries.push(query);
    this.searches++;
    const seen = new Set(), domainCount = new Map();
    for (let p = 1; p <= pages; p++) {
      this.check();
      if (p > 1) await this.wait();
      this.onEvent({ kind: "serp", label, query, page: p, pages, state: "start" });
      let res;
      try { res = await this.serp(query, p); }
      catch (e) { if (e instanceof CancelledError) throw e; this.errors.push(`"${query}" trang ${p}: ${e.message}`); this.onEvent({ kind: "serp", label, query, page: p, pages, state: "error", message: e.message }); return; }
      const fresh = res.results.filter((r) => !seen.has(r.url));
      if (!fresh.length) { this.onEvent({ kind: "serp", label, query, page: p, pages, state: "end" }); return; }
      fresh.forEach((r) => seen.add(r.url));
      this.onEvent({ kind: "serp", label, query, page: p, pages, state: "results", n: fresh.length });
      await this.wait(); // chờ sau khi tải kết quả rồi mới mở bài đầu tiên
      for (const r of fresh) {
        const d = core.domainOf(r.url), have = this.corpus.get(r.url);
        if (!d || SKIP_DOMAINS.some((x) => d.includes(x)) || SKIP_EXT.test(r.url)) continue;
        if ((have && !have.pseudo) || this.failed.has(r.url)) continue; // đã mở hoặc đã lỗi: không mở lại
        const c = domainCount.get(d) || 0; if (c >= perDomain) continue; domainCount.set(d, c + 1);
        yield r;
      }
    }
  }

  /**
   * Tìm trên Google `pages` trang kết quả (1-5). Mỗi trang: lấy kết quả rồi MỞ HẾT các link của trang đó (link đã đọc thì dùng lại),
   * xong mới chờ rồi sang trang kế. Không còn kết quả mới thì dừng sớm.
   * Trả về { items (mọi kết quả), read (tài liệu của các trang đã mở), pagesDone, errors }.
   */
  async google(query, pages, { read = true, perDomain = 2, label = "" } = {}) {
    if (!this.queries.includes(query)) this.queries.push(query);
    this.searches++;
    const items = [], readDocs = [], errors = [], seen = new Set(), domainCount = new Map();
    let pagesDone = 0;
    for (let p = 1; p <= pages; p++) {
      this.check();
      if (p > 1) await this.wait();
      this.onEvent({ kind: "serp", label, query, page: p, pages, state: "start" });
      let res;
      try { res = await this.serp(query, p); }
      catch (e) { if (e instanceof CancelledError) throw e; errors.push(`trang ${p}: ${e.message}`); this.onEvent({ kind: "serp", label, query, page: p, pages, state: "error", message: e.message }); break; }
      const fresh = res.results.filter((r) => !seen.has(r.url));
      if (!fresh.length) { this.onEvent({ kind: "serp", label, query, page: p, pages, state: "end" }); break; }
      fresh.forEach((r) => { seen.add(r.url); items.push({ ...r, page: p }); });
      pagesDone++;
      this.onEvent({ kind: "serp", label, query, page: p, pages, state: "results", n: fresh.length });
      if (read) {
        const links = fresh.filter((r) => {
          const d = core.domainOf(r.url);
          if (!d || SKIP_DOMAINS.some((s) => d.includes(s)) || SKIP_EXT.test(r.url)) return false;
          const c = domainCount.get(d) || 0; if (c >= perDomain) return false; domainCount.set(d, c + 1); return true;
        });
        await this.wait();
        readDocs.push(...(await this.readLinks(links, `${label} trang ${p}`.trim())));
      }
      this.onEvent({ kind: "serp", label, query, page: p, pages, state: "done" });
    }
    return { items, read: readDocs, pagesDone, errors };
  }
}

/** Các kết quả không mở được vẫn góp tiêu đề và mô tả trong kết quả tìm kiếm: trả về các tài liệu "giả" (pseudo) để thêm vào kho. */
const escHtml = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export function pseudoDocs(items, skip = new Set()) {
  return items.filter((i) => !skip.has(i.url)).map((i) => makeDoc({ url: i.url, pseudo: true, html: `<html><head><title>${escHtml(i.title)}</title></head><body><p>${escHtml(i.title)}. ${escHtml(i.snippet)}</p></body></html>` })).filter(Boolean);
}

/* ------------------------------------------------------------------ đọc ảnh: tên sản phẩm, model, chữ trong ảnh */
const fileToImage = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader(); fr.onerror = reject;
  fr.onload = () => resolve({ name: file.name, mime: file.type || "image/jpeg", b64: String(fr.result).split(",")[1] });
  fr.readAsDataURL(file);
});
/** Nhờ Claude đọc ảnh (cần khóa Anthropic): trả về { keyword, text } = tên sản phẩm nhìn thấy và chữ đọc được trong ảnh. */
async function askClaude(images, key) {
  const content = images.slice(0, 4).map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.b64 } }));
  content.push({ type: "text", text: 'Đây là ảnh một sản phẩm cần mua. Trả về đúng một đối tượng JSON, không giải thích thêm, dạng {"keyword": "...", "text": "..."}. "keyword" là một dòng tiếng Việt ngắn làm từ khóa tìm kiếm (loại sản phẩm, hãng và model nếu nhìn thấy). "text" là toàn bộ chữ đọc được trong ảnh (tên hãng, model, thông số), để trống nếu không có chữ.' });
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), 60000);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: ctl.signal,
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 400, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error(`Anthropic trả HTTP ${r.status}${r.status === 401 ? " (khóa không đúng)" : ""}`);
  const text = ((await r.json()).content || []).map((b) => b.text || "").join("");
  const m = /\{[\s\S]*\}/.exec(text); let data = {}; try { data = m ? JSON.parse(m[0]) : {}; } catch { /* bỏ qua */ }
  return { keyword: String(data.keyword || "").trim(), text: String(data.text || "").trim() };
}
/** Trình duyệt có sẵn bộ đọc chữ (TextDetector, chỉ một số trình duyệt bật): dùng làm phương án không cần khóa. */
async function detectText(files) {
  if (!("TextDetector" in globalThis)) return "";
  const det = new globalThis.TextDetector(), parts = [];
  for (const f of files.slice(0, 4)) { try { const bmp = await createImageBitmap(f); for (const b of await det.detect(bmp)) parts.push(b.rawValue); bmp.close(); } catch { /* bỏ qua */ } }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
/**
 * Đọc ảnh người dùng cung cấp. Có khóa Anthropic: lấy tên sản phẩm và chữ trong ảnh. Không có khóa: thử bộ đọc chữ của trình duyệt.
 * Trả về { keyword, text, model, via } (via = "claude" | "browser" | "none").
 */
export async function readImages(files, anthropicKey) {
  let keyword = "", text = "", via = "none", error = "";
  if (anthropicKey) { try { ({ keyword, text } = await askClaude(await Promise.all(files.map(fileToImage)), anthropicKey)); via = "claude"; } catch (e) { error = e.message; } }
  if (!text && !keyword) { const t = await detectText(files); if (t) { text = t; via = "browser"; } }
  const models = core.titleModels(`${keyword} ${text}`.toUpperCase().replace(/[^A-Z0-9 -]/g, " "));
  return { keyword, text, model: models[0] || "", via, error };
}
