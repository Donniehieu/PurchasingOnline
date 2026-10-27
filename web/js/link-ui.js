// Ô nhập link NCC: dán một hoặc nhiều link, hoặc nạp file Excel/CSV/TXT. Dùng ở trang chủ (lập bảng báo giá mới)
// và trong tab Bảng NCC (thêm link vào bảng đang xem).
import { extractLinks, readLinkFile, mergeLinks, MAX_LINKS } from "./lib/links.js";
import { loadExcelJS } from "./lib/xlsx-export.js";
import { esc, domainOf, clip } from "./lib/text.js";

export function mountLinkInput(host, { submitLabel = "Đọc giá từ các link", withName = false, onSubmit, toast = () => {} } = {}) {
  host.innerHTML = `
    <div class="lk">
      ${withName ? `<label class="lk-name">Tên sản phẩm cần báo giá <span class="muted small">(không bắt buộc, để trống thì lấy tên từ trang đầu tiên)</span><input type="text" class="lk-prod" maxlength="120" placeholder="Ví dụ: Mỏ lết 200mm Hybrid Lobster UM30XG"></label>` : ""}
      <textarea class="lk-text" rows="4" aria-label="Link nhà cung cấp" placeholder="Dán link NCC: mỗi dòng một link (có thể ghi chú tên NCC cùng dòng). Dán nhiều link một lần cũng được."></textarea>
      <div class="row">
        <button type="button" class="btn ghost lk-pick">Nạp file Excel / CSV / TXT</button>
        <input type="file" class="lk-file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" multiple hidden>
        <span class="lk-count muted small" aria-live="polite"></span>
        <button type="button" class="btn primary lk-go">${esc(submitLabel)}</button>
      </div>
      <p class="muted small" style="margin:6px 0 0">File Excel: link nằm ở cột nào cũng được (ô siêu liên kết cũng đọc được), chữ cùng dòng được giữ làm ghi chú. Tối đa ${MAX_LINKS} link mỗi lần.</p>
    </div>`;
  const $ = (s) => host.querySelector(s);
  const text = $(".lk-text"), fileInput = $(".lk-file"), count = $(".lk-count"), go = $(".lk-go");
  let fromFiles = [];
  const names = [];
  const items = () => mergeLinks(extractLinks(text.value), fromFiles);
  const refresh = () => {
    const n = items().length;
    count.textContent = n ? `${n} link${names.length ? " · từ " + names.join(", ") : ""}` : "";
  };
  text.addEventListener("input", refresh);
  $(".lk-pick").addEventListener("click", () => fileInput.click());
  async function takeFiles(files) {
    for (const f of files) {
      try {
        const got = await readLinkFile(f, { loadExcel: () => loadExcelJS() });
        if (!got.length) { toast(`Không thấy link nào trong ${f.name}`); continue; }
        fromFiles = mergeLinks(fromFiles, got);
        names.push(clip(f.name, 24));
        toast(`${f.name}: ${got.length} link`);
      } catch (e) { toast(`${f.name}: ${e.message}`); }
    }
    refresh();
  }
  fileInput.addEventListener("change", async () => { const fs = [...fileInput.files]; fileInput.value = ""; await takeFiles(fs); });
  text.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) e.preventDefault(); });
  text.addEventListener("drop", async (e) => { const fs = [...(e.dataTransfer?.files ?? [])]; if (!fs.length) return; e.preventDefault(); await takeFiles(fs); });
  go.addEventListener("click", () => {
    const list = items();
    if (!list.length) return toast("Chưa có link nào: hãy dán link hoặc nạp file Excel");
    onSubmit({ items: list, name: $(".lk-prod")?.value.trim() ?? "" });
  });
  return {
    clear() { text.value = ""; fromFiles = []; names.length = 0; if ($(".lk-prod")) $(".lk-prod").value = ""; refresh(); },
    busy(on) { go.disabled = on; $(".lk-pick").disabled = on; },
  };
}

const STATUS = { wait: "chờ", run: "đang đọc…", ok: "đã đọc", fail: "lỗi", stop: "đã dừng" };
/** Danh sách link đã thêm và kết quả đọc từng link (để biết link nào lỗi). */
export function quoteStatusHtml(entry) {
  const links = entry?.quote?.links ?? [];
  if (!links.length) return "";
  const ok = links.filter((l) => l.status === "ok").length;
  const bad = links.filter((l) => l.status === "fail" || l.status === "stop");
  const rows = links.map((l) => `<li class="lk-${esc(l.status)}"><span class="badge ${l.status === "ok" ? "good" : l.status === "fail" ? "warn" : ""}">${STATUS[l.status] ?? ""}</span> <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || domainOf(l.url))}</a> <span class="muted small">${esc(clip(l.url, 56))}${l.error ? " — " + esc(l.error) : ""}</span></li>`).join("");
  return `<details class="lk-list"${bad.length ? " open" : ""}><summary class="small"><b>${links.length} link đã thêm</b> · đọc được ${ok}${bad.length ? ` · <span style="color:var(--bad)">${bad.length} link lỗi (vẫn có dòng trong bảng, hãy mở link kiểm tra hoặc hỏi NCC)</span>` : ""}</summary><ul class="lk-ul">${rows}</ul></details>`;
}
