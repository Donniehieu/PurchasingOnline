// Xuất file .xlsx ngay trên trình duyệt bằng ExcelJS (vendor/exceljs.min.js, biến toàn cục ExcelJS).
import { buildInsights, money, parseUrls, priceComparison, specText } from "./core.js";

const BLUE = "FF003399", GREEN = "FF92D050";
const thin = { style: "thin", color: { argb: "FF999999" } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const WRAP = { vertical: "middle", wrapText: true };
const yesNo = (v) => (v === true ? "Có" : v === false ? "Không" : "Chưa rõ");
const toDate = (iso) => (iso ? new Date(`${iso}T00:00:00`) : null);

function notes(s) {
  const l = [];
  if (s.note) l.push(`Ghi chú người mua: ${s.note}`);
  if (s.recommended) l.push(`★ KHUYẾN NGHỊ ƯU TIÊN (điểm ${s.score})`);
  if (!s.eligible) l.push(`Loại: ${s.reason}`);
  l.push(s.warranty_months ? `Bảo hành: ${s.warranty_months} tháng` : "Bảo hành: chưa rõ, cần hỏi NCC");
  l.push(`Hóa đơn VAT: ${yesNo(s.vat)}`);
  if (s.vat_included) l.push("Giá trên web đã gồm VAT, đơn giá đã chia 1.1");
  if (s.description) l.push(`Mô tả: ${s.description.slice(0, 160)}`);
  const phones = s.contacts?.phones || [];
  if (phones.length) l.push(`Liên hệ: ${phones.join(", ")}`);
  l.push("Trạng thái: cần xác minh trước khi đặt hàng");
  if (s.url) l.push(`Nguồn: ${s.url}`);
  return l.join("\n");
}
function spec(s) {
  const p = []; if (s.mah) p.push(`Pin ${s.mah.toLocaleString("vi-VN")} mAh`); if (s.volt) p.push(`${s.volt}V`);
  if (s.title && s.url) p.push(`Trang: ${s.title}`); return p.join(", ");
}
function headerRow(ws, values, fill = BLUE) {
  const row = ws.addRow(values);
  row.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } }; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
  return row;
}
function widths(ws, list) { list.forEach((w, i) => { ws.getColumn(i + 1).width = w; }); }
const lineCount = (t) => String(t || "").split("\n").reduce((a, x) => a + Math.max(1, Math.floor(x.length / 60) + 1), 0);

/** Form duyệt báo giá: cột A-H đúng mẫu, cột I thêm ngày cập nhật web. */
export function buildJobWorkbook(job) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Thông báo duyệt giá");
  ws.addRow(["YCMS"]); ws.mergeCells("A1:I1");
  headerRow(ws, ["TT", "Tên hàng hóa", "Số lượng ", "NCC", null, "Thông số kỹ thuật", "Đơn giá chưa VAT", "Ghi Chú", "Ngày cập nhật trên web"]);
  widths(ws, [6, 34, 16, 26, 10, 44, 22, 52, 20]);
  const list = job.suppliers;
  list.forEach((s, i) => {
    const price = s.price && s.vat_included ? Math.round(s.price / 1.1) : s.price;
    const row = ws.addRow([i + 1, null, null, s.name, null, spec(s), price, notes(s), toDate(s.date)]);
    row.height = Math.max(30, 15 * lineCount(notes(s)));
    for (let c = 1; c <= 9; c++) {
      const cell = row.getCell(c); cell.border = BORDER; cell.alignment = WRAP;
      if (s.recommended) { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } }; cell.font = { bold: true }; }
    }
    row.getCell(7).numFmt = "#,##0"; row.getCell(9).numFmt = "dd/mm/yyyy";
  });
  if (list.length) {
    ws.getCell("B3").value = job.query; ws.getCell("C3").value = job.quantity;
    if (list.length > 1) { ws.mergeCells(3, 2, 2 + list.length, 2); ws.mergeCells(3, 3, 2 + list.length, 3); }
    for (const a of ["B3", "C3"]) { ws.getCell(a).alignment = { vertical: "middle", horizontal: "center", wrapText: true }; ws.getCell(a).border = BORDER; }
  }
  const after = 2 + Math.max(list.length, 1) + 2;
  ws.getCell(`B${after}`).value = "Mục đích sử dụng:"; ws.getCell(`B${after}`).font = { bold: true };
  ws.getCell(`C${after}`).value = job.purpose || "Chưa nhập";

  const info = wb.addWorksheet("Thông tin yêu cầu");
  [["Tên sản phẩm", job.query], ["Mã / model", job.product_code || "Không nhập"], ["Số lượng", job.quantity], ["Mục đích sử dụng", job.purpose || "Chưa nhập"],
    ["Thông số đã xác nhận", specText(job.spec)], ["Từ khóa tìm kiếm", job.keywords || ""], ["Engine đã dùng", (job.engines || []).join(", ") || "Nhập tay / link nhập tay"],
    ["Số trang NCC", list.length], ["Ngày lập", new Date().toLocaleDateString("vi-VN")]].forEach((r) => info.addRow(r));
  info.getColumn(1).font = { bold: true }; widths(info, [26, 80]);

  const cmp = wb.addWorksheet("So sánh giá");
  headerRow(cmp, ["NCC", "Đơn giá (đ)", "Tỷ lệ so với rẻ nhất (%)", "Khuyến nghị"]);
  priceComparison(list).forEach((r) => cmp.addRow([r.name, r.price, r.ratio, r.recommended ? "Có" : ""]));
  cmp.getColumn(2).numFmt = "#,##0"; widths(cmp, [34, 16, 24, 14]);

  const analysis = job.analysis || buildInsights(list, job.quantity, { product: job.query, spec: specText(job.spec), purpose: job.purpose, research: job.research });
  const neg = wb.addWorksheet("Đàm phán NCC");
  if (!analysis.negotiation.length) neg.addRow(["Chưa có NCC khuyến nghị để lập kịch bản đàm phán."]);
  for (const n of analysis.negotiation) {
    neg.addRow([`NCC: ${n.ncc}`]).font = { bold: true, size: 12 };
    neg.addRow([`Giá hiện tại: ${money(n.current_price)}`]); neg.addRow([`Mục tiêu: ${n.target_note}`]); neg.addRow([`Phương án dự phòng: ${n.backup}`]);
    for (const [title, lines] of [["Điểm mạnh thương lượng (từ dữ liệu thu thập)", n.leverage], ["Câu hỏi cần làm rõ với NCC", n.questions], ["Chiến lược thuyết phục NCC", n.strategies], ["Các bước đàm phán theo quy trình mua hàng", n.steps]]) {
      neg.addRow([]); neg.addRow([title]).font = { bold: true }; lines.forEach((x) => neg.addRow([`- ${x}`]));
    }
    if (n.references.length) { neg.addRow([]); neg.addRow(["Căn cứ tham khảo trên web"]).font = { bold: true }; n.references.forEach((r) => neg.addRow([`- [${r.topic}] ${r.text} (${r.url})`])); }
  }
  widths(neg, [130]); neg.eachRow((r) => { r.alignment = { vertical: "top", wrapText: true }; });

  const per = wb.addWorksheet("Thuyết phục sếp"), p = analysis.persuasion;
  if (!p.title) per.addRow(["Chưa có NCC khuyến nghị để lập luận thuyết phục."]);
  else {
    per.addRow([p.title]).font = { bold: true, size: 13 };
    p.sections.forEach((s) => { per.addRow([]); per.addRow([s.heading]).font = { bold: true }; s.points.forEach((x) => per.addRow([`- ${x}`])); });
    per.addRow([]); per.addRow([p.closing]);
  }
  widths(per, [130]); per.eachRow((r) => { r.alignment = { vertical: "top", wrapText: true }; });

  const src = wb.addWorksheet("Nguồn tham khảo");
  headerRow(src, ["STT", "NCC", "Tiêu đề trang", "Link tham khảo", "Giá tìm được (đ)", "Ngày cập nhật web", "Đủ điều kiện", "Ghi chú"]);
  list.forEach((s, i) => src.addRow([i + 1, s.name, s.title, s.url, s.price, toDate(s.date), s.eligible ? "Có" : "Không", notes(s)]));
  src.getColumn(5).numFmt = "#,##0"; src.getColumn(6).numFmt = "dd/mm/yyyy"; widths(src, [6, 26, 40, 60, 18, 18, 14, 60]);
  src.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: "top", wrapText: true }; });

  if ((job.edits || []).length) {
    const ed = wb.addWorksheet("Lịch sử điều chỉnh");
    headerRow(ed, ["Thời gian", "NCC", "Trường", "Giá trị cũ", "Giá trị mới"]);
    job.edits.forEach((e) => ed.addRow([e.time.replace("T", " "), e.supplier, e.field_label, String(e.old), String(e.new)]));
    widths(ed, [20, 30, 22, 30, 30]);
  }
  return wb;
}

async function download(wb, filename) {
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export const downloadJob = (job) => download(buildJobWorkbook(job), `bao_gia_${job.id}.xlsx`);

export function downloadLinks(job) {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Link NCC");
  headerRow(ws, ["NCC", "Link"]); job.suppliers.forEach((s) => ws.addRow([s.name, s.url])); widths(ws, [30, 90]);
  return download(wb, `link_ncc_${job.id}.xlsx`);
}
export function downloadHistory(groups) {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Tổng hợp theo sản phẩm");
  headerRow(ws, ["Sản phẩm", "Số lượt tìm", "Từ khóa đã dùng", "Số trang web", "Các trang web", "Số NCC", "Các NCC", "Giá trung bình (đ)", "Giá trung vị (đ)", "Giá thấp nhất (đ)", "Giá cao nhất (đ)", "Biến động giá (%)", "Lần đầu tìm", "Lần gần nhất", "Engine đã dùng", "NCC được khuyến nghị", "Số lần sửa bảng"]);
  groups.forEach((g) => ws.addRow([g.name, g.searches, g.keywords.join("\n"), g.sites.length, g.sites.map((s) => s.domain).join("\n"), g.supplier_count,
    g.suppliers.map((s) => s.name).join("\n"), g.avg_price, g.median_price, g.min_price, g.max_price, g.price_change_pct, g.first_search.replace("T", " "),
    g.last_search.replace("T", " "), g.engines.join(", "), g.recommended.map((r) => `${r.name} (${r.times})`).join(", "), g.edit_count]));
  widths(ws, [30, 10, 45, 10, 40, 8, 40, 16, 16, 16, 16, 12, 20, 20, 18, 36, 12]);
  ws.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: "top", wrapText: true }; });
  const d = wb.addWorksheet("Chi tiết NCC"); headerRow(d, ["Sản phẩm", "NCC", "Số lần xuất hiện", "Giá thấp nhất (đ)", "Giá gần nhất (đ)", "Link"]);
  groups.forEach((g) => g.suppliers.forEach((s) => d.addRow([g.name, s.name, s.times, s.min_price, s.last_price, s.url]))); widths(d, [30, 30, 14, 18, 18, 80]);
  return download(wb, "lich_su_tim_kiem.xlsx");
}
export function downloadEdits(edits) {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Lịch sử điều chỉnh");
  headerRow(ws, ["Thời gian", "Sản phẩm", "NCC", "Trường", "Giá trị cũ", "Giá trị mới", "Mã yêu cầu"]);
  edits.forEach((e) => ws.addRow([e.time.replace("T", " "), e.product, e.supplier, e.field_label, String(e.old), String(e.new), e.job_id])); widths(ws, [20, 30, 28, 22, 28, 28, 14]);
  return download(wb, "lich_su_dieu_chinh.xlsx");
}

/** Đọc link từ .xlsx / .csv / .txt người dùng chọn. */
export async function readLinkFile(file) {
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
    const cells = []; wb.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((c) => cells.push(typeof c.value === "object" && c.value ? (c.value.text || c.value.hyperlink || "") : String(c.value ?? "")))));
    return parseUrls(cells.join(" "));
  }
  return parseUrls((await file.text()).replace(/[,;"]/g, " "));
}
