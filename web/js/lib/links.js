// Lấy link NCC từ chữ dán vào (một hoặc nhiều link) hoặc từ file Excel/CSV/văn bản.
// Mỗi mục: { url, label } — label là ghi chú đi kèm trên cùng dòng (tên sản phẩm, tên NCC) nếu có.
import { normUrl } from "./text.js";

export const MAX_LINKS = 60;
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const BARE_RE = /(?:^|[\s,;|])((?:www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"'`]*)?)/gi;

/** Bỏ dấu câu dính cuối link: "…/abc)." -> "…/abc" */
export function cleanUrl(u) {
  let s = String(u).trim().replace(/[)\]}>,;.!?'"”’]+$/, "");
  // "(https://…)" bị cắt thiếu ngoặc đóng
  if (s.includes("(") && !s.includes(")")) s = s.replace(/\(.*$/, "");
  try { return new URL(s).href; } catch { return ""; }
}

const labelOf = (line, url) => line.replace(url, " ").replace(/https?:\/\/\S+/gi, " ").replace(/[|;\t]+/g, " ").replace(/\s+/g, " ").replace(/^[-•*\d.)\s]+/, "").trim().slice(0, 120);

/** Từ một đoạn chữ: mọi link http(s) (cả link "www." không có http), mỗi dòng có thể kèm ghi chú. */
export function extractLinks(text, max = MAX_LINKS) {
  const out = [];
  const seen = new Set();
  const push = (raw, line) => {
    const url = cleanUrl(raw);
    if (!url || !/^https?:$/.test(new URL(url).protocol)) return;
    const k = normUrl(url);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ url, label: labelOf(line, raw) });
  };
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const found = line.match(URL_RE) ?? [];
    for (const u of found) push(u, line);
    for (const m of line.matchAll(BARE_RE)) push("https://" + m[1], line);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

/** Một ô Excel -> chữ (ô siêu liên kết, công thức HYPERLINK, ô định dạng chữ giàu). */
export function cellText(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.hyperlink) return `${v.hyperlink} ${v.text ?? ""}`.trim();
    if (v.formula && typeof v.result !== "object") {
      const m = String(v.formula).match(/HYPERLINK\(\s*"([^"]+)"(?:\s*,\s*"([^"]*)")?/i);
      if (m) return `${m[1]} ${m[2] ?? ""}`.trim();
      return String(v.result ?? "");
    }
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return "";
  }
  return String(v);
}

/** rows: mảng các dòng, mỗi dòng là mảng ô. Link ở cột nào cũng nhận; chữ ở các ô còn lại của dòng làm ghi chú. */
export function linksFromRows(rows, max = MAX_LINKS) {
  const lines = [];
  for (const row of rows ?? []) {
    const cells = (row ?? []).map(cellText).map((c) => c.trim()).filter(Boolean);
    if (cells.length) lines.push(cells.join(" | "));
  }
  return extractLinks(lines.join("\n"), max);
}

/** CSV đơn giản (dấu phẩy, chấm phẩy hoặc tab; có thể có ngoặc kép). */
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  const s = String(text ?? "").replace(/^﻿/, "");
  const delim = (s.split(/\r?\n/, 1)[0].match(/[\t;,]/) ?? [","])[0];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/** Đọc file người dùng chọn (.xlsx, .csv, .txt). ExcelJS chỉ nạp khi cần. */
export async function readLinkFile(file, { loadExcel, max = MAX_LINKS } = {}) {
  const name = String(file?.name ?? "").toLowerCase();
  if (/\.(xlsx|xlsm)$/.test(name)) {
    const ExcelJS = await loadExcel();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const rows = [];
    wb.eachSheet((ws) => ws.eachRow({ includeEmpty: false }, (row) => { const cells = []; row.eachCell({ includeEmpty: false }, (c) => cells.push(c.value)); rows.push(cells); }));
    return linksFromRows(rows, max);
  }
  if (/\.xls$/.test(name)) throw new Error("File .xls (Excel cũ) chưa đọc được. Hãy lưu lại thành .xlsx hoặc .csv rồi chọn lại.");
  const text = await file.text();
  return /\.(csv|tsv)$/.test(name) ? linksFromRows(parseCsv(text), max) : extractLinks(text, max);
}

/** Gộp nhiều nguồn link, bỏ trùng. */
export function mergeLinks(...lists) {
  const seen = new Set();
  const out = [];
  for (const l of lists.flat()) {
    const k = normUrl(l.url);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out.slice(0, MAX_LINKS);
}
