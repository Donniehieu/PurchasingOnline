// Service worker của tiện ích: mở giao diện và "đọc trang bằng trình duyệt thật" cho những trang
// không đọc được bằng fetch (Cốc Cốc chặn bot bằng JavaScript, Shopee/TikTok Shop vẽ giá bằng JavaScript).
// Cách làm: mở một tab nền như người dùng, đợi trang tự chạy xong, đọc nội dung rồi đóng tab.

const APP_URL = chrome.runtime.getURL("index.html");
const RENDER_TIMEOUT_MS = 30000;

chrome.action.onClicked.addListener(async () => {
  const [existing] = await chrome.tabs.query({ url: APP_URL });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: APP_URL });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "render") return false;
  renderPage(msg.url, msg.mode || "html")
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
  return true; // trả lời bất đồng bộ
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Chạy trong trang được mở. Phải tự đủ, không dùng biến ngoài. */
function readPage(mode) {
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
  const tab = await chrome.tabs.create({ url, active: false });
  const started = Date.now();
  try {
    let last = null;
    while (Date.now() - started < RENDER_TIMEOUT_MS) {
      await sleep(1500);
      const current = await chrome.tabs.get(tab.id);
      if (current.status !== "complete") continue;
      let result;
      try {
        [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage, args: [mode] });
      } catch (err) { throw new Error(`Không đọc được trang: ${err.message}`); }
      // Trang chuyển hướng của Cốc Cốc tự chạy JavaScript rồi mới sang trang kết quả: đợi tới khi nội dung ổn định.
      const size = result.html ? result.html.length : result.links.length;
      const redirecting = /^redirecting/i.test(result.title || "");
      if (!redirecting && (mode === "links" ? size > 0 : size > 1500) && last === size) return result;
      last = redirecting ? null : size;
    }
    throw new Error("Hết thời gian chờ trang");
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch { /* tab đã đóng */ }
  }
}
