// Lớp mạng phụ thuộc môi trường. Khi chạy như tiện ích trình duyệt (isExt) thì được phép tải mọi website
// mà không bị chặn CORS, và có thể nhờ trình duyệt thật đọc những trang cần JavaScript.
// Chạy như trang web thường (GitHub Pages) thì các hàm này báo lỗi rõ ràng.
//
// "Trang" trong tìm kiếm = TRANG KẾT QUẢ của engine (trang 1, 2, 3... như thanh phân trang cuối kết quả), không phải số link.

const api = globalThis.chrome || globalThis.browser;
export const isExt = typeof api !== "undefined" && !!(api.runtime && api.runtime.id);
const PROTO = 2; // phải khớp background.js
const STALE_WORKER = "Tiện ích đang chạy bản cũ. Mở trang extensions của trình duyệt (chrome://extensions, coccoc://extensions, brave://extensions), bấm nút tải lại (biểu tượng vòng tròn) ở tiện ích \"Mua hàng tự động\", rồi mở lại app.";
const EXT_ONLY = "Chức năng này chỉ chạy khi cài làm tiện ích Chrome/Cốc Cốc/Brave/Edge (xem README)";

/** Kiểm tra service worker của tiện ích đã là bản mới chưa. Trả về { ok, message }. */
export async function checkWorker() {
  if (!isExt) return { ok: true };
  try { const r = await api.runtime.sendMessage({ type: "ping" }); return r && r.proto === PROTO ? { ok: true } : { ok: false, message: STALE_WORKER }; }
  catch { return { ok: false, message: STALE_WORKER }; }
}

let active = 0; const waiting = [];
async function slot() { if (active >= 2) await new Promise((r) => waiting.push(r)); active++; }
function release() { active--; const next = waiting.shift(); if (next) next(); }

/** Nhờ trình duyệt mở trang thật. mode: html | links | serp (kết quả tìm kiếm) | images (kết quả hình ảnh). */
export async function renderPage(url, mode = "html") {
  if (!isExt) throw new Error(EXT_ONLY);
  await slot();
  try {
    const res = await api.runtime.sendMessage({ type: "render", url, mode });
    if (res && res.ok && res.proto !== PROTO) throw new Error(STALE_WORKER);
    if (!res || !res.ok) throw new Error((res && res.error) || "Không mở được trang");
    return res.data;
  } finally { release(); }
}

function timeout(ms = 15000) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }
const enc = encodeURIComponent;

/* ---------------- tìm web theo từng trang kết quả ---------------- */
const BLOCKED = /sorry|unusual traffic|captcha|verify you|xác minh|are you a robot|access denied/i;

/** Mỗi engine: cách dựng URL của trang kết quả thứ p (bắt đầu từ 1). */
export const ENGINE_PAGES = {
  googleweb: { label: "Google", url: (q, p) => `https://www.google.com/search?q=${enc(q)}&hl=vi&gl=vn&num=10&start=${(p - 1) * 10}&pws=0` },
  coccoc: { label: "Cốc Cốc", url: (q, p) => `https://coccoc.com/search?query=${enc(q)}${p > 1 ? `&page=${p}` : ""}` },
  bing: { label: "Bing", url: (q, p) => `https://www.bing.com/search?q=${enc(q)}&setlang=vi&cc=VN&first=${(p - 1) * 10 + 1}` },
  bravesearch: { label: "Brave Search", url: (q, p) => `https://search.brave.com/search?q=${enc(q)}&source=web&offset=${p - 1}` },
};

/** Giải link bọc chuyển hướng của engine về link đích. Trả về chuỗi rỗng nếu không giải được. */
export async function resolveUrl(href) {
  let u; try { u = new URL(href); } catch { return ""; }
  const host = u.hostname.replace(/^www\./, "");
  if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname === "/url") return u.searchParams.get("q") || u.searchParams.get("url") || "";
  if (host === "duckduckgo.com" && u.searchParams.get("uddg")) return u.searchParams.get("uddg");
  if (/bing\.com$/.test(host) && u.pathname.startsWith("/ck/a")) {
    let t = u.searchParams.get("u") || ""; if (t.startsWith("a1")) t = t.slice(2);
    try { t = t.replace(/-/g, "+").replace(/_/g, "/"); return atob(t + "=".repeat((4 - (t.length % 4)) % 4)); } catch { return ""; }
  }
  if (/coccoc\.com$/.test(host) && u.pathname.includes("/composer/goto")) {
    try { // trình duyệt theo chuyển hướng giúp ta, lấy địa chỉ cuối rồi bỏ phần thân trang
      const r = await fetch(href, { signal: timeout(12000) });
      const final = r.url; try { r.body && r.body.cancel(); } catch { /* bỏ qua */ }
      return /(^|\.)coccoc\.com$/.test(new URL(final).hostname) ? "" : final;
    } catch { return ""; }
  }
  return /(^|\.)(google|bing|coccoc|duckduckgo|brave)\.[a-z.]+$/.test(host) ? "" : href;
}

async function resolveAll(results) {
  const out = []; let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < results.length) {
      const r = results[next++];
      let url = await resolveUrl(r.url);
      if (!/^https?:\/\//i.test(url)) { // không theo được chuyển hướng: dùng tên miền hiển thị trong kết quả ("Tên https://domain › đường dẫn")
        const shown = /(https?:\/\/[^\s›…]+)/.exec(`${r.title} ${r.snippet}`);
        try { url = shown ? new URL(shown[1]).origin : ""; } catch { url = ""; }
      }
      if (/^https?:\/\//i.test(url)) out.push({ ...r, url });
    }
  }));
  return out;
}

/** Lấy một trang kết quả của engine chạy qua trình duyệt. Trả về { results: [{url,title,snippet}], blocked }. */
export async function serpPage(engine, query, page) {
  const def = ENGINE_PAGES[engine]; if (!def) throw new Error(`Engine không hỗ trợ: ${engine}`);
  const data = await renderPage(def.url(query, page), "serp");
  if (!data.results.length && BLOCKED.test(data.title || "")) throw new Error(`${def.label} yêu cầu xác minh. Hãy mở ${def.label} trong trình duyệt, xác minh rồi thử lại (app không vượt qua bước này)`);
  return { results: await resolveAll(data.results), raw: data.results.length };
}

/** DuckDuckGo bản HTML: fetch trực tiếp, mỗi trang khoảng 30 kết quả. */
export async function duckduckgoPage(query, page) {
  if (!isExt) throw new Error(EXT_ONLY);
  const off = (page - 1) * 30;
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${enc(query)}&kl=vn-vi${off ? `&s=${off}&dc=${off + 1}` : ""}`, { signal: timeout() });
  if (!r.ok) throw new Error(`DuckDuckGo trả HTTP ${r.status}`);
  const doc = new DOMParser().parseFromString(await r.text(), "text/html"), results = [];
  for (const node of doc.querySelectorAll(".result")) {
    const a = node.querySelector("a.result__a"); if (!a) continue;
    let href = a.getAttribute("href") || ""; if (href.startsWith("//")) href = "https:" + href;
    try { const u = new URL(href); if (u.searchParams.get("uddg")) href = u.searchParams.get("uddg"); } catch { continue; }
    if (/^https?:\/\//i.test(href)) results.push({ url: href, title: (a.textContent || "").trim(), snippet: ((node.querySelector(".result__snippet") || {}).textContent || "").trim() });
  }
  return { results, raw: results.length };
}

/** Thử nhanh một engine (nút "Thử" ở tab Cài đặt): lấy trang 1, trả về danh sách link. */
export async function googleWeb(q) { return (await serpPage("googleweb", q, 1)).results.map((r) => r.url); }
export async function coccocWeb(q) { return (await serpPage("coccoc", q, 1)).results.map((r) => r.url); }
export async function bingWeb(q) { return (await serpPage("bing", q, 1)).results.map((r) => r.url); }
export async function braveWeb(q) { return (await serpPage("bravesearch", q, 1)).results.map((r) => r.url); }
export async function duckduckgoWeb(q) { return (await duckduckgoPage(q, 1)).results.map((r) => r.url); }

/* ---------------- tìm ảnh ---------------- */
/** Ảnh từ trang hình ảnh của Google/Bing/Brave mở trong trình duyệt (cùng cách bạn tự tìm ảnh). */
export async function browserImages(engine, query) {
  const urls = {
    google: `https://www.google.com/search?q=${enc(query)}&tbm=isch&hl=vi&gl=vn`,
    bing: `https://www.bing.com/images/search?q=${enc(query)}&setlang=vi&cc=VN`,
    brave: `https://search.brave.com/images?q=${enc(query)}`,
  };
  const data = await renderPage(urls[engine], "images");
  if (!data.images.length && BLOCKED.test(data.title || "")) throw new Error(`${engine} yêu cầu xác minh, hãy mở trang ảnh trong trình duyệt và xác minh rồi thử lại`);
  return data.images.map((i) => ({ image_url: i.full || i.thumb, thumb_url: i.thumb, page_url: i.page, title: i.title }));
}

/** Tìm ảnh bằng DuckDuckGo: lấy mã vqd rồi gọi i.js (cách thư viện ddgs đang dùng). */
export async function duckduckgoImages(query, limit = 40) {
  if (!isExt) throw new Error(EXT_ONLY);
  const home = await fetch(`https://duckduckgo.com/?q=${enc(query)}&iax=images&ia=images`, { signal: timeout() });
  const vqd = /vqd=["']?([\d-]+)/.exec(await home.text());
  if (!vqd) throw new Error("DuckDuckGo không cấp mã tìm ảnh (có thể đang giới hạn lượt)");
  const r = await fetch(`https://duckduckgo.com/i.js?o=json&q=${enc(query)}&l=vn-vi&vqd=${vqd[1]}&p=1&ct=AT`, { signal: timeout(), headers: { Referer: "https://duckduckgo.com/", Accept: "*/*" } });
  if (!r.ok) throw new Error(`DuckDuckGo ảnh trả HTTP ${r.status}`);
  return ((await r.json()).results || []).slice(0, limit).map((i) => ({ image_url: i.image, thumb_url: i.thumbnail, page_url: i.url || "", title: i.title || "" }));
}
