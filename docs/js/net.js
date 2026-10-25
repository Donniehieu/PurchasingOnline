// Lớp mạng. Khi chạy như tiện ích trình duyệt (isExt) thì được phép tải mọi website không bị chặn CORS và nhờ trình duyệt
// thật mở trang Google (tab nền, như bạn tự tìm). Chạy như trang web thường thì các hàm này báo lỗi rõ ràng.
// Chỉ dùng Google (google.com) làm công cụ tìm kiếm. "Trang" = trang kết quả của Google (trang 1, 2, 3...).

const api = globalThis.chrome || globalThis.browser;
export const isExt = typeof api !== "undefined" && !!(api.runtime && api.runtime.id);
const PROTO = 2; // phải khớp background.js
const STALE_WORKER = "Tiện ích đang chạy bản cũ. Mở trang extensions của trình duyệt (chrome://extensions), bấm nút tải lại (biểu tượng vòng tròn) ở tiện ích \"Mua hàng tự động\", rồi mở lại app.";
export const EXT_ONLY = "Cần cài làm tiện ích Chrome/Cốc Cốc/Brave/Edge (xem README) để mở Google và đọc các trang web. Bản web thường (kể cả trên điện thoại) chỉ xem lịch sử, sửa bảng và xuất file.";

/** Kiểm tra service worker của tiện ích đã là bản mới chưa. Trả về { ok, message }. */
export async function checkWorker() {
  if (!isExt) return { ok: false, message: EXT_ONLY };
  try { const r = await api.runtime.sendMessage({ type: "ping" }); return r && r.proto === PROTO ? { ok: true } : { ok: false, message: STALE_WORKER }; }
  catch { return { ok: false, message: STALE_WORKER }; }
}

let active = 0; const waiting = [];
async function slot() { if (active >= 2) await new Promise((r) => waiting.push(r)); active++; }
function release() { active--; const next = waiting.shift(); if (next) next(); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Nhờ trình duyệt mở trang thật. mode: html | serp (kết quả tìm kiếm) | images (kết quả hình ảnh). */
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

const enc = encodeURIComponent;
const BLOCKED = /sorry|unusual traffic|captcha|verify you|xác minh|are you a robot|access denied|\b403\b|forbidden|does not have permission|not allowed|too many requests|\b429\b/i;
/** Google từ chối phục vụ (CAPTCHA, 403, quá nhiều yêu cầu): báo rõ để bạn xử lý, app không tìm cách vượt qua. */
function blockedError(label, data) {
  return new Error(`${label} từ chối truy cập${data.bodyText ? ` ("${data.bodyText.slice(0, 90)}")` : ""}. Đây là chặn từ phía Google, app không vượt qua được. Hãy đợi vài phút rồi thử lại, mở google.com trong trình duyệt để xác minh nếu có, tăng thời gian chờ giữa các lần mở trang hoặc giảm số trang.`);
}

/** Giải link bọc chuyển hướng của Google (/url?q=...) về link đích. Trả về chuỗi rỗng nếu là link nội bộ của Google. */
export function resolveUrl(href) {
  let u; try { u = new URL(href); } catch { return ""; }
  const host = u.hostname.replace(/^www\./, "");
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return u.pathname === "/url" ? (u.searchParams.get("q") || u.searchParams.get("url") || "") : "";
  return href;
}

/** Trang kết quả thứ `page` của Google (bắt đầu từ 1). Trả về { results: [{url,title,snippet}] }. */
export async function serpPage(query, page) {
  const data = await renderPage(`https://www.google.com/search?q=${enc(query)}&hl=vi&gl=vn&num=10&start=${(page - 1) * 10}&pws=0`, "serp");
  if (!data.results.length && (BLOCKED.test(data.title || "") || BLOCKED.test(data.bodyText || ""))) throw blockedError("Google", data);
  const results = [], seen = new Set();
  for (const r of data.results) { const url = resolveUrl(r.url); if (/^https?:\/\//i.test(url) && !seen.has(url)) { seen.add(url); results.push({ ...r, url }); } }
  return { results };
}

/** Ảnh từ Google Hình ảnh mở trong trình duyệt (cùng cách bạn tự tìm ảnh). */
export async function googleImages(query) {
  const data = await renderPage(`https://www.google.com/search?q=${enc(query)}&tbm=isch&hl=vi&gl=vn`, "images");
  if (!data.images.length && (BLOCKED.test(data.title || "") || BLOCKED.test(data.bodyText || ""))) throw blockedError("Google Hình ảnh", data);
  return data.images.map((i) => ({ image_url: i.full || i.thumb, thumb_url: i.thumb, page_url: i.page, title: i.title }));
}

/** Thử nhanh Google (nút "Thử Google" ở tab Cài đặt): trả về danh sách link của trang 1. */
export async function googleWeb(query) { return (await serpPage(query, 1)).results.map((r) => r.url); }
