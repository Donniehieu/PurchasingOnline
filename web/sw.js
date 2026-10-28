// Service worker: lưu "vỏ" ứng dụng để mở nhanh và dùng được khi mất mạng (xem lại dữ liệu đã lưu).
// API (/api/*) luôn đi qua mạng, không bao giờ cache.
const VERSION = "po-v2.20.0";
const SHELL = [
  "./", "index.html", "style.css", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
  "js/app.js", "js/render.js", "js/link-ui.js", "js/viewer.js", "js/lib/links.js", "js/lib/quote.js", "js/lib/keygen.js", "js/lib/expand.js", "js/lib/techkb.js", "js/lib/wizcache.js", "js/advice-ui.js", "js/lib/need.js", "js/lib/advisor.js", "js/lib/cards.js", "js/lib/serp.js", "js/lib/kb.js", "js/lib/intent.js", "js/lib/config.js", "js/lib/imagesim.js", "js/lib/techverify.js", "js/lib/vision.js", "js/lib/visualpage.js", "js/lib/modelcache.js",
  "js/lib/api.js", "js/lib/extract.js", "js/lib/text.js", "js/lib/plan.js", "js/lib/entry.js", "js/lib/aggregate.js", "js/lib/answer.js", "js/lib/store.js", "js/lib/pipeline.js", "js/lib/bridge.js", "js/lib/limiter.js", "js/lib/hybrid.js", "js/lib/aitext.js", "js/lib/localocr.js", "js/lib/version.js", "js/lib/offers.js", "js/lib/contact.js", "js/lib/xlsx-export.js", "js/table-ui.js", "table.css",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  // chỉ xóa vỏ ứng dụng của phiên bản cũ (po-v*); KHÔNG xóa kho mô hình (transformers-cache) và thư viện CDN đã lưu (po-libs)
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => /^po-v/.test(k) && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Thư viện CDN có số phiên bản cố định (…@1.2.3…): không đổi nội dung, lưu một lần rồi dùng luôn (không tải lại mỗi lần mở ứng dụng)
  if (req.method === "GET" && url.hostname === "cdn.jsdelivr.net" && /@\d+\.\d+\.\d+/.test(url.pathname)) {
    e.respondWith(caches.open("po-libs").then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/mock/")) return;
  // mạng trước, lỗi mạng thì dùng bản đã lưu: luôn thấy bản mới nhất khi có mạng
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html")))
  );
});
