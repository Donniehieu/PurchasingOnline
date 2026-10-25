// Service worker của tiện ích: mở giao diện và "đọc trang bằng trình duyệt thật" cho những trang
// không đọc được bằng fetch (Google/Cốc Cốc/Bing/Brave Search chặn bot hoặc vẽ kết quả bằng JavaScript,
// Shopee/TikTok Shop vẽ giá bằng JavaScript).
// Cách làm: mở một tab nền như người dùng, đợi trang tự chạy xong, đọc nội dung rồi đóng tab.
// Dùng được trên mọi trình duyệt Chromium (Chrome, Cốc Cốc, Brave, Edge, Opera, Vivaldi). Safari cần chuyển đổi (xem README).

const api = globalThis.chrome || globalThis.browser;
const APP_URL = api.runtime.getURL("index.html");
const RENDER_TIMEOUT_MS = 30000;

api.action.onClicked.addListener(async () => {
  const [existing] = await api.tabs.query({ url: APP_URL });
  if (existing) {
    await api.tabs.update(existing.id, { active: true });
    await api.windows.update(existing.windowId, { focused: true });
  } else {
    await api.tabs.create({ url: APP_URL });
  }
});

const PROTO = 2; // tăng khi đổi định dạng dữ liệu trả về; giao diện kiểm tra để phát hiện service worker còn là bản cũ

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "ping") { sendResponse({ ok: true, proto: PROTO }); return false; }
  if (!msg || msg.type !== "render") return false;
  renderPage(msg.url, msg.mode || "html")
    .then((data) => sendResponse({ ok: true, proto: PROTO, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
  return true; // trả lời bất đồng bộ
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Chạy trong trang được mở. Phải tự đủ, không dùng biến ngoài. mode: html | links | serp | images */
function readPage(mode) {
  const text = (e) => (e.innerText || "").replace(/\s+/g, " ").trim();
  if (mode === "serp") {
    // Trang kết quả tìm kiếm: mỗi kết quả là một link ra ngoài (hoặc link bọc chuyển hướng) kèm tiêu đề và đoạn mô tả.
    const nav = /(^|\.)(gstatic\.com|googleusercontent\.com|youtube\.com|facebook\.com|accounts\.google\.com|support\.google\.com|policies\.google\.com|maps\.google\.com)$/i;
    const own = location.hostname.replace(/^www\./, "");
    const byHref = new Map();
    for (const a of document.querySelectorAll("a[href]")) {
      let u; try { u = new URL(a.href); } catch { continue; }
      if (!/^https?:$/.test(u.protocol) || nav.test(u.hostname)) continue;
      const wrapped = /\/composer\/goto|\/url$|\/ck\/a|\/l\/$|\/aclk/.test(u.pathname);
      const external = u.hostname.replace(/^www\./, "") !== own && !/(^|\.)(google|coccoc|bing|duckduckgo|brave)\.[a-z.]+$/i.test(u.hostname);
      if (!external && !wrapped) continue;
      const heading = a.querySelector("h1,h2,h3,h4");
      const title = heading ? text(heading) : text(a);
      if (title.length < 6) continue;
      // Một kết quả thường có hai link cùng địa chỉ (dòng "tên miền › đường dẫn" và dòng tiêu đề): ưu tiên link có thẻ tiêu đề, rồi link có chữ dài hơn.
      const crumb = /^https?:\/\//.test(title) || /https?:\/\/\S+\s*›/.test(title); // dòng "Tên miền https://... › đường dẫn" không phải tiêu đề
      const prev = byHref.get(a.href), score = (heading ? 1000 : 0) - (crumb ? 500 : 0) + title.length;
      if (prev && prev.score >= score) continue;
      let block = a;
      for (let i = 0; i < 5 && block.parentElement; i++) { block = block.parentElement; if (text(block).length > title.length + 60) break; }
      byHref.set(a.href, { score, item: { url: a.href, title: title.slice(0, 160), snippet: text(block).replace(title, "").trim().slice(0, 320) } });
    }
    const out = [...byHref.values()].map((v) => v.item);
    return { title: document.title, results: out, bodyLen: document.body ? document.body.innerText.length : 0 };
  }
  if (mode === "images") {
    // Trang kết quả hình ảnh (Google/Bing): ưu tiên link ảnh gốc trong imgres/murl, không có thì lấy ảnh thu nhỏ.
    const out = [], seen = new Set();
    for (const img of document.querySelectorAll("img")) {
      const src = img.currentSrc || img.src || "";
      if (!src || (img.naturalWidth || img.width) < 90 || seen.has(src)) continue;
      const link = img.closest("a");
      let full = "", page = "";
      if (link && link.href) {
        try { const u = new URL(link.href); if (u.searchParams.get("imgurl")) { full = u.searchParams.get("imgurl"); page = u.searchParams.get("imgrefurl") || ""; } } catch { /* bỏ qua */ }
      }
      const m = link && link.getAttribute("m"); // Bing: thuộc tính m là JSON có murl (ảnh gốc), purl (trang)
      if (m) { try { const j = JSON.parse(m); full = j.murl || full; page = j.purl || page; } catch { /* bỏ qua */ } }
      seen.add(src);
      out.push({ thumb: src.startsWith("data:") && src.length > 400000 ? "" : src, full, page, title: (img.alt || "").slice(0, 160), width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    }
    return { title: document.title, images: out };
  }
  if (mode === "links") {
    const skip = /(^|\.)(coccoc\.com|google\.[a-z.]+|gstatic\.com|googleusercontent\.com|facebook\.com|youtube\.com)$/i;
    const seen = new Set(), out = [];
    for (const a of document.querySelectorAll("a[href^='http']")) {
      let host = "";
      try { host = new URL(a.href).hostname; } catch { continue; }
      if (skip.test(host) || seen.has(a.href)) continue;
      const block = a.closest("li, article, section, div") || a;
      const title = (a.innerText || block.innerText || "").trim().split("\n")[0].slice(0, 160);
      seen.add(a.href);
      out.push({ url: a.href, title });
    }
    return { title: document.title, links: out };
  }
  return { title: document.title, html: document.documentElement.outerHTML };
}

async function renderPage(url, mode) {
  if (!/^https?:\/\//i.test(url)) throw new Error("Chỉ mở được link http/https");
  const tab = await api.tabs.create({ url, active: false });
  const started = Date.now();
  try {
    let last = null;
    while (Date.now() - started < RENDER_TIMEOUT_MS) {
      await sleep(mode === "images" ? 2500 : 1500);
      const current = await api.tabs.get(tab.id);
      if (current.status !== "complete") continue;
      if (mode === "images") { // trang ảnh tải thêm khi cuộn
        try { await api.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.scrollTo(0, document.body.scrollHeight) }); } catch { /* bỏ qua */ }
        await sleep(1200);
      }
      let result;
      try {
        [{ result }] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: readPage, args: [mode] });
      } catch (err) { throw new Error(`Không đọc được trang: ${err.message}`); }
      // Trang chuyển hướng của Cốc Cốc tự chạy JavaScript rồi mới sang trang kết quả: đợi tới khi nội dung ổn định.
      const size = result.html ? result.html.length : (result.links || result.results || result.images).length;
      const redirecting = /^redirecting/i.test(result.title || "");
      const ready = mode === "html" ? size > 1500 : size > 0 || (result.bodyLen > 500 && last === size);
      if (!redirecting && ready && last === size) return result;
      last = redirecting ? null : size;
    }
    throw new Error("Hết thời gian chờ trang");
  } finally {
    try { await api.tabs.remove(tab.id); } catch { /* tab đã đóng */ }
  }
}
