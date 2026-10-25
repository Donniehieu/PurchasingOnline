// Xuất file .xlsx ngay trên trình duyệt bằng ExcelJS (vendor/exceljs.min.js, biến toàn cục ExcelJS).
import { money, parseUrls, priceComparison, specText, supplierInfo } from "./core.js";

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

/** Thông tin sản phẩm của một NCC: pin, điện áp, bảo hành, mô tả, ghi chú người mua. */
function productInfo(s) {
  const l = [supplierInfo(s)];
  if (s.vat_included) l.push("Giá trên web đã gồm VAT, đơn giá đã chia 1.1");
  if (s.description) l.push(`Mô tả: ${s.description.slice(0, 160)}`);
  if (s.note) l.push(`Ghi chú người mua: ${s.note}`);
  return l.join("\n");
}
function contactText(s) {
  const c = s.contacts || [], l = [];
  if ((c.phones || []).length) l.push(`ĐT: ${c.phones.join(", ")}`);
  if ((c.zalo || []).length) l.push(`Zalo: ${c.zalo[0]}${c.zalo_guess ? " (theo số ĐT, chưa xác nhận)" : ""}`);
  if ((c.emails || []).length) l.push(`Email: ${c.emails.join(", ")}`);
  if (s.contact_source || s.url) l.push(`Nguồn: ${s.contact_source || s.url}`);
  return l.join("\n");
}
const vatText = (s) => [yesNo(s.vat), s.vat_evidence ? `"${s.vat_evidence}"` : "", s.vat_source ? `Nguồn: ${s.vat_source}` : ""].filter(Boolean).join("\n");
function statusText(s) {
  const l = [s.recommended ? `★ KHUYẾN NGHỊ ƯU TIÊN` : s.eligible ? "Đủ điều kiện" : `Loại: ${s.reason}`];
  if (s.over_budget) l.push("Vượt ngân sách");
  l.push("Cần xác minh trước khi đặt hàng");
  return l.join("\n");
}

/** Form duyệt báo giá. Cột: Tên NCC, Tên sản phẩm / model, Số lượng, Đơn giá, VAT, Thông tin sản phẩm, Liên hệ. */
export function buildJobWorkbook(job) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bảng so sánh giá");
  const COLS = ["Tên NCC", "Tên sản phẩm", "Mã sản phẩm", "Số lượng", "Đơn giá chưa VAT (đ)", "VAT", "Thông tin sản phẩm", "Liên hệ"];
  ws.addRow([`BẢNG SO SÁNH GIÁ: ${[job.query, job.product_code].filter(Boolean).join(" ")}`]).font = { bold: true, size: 14 }; ws.mergeCells(1, 1, 1, COLS.length);
  headerRow(ws, COLS);
  widths(ws, [24, 44, 16, 10, 20, 30, 52, 38]);
  const list = job.suppliers;
  list.forEach((s) => {
    const price = s.price && s.vat_included ? Math.round(s.price / 1.1) : s.price;
    const info = productInfo(s), contact = contactText(s);
    const productCell = s.url ? { text: s.product_name || s.title || job.query, hyperlink: s.url } : (s.product_name || job.query);
    const row = ws.addRow([(s.recommended ? "★ " : "") + s.name, productCell, s.model_code || job.product_code || "", s.quantity ?? job.quantity, price ?? "Chưa có giá chính xác", vatText(s), info, contact]);
    row.height = Math.max(32, 15 * Math.max(lineCount(info), lineCount(contact)));
    for (let c = 1; c <= COLS.length; c++) {
      const cell = row.getCell(c); cell.border = BORDER; cell.alignment = WRAP;
      if (s.recommended) { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } }; cell.font = { bold: true }; }
    }
    row.getCell(2).font = { ...(s.recommended ? { bold: true } : {}), color: { argb: "FF0563C1" }, underline: true };
    row.getCell(5).numFmt = "#,##0";
  });
  const rec = list.find((s) => s.recommended);
  const after = 3 + Math.max(list.length, 1) + 1;
  const note = (r, label, value) => { ws.getCell(`A${r}`).value = label; ws.getCell(`A${r}`).font = { bold: true }; ws.getCell(`B${r}`).value = value; };
  note(after, "Đề xuất:", rec ? `${rec.name}: ${rec.product_name || rec.title}, đơn giá ${money(rec.price)}${rec.score != null ? `, điểm ${rec.score}` : ""}` : "Chưa đề xuất được (chưa có NCC với giá đọc chính xác từ trang sản phẩm)");
  note(after + 1, "Mục đích sử dụng:", job.purpose || "Chưa nhập");
  note(after + 2, "Thông số đã xác nhận:", specText(job.spec));
  ws.views = [{ state: "frozen", ySplit: 2, xSplit: 1 }];

  const info = wb.addWorksheet("Thông tin yêu cầu");
  [["Tên sản phẩm", job.query], ["Mã / model", job.product_code || "Không nhập"], ["Số lượng", job.quantity], ["Mục đích sử dụng", job.purpose || "Chưa nhập"],
    ["Thông số đã xác nhận", specText(job.spec)], ["Từ khóa tìm kiếm", job.keywords || ""], ["Engine đã dùng", (job.engines || []).join(", ") || "Nhập tay / link nhập tay"],
    ["Số trang NCC", list.length], ["Ngày lập", new Date().toLocaleDateString("vi-VN")]].forEach((r) => info.addRow(r));
  info.getColumn(1).font = { bold: true }; widths(info, [26, 80]);

  const cmp = wb.addWorksheet("So sánh giá");
  headerRow(cmp, ["NCC", "Đơn giá (đ)", "Tỷ lệ so với rẻ nhất (%)", "Khuyến nghị"]);
  priceComparison(list).forEach((r) => cmp.addRow([r.name, r.price, r.ratio, r.recommended ? "Có" : ""]));
  cmp.getColumn(2).numFmt = "#,##0"; widths(cmp, [34, 16, 24, 14]);

  const topics = Object.values(job.research || {});
  if (topics.length) {
    const kn = wb.addWorksheet("Tìm hiểu sản phẩm");
    headerRow(kn, ["Chủ đề", "Câu trả lời trích từ bài viết", "Nguồn"]);
    for (const r of topics) {
      (r.summary || []).forEach((x) => kn.addRow([`${r.label} (tóm tắt)`, x.text, x.url]));
      if (r.price) kn.addRow([r.label, `Giá thấp nhất ${money(r.price.min)}, trung vị ${money(r.price.median)}, cao nhất ${money(r.price.max)}`, ""]);
      if (r.brands && r.brands.length) kn.addRow([r.label, `Hãng thấy trên bài viết: ${r.brands.map((b) => `${b.value} (${b.count})`).join(", ")}`, ""]);
      if (!r.snippets.length && !r.price) kn.addRow([r.label, "Chưa tìm được câu trả lời rõ ràng", ""]);
      r.snippets.forEach((s) => kn.addRow([r.label, s.text, s.url]));
    }
    widths(kn, [26, 100, 60]); kn.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: "top", wrapText: true }; });
  }
  if ((job.custom_answers || []).length) {
    const ca = wb.addWorksheet("Câu hỏi thêm");
    headerRow(ca, ["Câu hỏi / từ khóa", "Câu trả lời trích từ bài viết", "Nguồn"]);
    for (const a of job.custom_answers) { if (!a.snippets.length) ca.addRow([a.question, "Chưa tìm được câu trả lời rõ ràng", ""]); a.snippets.forEach((s) => ca.addRow([a.question, s.text, s.url])); }
    widths(ca, [34, 100, 60]); ca.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: "top", wrapText: true }; });
  }
  if ((job.refs || []).length) {
    const rf = wb.addWorksheet("Bài viết tham khảo");
    headerRow(rf, ["Bài viết", "Link", "Tóm tắt (đề mục, ý chính, số liệu)", "Câu hỏi liên quan và trả lời"]);
    for (const a of job.refs) {
      const summary = [a.description, ...(a.headings.length ? ["Đề mục: " + a.headings.join(" | ")] : []), ...a.keyPoints.map((k) => `- ${k}`), ...a.facts].filter(Boolean).join("\n");
      const qa = a.qa.map((q) => `${q.label}: ${q.snippets.map((s) => s.text).join(" / ")}`).join("\n");
      rf.addRow([a.title, a.url, summary, qa]);
    }
    widths(rf, [40, 44, 90, 90]); rf.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: "top", wrapText: true }; });
  }

  const src = wb.addWorksheet("Nguồn tham khảo");
  headerRow(src, ["STT", "NCC", "Tiêu đề trang", "Link tham khảo", "Giá tìm được (đ)", "Ngày cập nhật web", "Đủ điều kiện", "Ghi chú"]);
  list.forEach((s, i) => src.addRow([i + 1, s.name, s.title, s.url, s.price, toDate(s.date), s.eligible ? "Có" : "Không", notes(s)]));
  src.getColumn(5).numFmt = "#,##0"; src.getColumn(6).numFmt = "dd/mm/yyyy"; widths(src, [6, 26, 40, 60, 18, 18, 14, 60]);
  src.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: "top", wrapText: true }; });

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
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Lịch sử tìm kiếm");
  headerRow(ws, ["STT", "Tiêu đề", "Số lượng", "Từ khóa đã tìm", "Các trang đã tìm", "Số lượt tìm", "Số NCC", "Giá trung bình (đ)", "Giá thấp nhất (đ)", "Giá cao nhất (đ)", "Lần gần nhất", "NCC được đề xuất"]);
  groups.forEach((g, i) => ws.addRow([i + 1, g.name, g.total_quantity, g.keywords.join(String.fromCharCode(10)), g.sites.map((s) => `${s.domain} (${s.visits})`).join(String.fromCharCode(10)), g.searches, g.supplier_count,
    g.avg_price, g.min_price, g.max_price, g.last_search.replace("T", " "), g.recommended.map((r) => `${r.name} (${r.times})`).join(", ")]));
  widths(ws, [6, 34, 10, 50, 44, 10, 8, 16, 16, 16, 20, 30]);
  ws.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: "top", wrapText: true }; });
  const d = wb.addWorksheet("Chi tiết NCC"); headerRow(d, ["Sản phẩm", "NCC", "Số lần xuất hiện", "Giá thấp nhất (đ)", "Giá gần nhất (đ)", "Link"]);
  groups.forEach((g) => g.suppliers.forEach((s) => d.addRow([g.name, s.name, s.times, s.min_price, s.last_price, s.url]))); widths(d, [30, 30, 14, 18, 18, 80]);
  return download(wb, "lich_su_tim_kiem.xlsx");
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
