// Content script: chuyển tin giữa trang ứng dụng (postMessage) và tiện ích (chrome.runtime).
// Chỉ chạy trên các địa chỉ khai báo trong manifest; background.js còn kiểm tra thêm danh sách cho phép.
const VERSION = chrome.runtime.getManifest().version;

window.addEventListener("message", async (ev) => {
  if (ev.source !== window || !ev.data || ev.data.source !== "po-app") return;
  const { id, type, payload } = ev.data;
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type, payload });
  } catch (e) {
    res = { ok: false, error: "Tiện ích không phản hồi: " + (e && e.message ? e.message : e) };
  }
  window.postMessage({ source: "po-ext", id, res }, location.origin);
});

window.postMessage({ source: "po-ext", type: "ready", version: VERSION }, location.origin);
