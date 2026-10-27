// Xuất bảng so sánh NCC ra file .xlsx (ExcelJS tải khi bấm xuất, không làm nặng lúc mở app).
import { OFFER_COLUMNS, cellValue, PRICE_NOTE } from "./offers.js";

export function loadExcelJS(doc = document, win = window) {
  if (win.ExcelJS) return Promise.resolve(win.ExcelJS);
  return new Promise((resolve, reject) => {
    const s = doc.createElement("script");
    s.src = "vendor/exceljs.min.js";
    s.onload = () => (win.ExcelJS ? resolve(win.ExcelJS) : reject(new Error("Không nạp được bộ xuất Excel")));
    s.onerror = () => reject(new Error("Không tải được bộ xuất Excel (kiểm tra mạng)"));
    doc.head.appendChild(s);
  });
}

const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2B4CCF" } };
const THIN = { style: "thin", color: { argb: "FFC9CFE6" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/**
 * rows: dòng đã lọc/sắp xếp (có stt); columnIds: các cột đang hiện, đúng thứ tự.
 * meta: { product, query, filterText, generatedAt }
 */
export function buildWorkbook(ExcelJS, rows, columnIds, meta = {}) {
  const cols = OFFER_COLUMNS.filter((c) => columnIds.includes(c.id));
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mua hàng thông minh";
  wb.created = new Date(meta.generatedAt ?? Date.now());
  const ws = wb.addWorksheet("So sánh NCC", { views: [{ state: "frozen", ySplit: 1 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = cols.map((c) => ({ header: c.label, key: c.id, width: c.width }));

  const head = ws.getRow(1);
  head.height = 30;
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEAD_FILL;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = BORDER;
  });

  rows.forEach((r) => {
    const row = ws.addRow(Object.fromEntries(cols.map((c) => [c.id, c.id === "link" ? { text: r.url, hyperlink: r.url } : cellValue(r, c.id)])));
    row.alignment = { vertical: "top", wrapText: true };
    row.eachCell((cell) => { cell.border = BORDER; });
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.id === "stt") cell.alignment = { vertical: "top", horizontal: "center" };
      if (c.id === "price") {
        cell.numFmt = '#,##0 "₫"';
        cell.alignment = { vertical: "top", horizontal: "right" };
        if (r.price != null && r.priceVia && PRICE_NOTE[r.priceVia] && !["page", "jsonld", "meta"].includes(r.priceVia)) cell.note = "Giá: " + PRICE_NOTE[r.priceVia];
        if (r.price == null) cell.value = "Liên hệ";
      }
      if (c.id === "link") cell.font = { color: { argb: "FF2B4CCF" }, underline: true };
    });
  });
  const last = Math.max(1, rows.length + 1);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: last, column: cols.length } };

  const info = wb.addWorksheet("Thông tin");
  info.columns = [{ width: 26 }, { width: 90 }];
  const kv = [
    ["Sản phẩm", meta.product || ""],
    ["Từ khóa tìm", meta.query || ""],
    ["Xuất lúc", new Date(meta.generatedAt ?? Date.now()).toLocaleString("vi-VN")],
    ["Số dòng", rows.length],
    ["Bộ lọc đang áp dụng", meta.filterText || "Không"],
    ["Nguồn dữ liệu", "Các trang web thật đã đọc (giá, VAT, thông số, NCC), kết quả Google/AI và cache trên thiết bị. Mỗi dòng có link trang gốc."],
    ["Đơn giá", "Giá đọc từ trang có cấu trúc là đáng tin nhất. Ô có ghi chú “AI/Google, chưa xác nhận” chỉ để tham khảo. “Liên hệ” = trang không niêm yết giá."],
    ["VAT", "Chỉ ghi “Đã gồm/Chưa gồm VAT” khi trang nêu rõ; “Chưa rõ” nghĩa là trang không ghi: hãy hỏi NCC. Giá bán lẻ niêm yết thường đã gồm VAT nhưng cần xác nhận."],
    ["Lưu ý", "Giá và thông số có thể thay đổi theo thời điểm, phiên bản và khuyến mãi; xác nhận báo giá chính thức trước khi mua."],
  ];
  kv.forEach(([k, v]) => { const row = info.addRow([k, v]); row.getCell(1).font = { bold: true }; row.alignment = { vertical: "top", wrapText: true }; });
  return wb;
}

export const xlsxFileName = (meta, now = new Date()) => {
  const base = String(meta.product || "san-pham").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "san-pham";
  return `so-sanh-ncc-${base}-${now.toISOString().slice(0, 10)}.xlsx`;
};

export async function exportOffersXlsx(rows, columnIds, meta, { ExcelJS, download = downloadBlob } = {}) {
  const lib = ExcelJS ?? (await loadExcelJS());
  const wb = buildWorkbook(lib, rows, columnIds, meta);
  const buffer = await wb.xlsx.writeBuffer();
  const name = xlsxFileName(meta);
  download(buffer, name);
  return { name, size: buffer.byteLength ?? buffer.length };
}

export function downloadBlob(buffer, name) {
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
