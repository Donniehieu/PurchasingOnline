// Crawl Google có nhịp: mỗi lệnh gửi xong và có phản hồi rồi mới chờ một khoảng (cấu hình được) rồi gửi lệnh tiếp theo,
// không dồn dập để tránh trang báo lỗi, bị chặn hoặc tải lỗi.
import * as core from "./core.js";
import * as net from "./net.js";

export const SKIP_DOMAINS = ["youtube.com", "facebook.com", "tiktok.com", "wikipedia.org", "pinterest.", "google.", "reddit.com", "instagram.com", "twitter.com", "x.com", "porn", "xxx", "xhamster", "sex", "baidu.com", "zhihu.com", "linkedin.com"];
// Các sàn vẽ giá bằng JavaScript: fetch chỉ ra khung rỗng nên phải để trình duyệt thật mở trang.
const RENDER_DOMAINS = ["shopee.vn", "tiki.vn", "lazada.vn", "tiktok.com", "sendo.vn"];
const SKIP_EXT = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|jpe?g|png|gif|webp|mp4|mp3)(\?|$)/i;

export class CancelledError extends Error { constructor() { super("Đã dừng theo yêu cầu"); this.name = "CancelledError"; } }

export class Crawler {
  /** opts: getDelay() -> mili giây chờ giữa hai lệnh, isCancelled() -> bool, onEvent(ev) -> báo tiến trình cho giao diện. */
  constructor({ getDelay, isCancelled, onEvent }) {
    this.getDelay = getDelay; this.isCancelled = isCancelled || (() => false); this.onEvent = onEvent || (() => {});
    this.cache = new Map(); this.readCount = 0; this.queries = []; // các từ khóa đã gửi lên Google
  }
  check() { if (this.isCancelled()) throw new CancelledError(); }
  /** Chờ giữa hai lệnh (±25% ngẫu nhiên), kiểm tra yêu cầu dừng mỗi 250ms. */
  async wait(factor = 1) {
    const total = Math.max(0, this.getDelay() * factor * (0.75 + Math.random() * 0.5));
    for (let t = 0; t < total; t += 250) { this.check(); await net.sleep(Math.min(250, total - t)); }
  }

  /** Tải HTML một trang. Tiện ích: fetch trực tiếp, trang cần JavaScript hoặc fetch lỗi thì mở tab nền. Có bộ nhớ tạm trong phiên. */
  async fetchHtml(url) {
    this.check();
    if (this.cache.has(url)) return this.cache.get(url);
    if (!net.isExt) throw new Error(net.EXT_ONLY);
    let html = null;
    if (!RENDER_DOMAINS.some((d) => core.domainOf(url).endsWith(d))) {
      try {
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
        const r = await fetch(url, { signal: ctl.signal }); clearTimeout(timer);
        if (r.ok && /html|xml/i.test(r.headers.get("content-type") || "html")) { const t = await r.text(); if (t.length > 2000) html = t; }
      } catch { /* mở tab nền */ }
    }
    if (html == null) html = (await net.renderPage(url, "html")).html;
    if (this.cache.size >= 80) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(url, html);
    return html;
  }

  /** Mở lần lượt các link (2 luồng), mỗi luồng gửi xong có phản hồi rồi mới chờ `delay` và gửi link kế tiếp. */
  async readLinks(items, label = "") {
    const out = new Array(items.length); let next = 0, done = 0;
    const worker = async () => {
      while (next < items.length) {
        this.check();
        const i = next++, it = items[i];
        try { out[i] = { url: it.url, title: it.title || "", snippet: it.snippet || "", html: await this.fetchHtml(it.url) }; }
        catch (e) { if (e instanceof CancelledError) throw e; out[i] = null; }
        this.readCount++; done++;
        this.onEvent({ kind: "read", label, done, total: items.length, url: it.url, ok: !!out[i] });
        if (next < items.length) await this.wait();
      }
    };
    await Promise.all([worker(), (async () => { await net.sleep(Math.min(800, this.getDelay() / 2)); await worker(); })()]);
    return out.filter(Boolean);
  }

  /**
   * Tìm trên Google `pages` trang kết quả (1-5). Mỗi trang: lấy kết quả rồi MỞ HẾT các link của trang đó để đọc,
   * xong mới chờ rồi sang trang kế. Không còn kết quả mới thì dừng sớm.
   * Trả về { items (mọi kết quả), read (các trang đã đọc, có html), pagesDone, errors }.
   */
  async google(query, pages, { read = true, perDomain = 2, label = "" } = {}) {
    if (!this.queries.includes(query)) this.queries.push(query);
    const items = [], readPages = [], errors = [], seen = new Set(), domainCount = new Map();
    let pagesDone = 0;
    for (let p = 1; p <= pages; p++) {
      this.check();
      if (p > 1) await this.wait();
      this.onEvent({ kind: "serp", label, query, page: p, pages, state: "start" });
      let res;
      try { res = await net.serpPage(query, p); }
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
        readPages.push(...(await this.readLinks(links, `${label} trang ${p}`.trim())));
      }
      this.onEvent({ kind: "serp", label, query, page: p, pages, state: "done" });
    }
    return { items, read: readPages, pagesDone, errors };
  }
}

/** Các kết quả không mở được vẫn góp tiêu đề và mô tả trong kết quả tìm kiếm (trang giả). */
const escHtml = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export function pseudoPages(items, readUrls = new Set()) {
  return items.filter((i) => !readUrls.has(i.url)).map((i) => ({ url: i.url, pseudo: true, html: `<html><head><title>${escHtml(i.title)}</title></head><body><p>${escHtml(i.title)}. ${escHtml(i.snippet)}</p></body></html>` }));
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
