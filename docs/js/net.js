// Lớp mạng phụ thuộc môi trường. Khi chạy như tiện ích Cốc Cốc/Chrome (isExt) thì được phép tải mọi website
// mà không bị chặn CORS, và có thể nhờ trình duyệt thật đọc những trang cần JavaScript.
// Chạy như trang web thường (GitHub Pages) thì các hàm này báo lỗi rõ ràng.

export const isExt = typeof chrome !== "undefined" && !!(chrome.runtime && chrome.runtime.id);
const EXT_ONLY = "Chức năng này chỉ chạy khi cài làm tiện ích Cốc Cốc/Chrome (xem README)";

let active = 0; const waiting = [];
async function slot() { if (active >= 2) await new Promise((r) => waiting.push(r)); active++; }
function release() { active--; const next = waiting.shift(); if (next) next(); }

/** Nhờ trình duyệt mở trang thật. mode "html" trả về HTML, mode "links" trả về danh sách link ra ngoài. */
export async function renderPage(url, mode = "html") {
  if (!isExt) throw new Error(EXT_ONLY);
  await slot();
  try {
    const res = await chrome.runtime.sendMessage({ type: "render", url, mode });
    if (!res || !res.ok) throw new Error((res && res.error) || "Không mở được trang");
    return res.data;
  } finally { release(); }
}

function timeout(ms = 15000) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }

/** Tìm web bằng Cốc Cốc: mở trang kết quả trong tab nền rồi lấy các link ra ngoài. */
export async function coccocWeb(query, limit) {
  const { links } = await renderPage(`https://coccoc.com/search?query=${encodeURIComponent(query)}`, "links");
  return links.map((l) => l.url).slice(0, limit * 4);
}

/** Tìm web bằng Google ngay trong trình duyệt (không cần khóa): mở tab nền như bạn tự tìm, lấy các link kết quả.
 *  Nếu Google đòi xác minh (CAPTCHA) thì báo lỗi để bạn tự mở google.com xác minh, app không vượt qua bước này. */
export async function googleWeb(query, limit) {
  const { links, title } = await renderPage(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=vi&gl=vn&num=${Math.min(Math.max(limit, 10), 20)}&pws=0`, "links");
  if (/sorry|unusual traffic|captcha/i.test(title || "")) throw new Error("Google yêu cầu xác minh. Hãy mở google.com trong trình duyệt, xác minh rồi thử lại");
  const urls = links.map((l) => l.url).filter((u) => !/google\.|\/search\?|webcache|translate\.goog/i.test(u));
  if (!urls.length) throw new Error("Không đọc được kết quả Google (có thể đang hiện trang đồng ý cookie hoặc xác minh)");
  return urls.slice(0, limit * 4);
}

/** Tìm web bằng DuckDuckGo (bản HTML, không cần khóa). */
export async function duckduckgoWeb(query, limit) {
  if (!isExt) throw new Error(EXT_ONLY);
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=vn-vi`, { signal: timeout() });
  if (!r.ok) throw new Error(`DuckDuckGo trả HTTP ${r.status}`);
  const doc = new DOMParser().parseFromString(await r.text(), "text/html");
  const urls = [];
  for (const a of doc.querySelectorAll("a.result__a")) {
    let href = a.getAttribute("href") || "";
    if (href.startsWith("//")) href = "https:" + href;
    try { const u = new URL(href); if (u.searchParams.get("uddg")) href = u.searchParams.get("uddg"); } catch { continue; }
    if (/^https?:\/\//i.test(href)) urls.push(href);
  }
  return urls.slice(0, limit * 4);
}

/** Tìm ảnh bằng DuckDuckGo: lấy mã vqd rồi gọi i.js (cách thư viện ddgs đang dùng). */
export async function duckduckgoImages(query, limit) {
  if (!isExt) throw new Error(EXT_ONLY);
  const home = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, { signal: timeout() });
  const vqd = /vqd=["']?([\d-]+)/.exec(await home.text());
  if (!vqd) throw new Error("DuckDuckGo không cấp mã tìm ảnh (có thể đang giới hạn lượt)");
  const r = await fetch(`https://duckduckgo.com/i.js?o=json&q=${encodeURIComponent(query)}&l=vn-vi&vqd=${vqd[1]}&p=1&ct=AT`, {
    signal: timeout(), headers: { Referer: "https://duckduckgo.com/", Accept: "*/*" },
  });
  if (!r.ok) throw new Error(`DuckDuckGo ảnh trả HTTP ${r.status}`);
  return ((await r.json()).results || []).slice(0, limit).map((i) => ({ image_url: i.image, thumb_url: i.thumbnail, page_url: i.url || "", title: i.title || "" }));
}
