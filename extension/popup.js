const $ = (id) => document.getElementById(id);
let tabOrigin = "";

async function render() {
  const s = await chrome.runtime.sendMessage({ type: "popup:status" });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { tabOrigin = new URL(tab.url).origin; } catch { tabOrigin = ""; }
  const allowed = s.allowed.includes(tabOrigin);
  const blocked = Object.keys(s.breaker);
  $("state").innerHTML = `Phiên bản ${s.version} · ${s.store ? "tự cập nhật qua Chrome" : "tự tải lại khi thư mục đổi"} · Google ${s.googleLast10Min}/8 lần trong 10 phút` +
    (blocked.length ? `<br><span class="warn">Đang tạm ngừng: ${blocked.join(", ")}</span>` : "");
  $("origin").textContent = tabOrigin ? `Trang đang mở: ${tabOrigin} — ${allowed ? "đã được phép" : "chưa được phép"}` : "";
  $("allow").hidden = allowed || !/^https?:/.test(tabOrigin);
  $("clear").hidden = !blocked.length;
}

$("allow").onclick = async () => { await chrome.runtime.sendMessage({ type: "popup:allow", origin: tabOrigin }); render(); };
$("clear").onclick = async () => { await chrome.runtime.sendMessage({ type: "popup:clear" }); render(); };
$("check").onclick = async () => {
  const r = await chrome.runtime.sendMessage({ type: "popup:selfcheck" });
  $("origin").textContent = { store: "Bản Web Store: Chrome tự cập nhật.", same: "Đã là bản mới nhất của thư mục.", reload: "Phát hiện bản mới, đang tải lại…", busy: "Đang bận, thử lại sau.", init: "Đã ghi nhận phiên bản hiện tại.", error: "Không đọc được file." }[r.result] || r.result;
};
render();
